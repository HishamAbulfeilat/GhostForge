# /rtl Command

## Purpose
Scan the codebase for RTL and logical CSS issues, report what was found, and optionally apply safe replacements.

## Usage
```bash
/rtl
/rtl --fix
```

## What AI should scan
- Tailwind directional spacing classes:
  - `ml-` → `ms-`
  - `mr-` → `me-`
  - `pl-` → `ps-`
  - `pr-` → `pe-`
- Text alignment classes:
  - `text-left` → `text-start`
  - `text-right` → `text-end`
- Hardcoded CSS direction rules:
  - `direction: ltr`
  - `direction: rtl`
- Hardcoded left and right CSS properties when logical properties would be safer.

## What AI does step by step
1. Search the repository for Tailwind classes and CSS rules that break RTL support.
2. Count findings by category and file.
3. Suggest logical replacements using Tailwind or CSS logical properties.
4. If the user asks for fixes, apply safe auto-fixes and preserve formatting.
5. Summarize what changed and flag anything that still needs manual review.

## Replacement rules
| Found | Replace with |
|---|---|
| `ml-*` | `ms-*` |
| `mr-*` | `me-*` |
| `pl-*` | `ps-*` |
| `pr-*` | `pe-*` |
| `text-left` | `text-start` |
| `text-right` | `text-end` |

## Example output
```text
RTL scan complete.
- 14 directional Tailwind classes found
- 3 text alignment issues found
- 2 hardcoded CSS direction rules found

Suggested fixes:
- ml-4  -> ms-4
- pr-6  -> pe-6
- text-right -> text-end
```

## Auto-fix behavior
- `/rtl` reports findings only.
- `/rtl --fix` applies straightforward replacements automatically.
- Leave ambiguous layout cases for manual review and explain why.
