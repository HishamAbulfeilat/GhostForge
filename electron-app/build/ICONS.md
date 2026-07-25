# Build Icons

Place your app icons here for electron-builder.

## Required Files

| File | Platform | Size |
|------|----------|------|
| `icon.icns` | macOS | 1024×1024 (converted by electron-builder) |
| `icon.ico` | Windows | 256×256 multi-size |
| `icons/icon.png` | Linux | 512×512 minimum |

## Generating from Source PNG

If you have a 1024×1024 `icon.png`:

### macOS (.icns)
```bash
# Using electron-icon-builder
npx electron-icon-builder --input=icon.png --output=build
```

### Windows (.ico)
```bash
# Using ImageMagick
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Linux (PNG)
```bash
# electron-builder can use a single PNG
cp icon.png build/icons/icon.png
```

## Quick Setup

1. Place a 1024×1024 `icon.png` in this directory
2. Run: `npx electron-icon-builder --input=build/icon.png --output=build`
3. This generates `icon.icns` and `icon.ico` automatically
4. The `icons/` folder gets a properly sized `icon.png`
