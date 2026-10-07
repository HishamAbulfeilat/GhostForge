'use strict';

const form = document.getElementById('connectForm');
const input = document.getElementById('serverUrl');
const status = document.getElementById('status');
const storageKey = 'ghostforge-studio-url';
const desktop = window.ghostforgeStudio;
const connectionError = new URLSearchParams(window.location.search).get('error');
if (connectionError) status.textContent = connectionError;

try {
  input.value = localStorage.getItem(storageKey) || '';
} catch (error) {
  status.textContent = `Could not read the saved server address: ${error.message}`;
}
if (desktop) {
  desktop.getUrl().then(url => { if (url) input.value = url; }).catch(error => {
    status.textContent = `Could not read desktop settings: ${error.message}`;
  });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const buttons = Array.from(form.querySelectorAll('button'));
  try {
    const url = new URL(input.value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Enter an HTTP or HTTPS server address without credentials, paths, queries or fragments.');
    }
    const path = event.submitter?.dataset.path || '/dashboard';
    if (!['/dashboard', '/jobs', '/agents', '/marketplace', '/settings'].includes(path)) throw new Error('Unknown studio section.');
    buttons.forEach(button => { button.disabled = true; });
    localStorage.setItem(storageKey, url.origin);
    status.textContent = 'Opening your server. If it is unavailable, check that it is running and the address is reachable from this device.';
    if (desktop) await desktop.connect(url.origin, path);
    else window.location.assign(`${url.origin}${path}`);
  } catch (error) {
    status.textContent = `Could not connect: ${error.message}`;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});
