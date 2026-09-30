const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const route = readFileSync(resolve(__dirname, '../app/api/device-controls/route.ts'), 'utf8')

test('device controls route protects the bridge and validates supported actions', () => {
  assert.match(route, /isAuthorizedRequest\(req\)/)
  assert.match(route, /target !== 'youtube' && target !== 'game-updater'/)
  assert.match(route, /YOUTUBE_ACTIONS = new Set\(\['play', 'summarize', 'get_info', 'trending'\]\)/)
  assert.match(route, /GAME_ACTIONS = new Set\(\['list', 'update', 'schedule', 'cancel_schedule', 'schedule_status', 'download_status'\]\)/)
  assert.match(route, /query is required for play/)
  assert.match(route, /a valid YouTube URL is required for this action/)
  assert.match(route, /region must be a 2-3 letter country code/)
})

test('device controls route forwards only to the matching bridge endpoint', () => {
  assert.match(route, /target === 'youtube' \? '\/api\/mark-l\/youtube' : '\/api\/mark-l\/game-updater'/)
  assert.match(route, /Authorization: `Bearer \$\{getLiveBridgeToken\(\)\}`/)
  assert.match(route, /AbortSignal\.timeout\(180_000\)/)
})
