// Studio launcher rules for Android/Capacitor (no Electron or build needed):
// LAN servers load inside the app over HTTP, remote servers need HTTPS and
// open in the system browser, and the Capacitor config matches the launcher.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { isPrivateHost, opensInAndroidApp, studioTarget } = require('../android-web/studio-url.js')
const capacitor = JSON.parse(readFileSync(new URL('../capacitor.config.json', import.meta.url), 'utf8'))
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const studioHtml = readFileSync(new URL('../android-web/studio.html', import.meta.url), 'utf8')
const studioJs = readFileSync(new URL('../android-web/studio.js', import.meta.url), 'utf8')

test('plain HTTP is accepted only for loopback and private LAN hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.2.2', '172.16.0.1', '172.31.255.1', '192.168.1.20', '169.254.3.4', 'mymac.local', '[::1]', '[fd12::1]', '[fe80::1]']) {
    assert.equal(isPrivateHost(host), true, host)
  }
  for (const host of ['example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '11.0.0.1', '999.168.1.1', 'evil.local.example.com', '[2001:db8::1]']) {
    assert.equal(isPrivateHost(host), false, host)
  }
  assert.deepEqual(studioTarget('http://192.168.1.20:3001', '/jobs'),
    { origin: 'http://192.168.1.20:3001', target: 'http://192.168.1.20:3001/jobs', inApp: true })
  assert.throws(() => studioTarget('http://my-server.example:3001', '/dashboard'), /Use HTTPS for a remote server/)
  assert.throws(() => studioTarget('http://8.8.8.8:3001', '/dashboard'), /HTTPS/)
})

test('remote HTTPS servers are allowed but open outside the app', () => {
  assert.deepEqual(studioTarget('https://studio.example.com', undefined),
    { origin: 'https://studio.example.com', target: 'https://studio.example.com/dashboard', inApp: false })
  assert.equal(studioTarget('https://192.168.1.20:3001', '/settings').inApp, true)
  for (const bad of ['', 'ftp://192.168.1.2', 'https://u:p@example.com', 'https://example.com/x', 'https://example.com/?a=1', 'https://example.com/#a']) {
    assert.throws(() => studioTarget(bad, '/dashboard'), bad)
  }
  assert.throws(() => studioTarget('https://example.com', '//evil.example'), /section/)
})

// Capacitor's allowNavigation masks match per dot-separated label, '*' = any label.
function matchesMask(mask, host) {
  const m = mask.split('.')
  const h = host.split('.')
  if (m.length > 1 && m.length !== h.length) return false
  return m.every((part, i) => part === '*' || part === h[i])
}

test('Capacitor keeps exactly the launcher in-app hosts in the WebView', () => {
  const masks = capacitor.server.allowNavigation
  const inWebView = host => masks.some(mask => matchesMask(mask, host))
  for (const host of ['localhost', '127.0.0.1', '10.0.2.2', '172.16.0.1', '172.31.0.9', '192.168.1.20', '169.254.1.1', 'mymac.local',
    'example.com', '172.15.0.1', '172.32.0.1', '8.8.8.8', 'studio.example.com', 'a.b.local']) {
    assert.equal(inWebView(host), opensInAndroidApp(host), host)
  }
  assert.ok(!masks.includes('*'), 'never allow every host in the WebView')
})

test('Android allows cleartext for LAN servers and no longer allows mixed content', () => {
  assert.equal(capacitor.server.cleartext, true)
  assert.equal(capacitor.server.androidScheme, 'https')
  assert.equal(capacitor.android.allowMixedContent, undefined)
  assert.match(manifest, /android:usesCleartextTraffic="true"/)
})

test('launcher page loads the shared rules and only navigates to validated targets', () => {
  assert.ok(studioHtml.indexOf('src="studio-url.js"') < studioHtml.indexOf('src="studio.js"'))
  assert.match(studioJs, /GhostForgeStudioUrl\.studioTarget\(/)
  assert.match(studioJs, /window\.location\.assign\(target\)/)
  assert.doesNotMatch(studioJs, /new URL\(input\.value/)
})
