const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { chromium } = require('playwright-core')

let browser
const assets = join(__dirname, '../../electron-app/android-web')
test.before(async () => { browser = await chromium.launch({ headless: true }) })
test.after(async () => { await browser?.close() })

for (const [device, width, height] of [['Android phone', 393, 851], ['tablet', 768, 1024], ['desktop', 1440, 900]]) {
  test(`studio connection and Job Hunter are reachable on ${device}`, async () => {
    const context = await browser.newContext({ viewport: { width, height } })
    const page = await context.newPage()
    try {
      await page.route('https://client.ghostforge.test/**', route => {
        const script = route.request().url().endsWith('/studio.js')
        return route.fulfill({ contentType: script ? 'application/javascript' : 'text/html', body: readFileSync(join(assets, script ? 'studio.js' : 'studio.html'), 'utf8') })
      })
      await page.route('https://server.ghostforge.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Job Hunter sign in</h1>' }))
      await page.goto('https://client.ghostforge.test/studio.html')
      assert.equal(await page.getByRole('heading', { name: 'GhostForge Studio', exact: true }).isVisible(), true)
      assert.equal(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth), true)
      await page.getByLabel('Your GhostForge web server URL').fill('https://server.ghostforge.test')
      await page.getByRole('button', { name: 'Job Hunter', exact: true }).click()
      await page.waitForURL('https://server.ghostforge.test/jobs')
      await page.goBack()
      assert.equal(await page.getByLabel('Your GhostForge web server URL').inputValue(), 'https://server.ghostforge.test')
    } finally { await context.close() }
  })
}

test('desktop launcher surfaces connection errors and restores its buttons', async () => {
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.addInitScript(() => {
      window.ghostforgeStudio = {
        getUrl: async () => 'https://server.ghostforge.test',
        connect: async () => { throw new Error('Server is not running') },
      }
    })
    await page.route('https://client.ghostforge.test/**', route => {
      const script = route.request().url().endsWith('/studio.js')
      return route.fulfill({ contentType: script ? 'application/javascript' : 'text/html', body: readFileSync(join(assets, script ? 'studio.js' : 'studio.html'), 'utf8') })
    })
    await page.goto('https://client.ghostforge.test/studio.html')
    await page.getByRole('button', { name: 'Job Hunter', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Server is not running'))
    assert.equal(await page.getByRole('button', { name: 'Job Hunter', exact: true }).isEnabled(), true)
    await page.getByLabel('Your GhostForge web server URL').fill('https://user:password@server.ghostforge.test')
    await page.getByRole('button', { name: 'Open studio', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('without credentials'))
    await page.goto('https://client.ghostforge.test/studio.html?error=Could%20not%20connect%3A%20ERR_CONNECTION_REFUSED')
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ERR_CONNECTION_REFUSED'))
    assert.equal(await page.getByRole('button', { name: 'Job Hunter', exact: true }).isEnabled(), true)
  } finally { await context.close() }
})
