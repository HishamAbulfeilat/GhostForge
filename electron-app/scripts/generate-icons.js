#!/usr/bin/env node
/**
 * GhostForge JARVIS — Build Icon Generator
 * Generates all platform icons from a base SVG using sharp.
 *
 * Outputs:
 *   build/icon.icns    — macOS
 *   build/icon.ico     — Windows
 *   build/icons/*.png  — Linux (16–512px)
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const ICONS_DIR = path.join(BUILD_DIR, 'icons');
const SIZES = [16, 32, 64, 128, 256, 512];
const BASE_SIZE = 1024;

// GhostForge logo SVG — ghost silhouette with gear cog
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BASE_SIZE} ${BASE_SIZE}" width="${BASE_SIZE}" height="${BASE_SIZE}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e293b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="${BASE_SIZE}" height="${BASE_SIZE}" rx="200" fill="url(#bg)"/>
  <g transform="translate(512, 520)" fill="url(#accent)">
    <ellipse cx="0" cy="-60" rx="220" ry="240"/>
    <ellipse cx="-140" cy="140" rx="80" ry="60"/>
    <ellipse cx="0" cy="180" rx="70" ry="50"/>
    <ellipse cx="140" cy="140" rx="80" ry="60"/>
    <ellipse cx="-200" cy="40" rx="60" ry="80"/>
    <ellipse cx="200" cy="40" rx="60" ry="80"/>
  </g>
  <circle cx="430" cy="450" r="50" fill="url(#bg)"/>
  <circle cx="594" cy="450" r="50" fill="url(#bg)"/>
  <g transform="translate(680, 340)" fill="none" stroke="#22d3ee" stroke-width="18" stroke-linecap="round">
    <circle cx="0" cy="0" r="70" stroke-dasharray="60 30"/>
    <circle cx="0" cy="0" r="30"/>
    <line x1="0" y1="-100" x2="0" y2="-70"/>
    <line x1="0" y1="70" x2="0" y2="100"/>
    <line x1="-100" y1="0" x2="-70" y2="0"/>
    <line x1="70" y1="0" x2="100" y2="0"/>
    <line x1="-70" y1="-70" x2="-50" y2="-50"/>
    <line x1="50" y1="50" x2="70" y2="70"/>
    <line x1="70" y1="-70" x2="50" y2="-50"/>
    <line x1="-50" y1="50" x2="-70" y2="70"/>
  </g>
</svg>`;

async function ensureDirs() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

async function generateBasePng() {
  const baseBuffer = Buffer.from(LOGO_SVG);
  const basePng = await sharp(baseBuffer)
    .resize(BASE_SIZE, BASE_SIZE)
    .png()
    .toBuffer();
  return basePng;
}

async function generatePngs(basePng) {
  const tasks = SIZES.map(async (size) => {
    const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(basePng)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
    console.log(`  ${outPath}`);
  });

  // Also write the main icon.png (512x512)
  tasks.push(
    sharp(basePng)
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(ICONS_DIR, 'icon.png'))
      .then(() => console.log(`  ${path.join(ICONS_DIR, 'icon.png')}`))
  );

  await Promise.all(tasks);
}

async function generateIco(basePng) {
  const icoPath = path.join(BUILD_DIR, 'icon.ico');
  // sharp doesn't natively write .ico, but we can create a multi-page PNG
  // that electron-builder accepts, or use a buffer approach.
  // For electron-builder, a 256x256 PNG renamed to .ico works in practice,
  // but let's create a proper multi-size ICO via raw buffer manipulation.
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = await Promise.all(
    sizes.map(async (size) => {
      const buf = await sharp(basePng)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      return { size, buf };
    })
  );

  // Build ICO file manually
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);       // reserved
  header.writeUInt16LE(1, 2);       // type: ICO
  header.writeUInt16LE(images.length, 4); // count

  let dataOffset = 6 + images.length * 16;
  const entries = [];
  const imageData = [];

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.size > 255 ? 0 : img.size, 0);   // width
    entry.writeUInt8(img.size > 255 ? 0 : img.size, 1);   // height
    entry.writeUInt8(0, 2);                                // color palette
    entry.writeUInt8(0, 3);                                // reserved
    entry.writeUInt16LE(1, 4);                             // color planes
    entry.writeUInt16LE(32, 6);                            // bits per pixel
    entry.writeUInt32LE(img.buf.length, 8);                // data size
    entry.writeUInt32LE(dataOffset, 12);                   // data offset
    entries.push(entry);
    imageData.push(img.buf);
    dataOffset += img.buf.length;
  }

  const ico = Buffer.concat([header, ...entries, ...imageData]);
  fs.writeFileSync(icoPath, ico);
  console.log(`  ${icoPath}`);
}

async function generateIcns(basePng) {
  const icnsPath = path.join(BUILD_DIR, 'icon.icns');
  // ICNS format: header + icon entries
  // We'll generate a minimal ICNS with ic07 (128), ic08 (256), ic09 (512), ic10 (1024)
  const iconTypes = [
    { type: 'ic07', size: 128 },
    { type: 'ic08', size: 256 },
    { type: 'ic09', size: 512 },
    { type: 'ic10', size: 1024 },
  ];

  const entries = await Promise.all(
    iconTypes.map(async ({ type, size }) => {
      const png = await sharp(basePng)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const typeBuffer = Buffer.from(type, 'ascii');
      const length = 8 + png.length;
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(length, 0);
      return Buffer.concat([typeBuffer, lengthBuffer, png]);
    })
  );

  const totalLength = 8 + entries.reduce((sum, e) => sum + e.length, 0);
  const header = Buffer.from('icns', 'ascii');
  const totalLengthBuffer = Buffer.alloc(4);
  totalLengthBuffer.writeUInt32BE(totalLength, 0);

  const icns = Buffer.concat([header, totalLengthBuffer, ...entries]);
  fs.writeFileSync(icnsPath, icns);
  console.log(`  ${icnsPath}`);
}

async function main() {
  console.log('GhostForge JARVIS — Icon Generator');
  console.log('');

  await ensureDirs();

  console.log('Generating base 1024x1024 PNG...');
  const basePng = await generateBasePng();

  // Save base PNG for reference
  const basePath = path.join(BUILD_DIR, 'icon.png');
  fs.writeFileSync(basePath, basePng);
  console.log(`  ${basePath}`);

  console.log('');
  console.log('Generating PNG icons...');
  await generatePngs(basePng);

  console.log('');
  console.log('Generating Windows ICO...');
  await generateIco(basePng);

  console.log('');
  console.log('Generating macOS ICNS...');
  await generateIcns(basePng);

  console.log('');
  console.log('All icons generated successfully!');
  console.log('');
  console.log('Output files:');
  console.log(`  ${path.join(BUILD_DIR, 'icon.icns')}`);
  console.log(`  ${path.join(BUILD_DIR, 'icon.ico')}`);
  console.log(`  ${path.join(ICONS_DIR, 'icon.png')}`);
  SIZES.forEach((s) => console.log(`  ${path.join(ICONS_DIR, `icon-${s}.png`)}`));
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
