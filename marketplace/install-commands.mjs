/**
 * Cross-platform install-command resolution for the marketplace catalog.
 *
 * `catalog.json` carries one POSIX command (`install_command`, for macOS/Linux)
 * and an optional Windows one (`install_command_windows`). Both consumers — the
 * TUI (`screenMarketplace` in tui/index.js) and `scripts/marketplace.sh` — must
 * agree on which command applies, or Windows users get a `brew install …`
 * one-liner executed by cmd.exe.
 *
 * Why return null instead of falling back: the previous inline ternary in the
 * TUI was
 *
 *     platform === 'win32' && item.install_command_windows
 *       ? item.install_command_windows
 *       : item.install_command
 *
 * so any item without a verified WinGet package silently handed its POSIX
 * command to Windows. Returning null makes callers show the manual-install hint
 * (the item's `url`) rather than running something that cannot work.
 *
 * This module is deliberately dumb: it selects between two declared strings and
 * never inspects or "guesses" what a command does. Portability of a command is
 * catalog data (an item whose command runs on Windows simply carries the same
 * command in `install_command_windows`), which keeps the rule checkable by
 * tests/marketplace-install-commands.test.js instead of by regex.
 *
 * Dependency-free ESM (.mjs) so it loads from `tui/` (type: module), from
 * CommonJS root scripts via dynamic import, and from node one-liners alike.
 */

/**
 * @typedef {object} InstallableItem
 * @property {string} [install_command]         POSIX (macOS/Linux) install command
 * @property {string} [install_command_windows] Verified Windows install command
 * @property {string} [url]                     Upstream link, used for the manual hint
 */

/**
 * Pick the install command for the current platform.
 *
 * @param {InstallableItem} item
 * @param {string} [platform] node `process.platform`; injectable for tests
 * @returns {string|null} command to run, or null when the catalog declares none
 *   for this platform
 */
export function resolveInstallCommand(item, platform = process.platform) {
  if (!item || typeof item !== 'object') return null;
  const pick = key => (typeof item[key] === 'string' && item[key].trim() ? item[key].trim() : null);
  return platform === 'win32' ? pick('install_command_windows') : pick('install_command');
}

/**
 * True when the catalog declares an installer for this platform. Drives whether
 * a surface offers "install" or points the user at `url` instead.
 */
export function hasInstallCommandForPlatform(item, platform = process.platform) {
  return resolveInstallCommand(item, platform) !== null;
}

/**
 * What to show a user on a platform with no automated installer. Returns null
 * when a command is available, so callers can use it directly as a hint.
 */
export function explainMissingCommand(item, platform = process.platform) {
  if (hasInstallCommandForPlatform(item, platform)) return null;
  return platform === 'win32'
    ? 'No verified Windows package yet — install manually from the upstream link.'
    : 'No automated installer — install manually from the upstream link.';
}