// Loads marketplace/install-queue.mjs (shared with the TUI) at runtime from the
// repository, so the web route and the TUI run the very same queue/consent
// rules. webpackIgnore keeps Next from trying to bundle a file outside web-ui/.
import { pathToFileURL } from 'node:url'

/** @param {string} file absolute path to marketplace/install-queue.mjs */
export function loadInstallQueue(file) {
  return import(/* webpackIgnore: true */ pathToFileURL(file).href)
}
