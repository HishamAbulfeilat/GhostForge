# /unused Command

## Purpose
Find unused components, exports, dependencies, and dead code using `knip` — the zero-config dead code finder.

## Usage
```bash
/unused
/unused --deps     # Focus on unused npm dependencies only
/unused --exports  # Focus on unused exports only
/unused --files    # Focus on unused files only
/unused --fix      # Auto-remove safe unused items
```

## Options
| Option | Description |
|---|---|
| `--deps` | Show only unused npm dependencies |
| `--exports` | Show only unused exported symbols |
| `--files` | Show only unused/unreachable files |
| `--fix` | Remove safe items automatically (with git safety check) |
| `--reporter compact` | Compact output (default: symbols) |

## What It Finds
| Category | Examples |
|---|---|
| Unused files | Components never imported anywhere |
| Unused exports | Functions/types exported but not imported |
| Unused dependencies | Packages in `package.json` never imported |
| Unused devDependencies | Dev packages not used in config or scripts |
| Duplicate exports | Same symbol exported from multiple places |

## Examples
```bash
/unused              # Full scan
/unused --deps       # Just check package.json bloat
/unused --exports    # Find dead exports before a refactor
```

## Output Example
```
🔍 Scanning for dead code (knip)...

📁 Unused files (2):
   src/components/OldButton.tsx
   src/utils/deprecated.ts

📤 Unused exports (5):
   src/hooks/useOldAuth.ts → useOldAuth
   src/types/legacy.ts → LegacyUser, LegacyRole

📦 Unused dependencies (3):
   moment (use date-fns instead)
   lodash
   @types/uuid (uuid types now bundled)

💡 Tip: Run /unused --fix to remove safe items (checks git status first)
```
