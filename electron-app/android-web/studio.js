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
    const { origin, target, inApp } = window.GhostForgeStudioUrl.studioTarget(input.value, event.submitter?.dataset.path);
    buttons.forEach(button => { button.disabled = true; });
    localStorage.setItem(storageKey, origin);
    if (desktop) {
      status.textContent = 'Opening your server. If it is unavailable, check that it is running and the address is reachable from this device.';
      await desktop.connect(origin, event.submitter?.dataset.path || '/dashboard');
    } else {
      // Android: LAN and localhost servers load inside the app; Capacitor hands
      // any other host (a remote HTTPS server) to the system browser.
      status.textContent = inApp
        ? 'Opening your server in the app. If it is unavailable, check that it is running and reachable from this device.'
        : 'Remote servers open in your browser. Sign in or pair the device there.';
      window.location.assign(target);
    }
  } catch (error) {
    status.textContent = `Could not connect: ${error.message}`;
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});
