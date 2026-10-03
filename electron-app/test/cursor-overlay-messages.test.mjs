import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import vm from 'node:vm'

const cursorHtmlPath = fileURLToPath(new URL('../src/renderer/cursor.html', import.meta.url))

// The overlay is loaded straight off disk by CursorOverlay.createOverlay(), so its
// scripts are inline. Tests run the real script in a stub DOM rather than a copy,
// which keeps them honest if the shipped guard is reverted.
async function loadOverlay() {
  const html = await readFile(cursorHtmlPath, 'utf8')
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  assert.equal(scripts.length, 1, 'cursor.html should hold exactly one inline script')
  assert.doesNotMatch(scripts[0][1], /\bsrc\s*=/i, 'the overlay script must stay inline')

  return { html, source: scripts[0][2] }
}

function createElement(id, classes = []) {
  return {
    id,
    style: {},
    textContent: '',
    classList: {
      names: new Set(classes),
      add(...names) {
        for (const name of names) this.names.add(name)
      },
      remove(...names) {
        for (const name of names) this.names.delete(name)
      },
      contains(name) {
        return this.names.has(name)
      },
    },
  }
}

/**
 * Evaluate the overlay script against a stub window/document and return the
 * handles a test needs to fire messages and observe the result.
 */
function mountOverlay(source, { origin = 'null', electron } = {}) {
  const elements = {
    cursor: createElement('cursor', ['hidden']),
    cursorRing: createElement('cursorRing'),
    cursorLabel: createElement('cursorLabel', ['hidden']),
    overlay: createElement('overlay'),
  }

  const messageHandlers = []
  const window = {
    location: { origin },
    addEventListener(type, handler) {
      if (type === 'message') messageHandlers.push(handler)
    },
  }
  if (electron) window.electron = electron

  // The 400ms animation is stepped straight to its end so a point lands in one frame.
  const frames = new Map()
  let nextFrameId = 1
  let frameTime = 0

  const context = vm.createContext({
    window,
    document: { getElementById: (id) => elements[id] ?? null },
    performance: { now: () => frameTime },
    requestAnimationFrame(callback) {
      const id = nextFrameId++
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) {
      frames.delete(id)
    },
    setTimeout(callback) {
      callback()
      return 0
    },
    clearTimeout() {},
  })

  vm.runInContext(source, context, { filename: 'cursor.html' })

  return {
    elements,
    deliver(event) {
      for (const handler of messageHandlers) handler(event)
    },
    /** A message this very window posted to itself: the only shape accepted. */
    selfMessage(data) {
      return { source: window, origin, data }
    },
    flush() {
      let guard = 0
      while (frames.size > 0 && guard++ < 1000) {
        frameTime += 400
        const pending = [...frames.values()]
        frames.clear()
        for (const callback of pending) callback(frameTime)
      }
    },
  }
}

/** Wrap an object's properties in getters so a test can see what was read. */
function trackReads(value, reads, prefix) {
  const tracked = {}
  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(tracked, key, {
      enumerable: true,
      get() {
        reads.push(`${prefix}.${key}`)
        return entry
      },
    })
  }
  return tracked
}

function pointPayload(x = 220, y = 320, label = 'Deploy') {
  return { type: 'cursor:point', target: { x, y, label, timestamp: 1 } }
}

test('a message from another window is ignored, even at the same origin', async () => {
  const { source } = await loadOverlay()
  const overlay = mountOverlay(source)

  overlay.deliver({ source: {}, origin: 'null', data: pointPayload() })
  overlay.flush()

  assert.equal(overlay.elements.cursor.classList.contains('hidden'), true)
  assert.equal(overlay.elements.cursor.style.left, undefined)
})

test('a self-delivered message at a foreign origin is ignored', async () => {
  const { source } = await loadOverlay()
  const overlay = mountOverlay(source)

  overlay.deliver({ source: overlay.elements.overlay, origin: 'https://evil.test', data: pointPayload() })

  assert.equal(overlay.elements.cursor.classList.contains('hidden'), true)
})

test('a rejected message is never inspected', async () => {
  const { source } = await loadOverlay()
  const overlay = mountOverlay(source)

  const reads = []
  overlay.deliver({
    source: {},
    origin: 'https://evil.test',
    data: trackReads(pointPayload(), reads, 'data'),
  })

  assert.deepEqual(reads, [], 'the payload must not be read before the source check passes')
})

test('the overlay accepts its own cursor:point message', async () => {
  const { source } = await loadOverlay()
  const overlay = mountOverlay(source)

  overlay.deliver(overlay.selfMessage(pointPayload()))
  overlay.flush()

  assert.equal(overlay.elements.cursor.classList.contains('hidden'), false)
  assert.equal(overlay.elements.cursorLabel.classList.contains('hidden'), false)
  assert.equal(overlay.elements.cursorLabel.textContent, 'Deploy')
  assert.equal(overlay.elements.cursor.style.left, '220px')
  assert.equal(overlay.elements.cursor.style.top, '320px')
})

test('the overlay accepts its own cursor:hide message and only that', async () => {
  const { source } = await loadOverlay()
  const overlay = mountOverlay(source)

  overlay.deliver({ source: {}, origin: 'null', data: { type: 'cursor:hide' } })
  overlay.deliver(overlay.selfMessage(pointPayload()))
  overlay.flush()
  assert.equal(overlay.elements.cursor.classList.contains('hidden'), false)

  overlay.deliver(overlay.selfMessage({ type: 'cursor:hide' }))
  assert.equal(overlay.elements.cursor.classList.contains('hidden'), true)
})

test('malformed self-delivered payloads are ignored', async () => {
  const { source } = await loadOverlay()
  const overlay = mountOverlay(source)

  const rejected = [
    undefined,
    null,
    'cursor:point',
    {},
    { type: 42 },
    { type: 'cursor:point' },
    { type: 'cursor:point', target: null },
    { type: 'cursor:point', target: { y: 10 } },
    { type: 'cursor:point', target: { x: '10', y: '20' } },
    { type: 'cursor:point', target: { x: Number.NaN, y: 20 } },
    { type: 'cursor:point', target: { x: 10, y: Number.POSITIVE_INFINITY } },
  ]

  for (const data of rejected) {
    overlay.deliver(overlay.selfMessage(data))
    overlay.flush()
    assert.equal(
      overlay.elements.cursor.classList.contains('hidden'),
      true,
      `payload should be rejected: ${JSON.stringify(data)}`,
    )
  }
})

test('a hostile label is set as text, never as markup', async () => {
  const { source } = await loadOverlay()
  const overlay = mountOverlay(source)
  const label = '<img src=x onerror="window.__pwned = true">'

  overlay.deliver(overlay.selfMessage(pointPayload(220, 320, label)))
  overlay.flush()

  const { cursorLabel } = overlay.elements
  assert.equal(cursorLabel.textContent, label)
  assert.equal(cursorLabel.innerHTML, undefined)
})

test('the overlay stays on its IPC bridge and never executes injected code', async () => {
  const { html, source } = await loadOverlay()

  // The IPC path from the preload bridge is the primary route and is kept.
  assert.match(source, /window\.electron\.cursor\.onPoint\(/)

  // js/missing-origin-check is satisfied only if the handler proves who sent the
  // message before it acts on it.
  assert.match(source, /event\.source === window/)
  assert.match(source, /event\.origin === SELF_ORIGIN/)

  assert.doesNotMatch(html, /\.innerHTML\s*=/)
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(/)
})