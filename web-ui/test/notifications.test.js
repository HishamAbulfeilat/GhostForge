import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

test('notifications route wires the push management panel', async () => {
  const page = await readFile(path.join(root, 'app', 'notifications', 'page.tsx'), 'utf8')
  assert.match(page, /PushNotificationPanel/)
  assert.match(page, /NotificationsPage/)
})

test('push panel uses the existing authenticated push contracts', async () => {
  const panel = await readFile(path.join(root, 'components', 'PushNotificationPanel.tsx'), 'utf8')
  assert.match(panel, /fetch\('\/api\/push'\)/)
  assert.match(panel, /subscription\.toJSON\(\)/)
  assert.match(panel, /subscription: null/)
  assert.match(panel, /serviceWorker\.register\('\/sw\.js'\)/)
  assert.match(panel, /Notification\.requestPermission\(\)/)
  assert.match(panel, /role="alert"/)
})
