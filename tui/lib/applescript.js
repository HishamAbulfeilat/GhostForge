/**
 * AppleScript string-literal escaping for the TUI.
 *
 * Every AppleScript string literal built from user input goes through
 * `escapeAppleScriptString` first. The order is load-bearing:
 *
 *   1. backslashes are escaped BEFORE quotes. Escaping quotes first means the
 *      backslash this function adds in front of a quote is itself escaped by
 *      step 1 on the next value, and the quote ends up unescaped again.
 *   2. quotes are escaped after backslashes, which is what makes step 1 hold.
 *   3. CR/LF are escaped last, because a literal newline or carriage return
 *      cannot appear inside an AppleScript string literal at all — without
 *      this, typing a multi-line message produces a syntax error.
 *
 * CodeQL js/incomplete-sanitization: the previous code used
 * `.replace(/"/g, '\\"')`, which quotes-only escaping and is defeatable by
 * `a\"` → `a\\"` → the `\\` is a literal backslash and the `"` closes the
 * literal early.
 */

export function escapeAppleScriptString(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}