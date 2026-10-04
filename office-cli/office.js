#!/usr/bin/env node
/**
 * GHOSTFORGE OFFICE-CLI
 * No-dependency Node CLI to generate, list & read office documents on disk at
 * ~/.ghostforge/documents/. The JARVIS "office_document" tool wraps this.
 *
 *   node office.js generate <type> <Title> [--k=v ...]
 *   node office.js list [--type memo|minutes|report|cover]
 *   node office.js read <file>
 *   node office.js template <type> <Title> --body "..." [--k=v ...]
 */
import fs, { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';

const DOCS_DIR = join(homedir(), '.ghostforge', 'documents');

/** True when `candidate` resolves to `root` itself or something under it. */
function isInside(root, candidate) {
  const base = resolve(root);
  const target = resolve(candidate);
  return target === base || target.startsWith(base + sep);
}

const TYPES = {
  memo: {
    ext: 'md',
    defaultTitle: 'Untitled Memo',
    template: (f) => `# MEMORANDUM

**To:** ${f.to || '[Recipient]'}
**From:** ${f.from || '[Author]'}
**Date:** ${f.date}
**Subject:** ${f.subject || '[Subject]'}

${f.body || 'State the purpose concisely.'}

## Details
${f.details || ''}

## Action required
${f.action || '—'}
`,
  },
  minutes: {
    ext: 'md',
    defaultTitle: 'Untitled Minutes',
    template: (f) => `# MEETING MINUTES

**Meeting:** ${f.meeting || '[Meeting name]'}
**Date:** ${f.date}
**Attendees:** ${f.attendees || '—'}
**Facilitator:** ${f.facilitator || '—'}

## Agenda
${f.agenda || ''}

## Discussion
${f.discussion || ''}

## Decisions
${f.decisions || ''}

## Action Items
${f.actions || '—'}
`,
  },
  report: {
    ext: 'md',
    defaultTitle: 'Untitled Report',
    template: (f) => `# REPORT: ${f.title || f.subject || 'Untitled'}

**Date:** ${f.date}
**Prepared by:** ${f.from || f.author || '[Author]'}
**Period:** ${f.period || '—'}

## Executive summary
${f.summary || f.body || ''}

## Key findings
${f.findings || ''}

## Metrics
${f.metrics || '—'}

## Recommendations
${f.recommendations || ''}
`,
  },
  cover: {
    ext: 'md',
    defaultTitle: 'Cover Letter',
    template: (f) => `# COVER LETTER

${f.date}

${f.to || '[Company address]'}

Dear ${f.hiringManager || 'Hiring Manager'},

${f.body || f.summary || '[Opening paragraph]'}

${f.details || '[Relevant experience paragraph]'}

Sincerely,
${f.from || f.name || '[Your name]'}
${f.email || ''}
${f.phone || ''}
`,
  },
  contract: {
    ext: 'md',
    defaultTitle: 'Agreement',
    template: (f) => `# AGREEMENT

**Parties:** ${f.parties || '[Party A] and [Party B]'}
**Date:** ${f.date}
**Effective:** ${f.effective || f.date}

## 1. Purpose
${f.purpose || ''}

## 2. Terms
${f.body || f.terms || ''}

## 3. Duration
${f.duration || '—'}

## 4. Signatures
________________    ________________
${f.partyA || 'Party A'}         ${f.partyB || 'Party B'}
`,
  },
};

function slugify(s) {
  return String(s || 'untitled').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseFields(args) {
  const out = {};
  for (const a of args) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const val = eq === -1 ? true : a.slice(eq + 1);
    out[key] = val;
  }
  return out;
}

function generate(type, title, fields) {
  const def = TYPES[type];
  if (!def) return { error: `Unknown type "${type}". Pick from: ${Object.keys(TYPES).join(', ')}` };
  const ctx = { ...fields, date: dateStamp() };
  ctx.name = ctx.name || title || def.defaultTitle;
  const body = def.template(ctx);
  const file = join(DOCS_DIR, `${slugify(ctx.name)}.${def.ext}`);
  if (!existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(file, body);
  return { file, type, name: ctx.name, body };
}

function listDocs() {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR).map((f) => ({ file: join(DOCS_DIR, f), name: f }));
}

const [cmd, ...args] = process.argv.slice(2);
const type = args[0];
const title = args[1];
const params = parseFields(args);

// --json body support: allow freeform body via --body="..."
switch (cmd) {
  case 'generate':
  case 'gen':
  case 'template':
  case 'new': {
    if (!type) { console.error('usage: office.js generate <type> <Title> [--k=v ...]'); process.exit(2); }
    // `template <type> <Title>` takes the same positional shape as `generate`;
    // it previously swapped the two and then asked generate() for a type
    // called by the title, so the documented command always failed.
    const res = generate(type, title, params);
    if (res.error) { console.error(res.error); process.exit(1); }
    console.log(JSON.stringify(res, null, 2));
    break;
  }
  case 'list':
  case 'ls': {
    console.log(JSON.stringify(listDocs(), null, 2));
    break;
  }
  case 'read': {
    if (!type) { console.error('usage: office.js read <file>'); process.exit(2); }
    // Resolve inside DOCS_DIR only. `join` alone let `read ../secret` (and
    // any `..` segment) escape the documents directory and print arbitrary
    // files from the home directory — reachable from the JARVIS
    // `office_document` tool, which passes a model-supplied name straight
    // through.
    const file = join(DOCS_DIR, type);
    if (!isInside(DOCS_DIR, file)) {
      console.error('Invalid document path: ' + type); process.exit(1);
    }
    if (!existsSync(file)) { console.error('Not found: ' + file); process.exit(1); }
    console.log(readFileSync(file, 'utf8'));
    break;
  }
  case 'help':
  default: {
    console.log(
      'GHOSTFORGE OFFICE-CLI\n' +
      '  node office.js generate <type> <Title> [--k=v ...]\n' +
      '  node office.js template <type> <Title> [--k=v ...]\n' +
      '  node office.js list\n' +
      '  node office.js read <file>\n' +
      'Types: ' + Object.keys(TYPES).join(', ') + '\n' +
      'Store: ' + DOCS_DIR
    );
  }
}