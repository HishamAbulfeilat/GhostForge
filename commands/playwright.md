# /playwright — End-to-End Testing

Set up and run Playwright browser tests for the current project.

JARVIS browser control does not require Playwright: open/search, back/forward, reload, tabs, typing, scrolling, and accessibility-based click actions run through the Mac host for free. Playwright is optional for repeatable DOM-aware test automation.

## Usage

```text
/playwright
/playwright install
/playwright test
/playwright test --ui
/playwright codegen http://localhost:3000
/playwright report
```

## Actions

- **Install** — runs `npm init playwright@latest` and creates the Playwright configuration.
- **Test** — runs the full E2E suite in headless mode.
- **UI mode** — opens Playwright's interactive test runner.
- **Codegen** — records browser actions and generates a starter test.
- **Report** — opens the latest HTML test report.

## Recommended Flow

1. Start the application locally.
2. Run `/playwright codegen` to capture a critical user journey.
3. Move the generated assertions into `tests/`.
4. Run `/playwright test` before committing.
5. Use traces and the HTML report to diagnose failures.

## Notes

- GhostForge runs Playwright in the current working directory.
- Use stable roles, labels, and test IDs instead of brittle CSS selectors.
- Keep authentication setup in a reusable fixture or storage-state file.
- Add mobile and RTL projects when the product supports those layouts.
