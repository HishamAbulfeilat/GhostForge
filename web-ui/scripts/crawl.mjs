#!/usr/bin/env node
/**
 * Crawl every page route of the running web UI: log in with the PIN, visit each
 * page, click nav links and main buttons, and report console errors, failed
 * requests (4xx/5xx), and internal links that point at routes which do not exist.
 *
 * Usage:  node scripts/crawl.mjs [baseUrl] [--json out.json]
 * Env:    GF_PIN (default 2001), GF_CRAWL_MAX_BUTTONS (default 12)
 *
 * Safety: during button clicks every non-GET request to /api is aborted (and
 * counted as "mutation attempted") so the crawl never changes real state, and
 * buttons whose label looks destructive are skipped.
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const jsonIdx = args.indexOf('--json')
const jsonOut = jsonIdx >= 0 ? args.splice(jsonIdx, 2)[1] : null
const BASE = (args[0] || 'http://localhost:3001').replace(/\/$/, '')
const PIN = process.env.GF_PIN || '2001'
const PAGE_BUDGET_MS = Number(process.env.GF_CRAWL_PAGE_BUDGET_MS || 90000)
const MAX_BUTTONS = Number(process.env.GF_CRAWL_MAX_BUTTONS || 12)
const DANGEROUS = /delete|remove|logout|log out|sign out|reset|clear|kill|stop|shutdown|shut down|restart|reboot|wipe|purge|uninstall|format|lock|sleep|send|submit|pay|buy/i

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app')

function findPages(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'api') continue
      findPages(p, out)
    } else if (/^page\.(tsx|jsx|ts|js)$/.test(e.name)) {
      out.push('/' + path.relative(appDir, dir).split(path.sep).join('/'))
    }
  }
  return out
}

const pageRoutes = findPages(appDir).map(r => (r === '/.' || r === '/' ? '/' : r.replace(/\/$/, ''))).sort()
const routeRegexes = pageRoutes.map(r => new RegExp('^' + r.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+') + '/?$'))
const routeExists = p => routeRegexes.some(re => re.test(p))
const staticRoutes = pageRoutes.filter(r => !r.includes('['))

const report = { base: BASE, pages: [], totals: {} }
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

const loginRes = await context.request.post(BASE + '/api/auth', { data: { pin: PIN } })
if (!loginRes.ok()) {
  console.error('login failed', loginRes.status())
  process.exit(2)
}

// A fresh profile is redirected to /setup from every page. With GF_CRAWL_COMPLETE_SETUP=1 the
// crawl finishes onboarding through the app's own /api/setup (use a throwaway USERPROFILE for the
// server so no real profile is modified); otherwise it only warns.
const me = await context.request.get(BASE + '/api/auth/me').then(r => r.json()).catch(() => null)
if (me?.user && !me.user.setupComplete) {
  if (process.env.GF_CRAWL_COMPLETE_SETUP === '1') {
    const r = await context.request.post(BASE + '/api/setup', { data: { name: 'Crawler', jobTitle: 'Software Engineer' } })
    console.log('setup completed for throwaway profile:', r.status())
  } else {
    console.warn('WARNING: profile has not completed /setup; every page will redirect there. Set GF_CRAWL_COMPLETE_SETUP=1 (with a throwaway USERPROFILE) to crawl real pages.')
  }
}

const IGNORE_CONSOLE = /ERR_BLOCKED_BY_CLIENT|favicon|Download the React DevTools|\[HMR\]|\[Fast Refresh\]/i

for (const [pageIdx, route] of staticRoutes.entries()) {
  const page = await context.newPage()
  const entry = { route, ok: true, consoleErrors: [], pageErrors: [], failedRequests: [], badLinks: [], buttons: { clicked: 0, noEffect: 0, mutationsBlocked: 0, skipped: 0 }, navClicks: [] }
  let phase = 'load'
  const failed = new Set()

  page.on('console', m => {
    if (m.type() === 'error' && !IGNORE_CONSOLE.test(m.text())) entry.consoleErrors.push(`[${phase}] ${m.text().slice(0, 300)}`)
  })
  page.on('pageerror', e => entry.pageErrors.push(`[${phase}] ${String(e.message || e).slice(0, 300)}`))
  page.on('response', r => {
    const s = r.status()
    if (s >= 400) {
      const key = `${s} ${r.request().method()} ${r.url().replace(BASE, '')}`
      if (!failed.has(key)) { failed.add(key); entry.failedRequests.push(key) }
    }
  })
  page.on('requestfailed', r => {
    const err = r.failure()?.errorText || ''
    if (/ERR_ABORTED|aborted|ERR_BLOCKED_BY_CLIENT/i.test(err)) return // navigations/SSE cancelled, or mutations we blocked on purpose
    const key = `FAIL ${r.method()} ${r.url().replace(BASE, '')} ${err}`
    if (!failed.has(key)) { failed.add(key); entry.failedRequests.push(key) }
  })

  // A page that hangs (stalled server, modal, endless handler) must not stall the whole crawl.
  let timedOut = false
  const deadline = new Promise(resolve => setTimeout(() => {
    timedOut = true
    entry.pageErrors.push(`crawl deadline exceeded (${PAGE_BUDGET_MS / 1000}s)`)
    resolve()
  }, PAGE_BUDGET_MS))
  if (process.env.GF_CRAWL_VERBOSE) console.log('... ' + route)
  await Promise.race([deadline, (async () => {
  try {
    const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    if (!resp || resp.status() >= 400) entry.failedRequests.push(`${resp?.status()} GET ${route} (document)`)
    if (new URL(page.url()).pathname === '/login' && route !== '/login') entry.consoleErrors.push('redirected to /login (auth lost)')

    // Internal links: must point at an existing page route.
    const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')))
    const internal = [...new Set(hrefs.filter(h => h && !/^(https?:|mailto:|tel:|javascript:|#)/.test(h)))]
    for (const h of internal) {
      const p = h.split('#')[0].split('?')[0]
      if (!p) continue
      if (p.startsWith('/api/') || p.startsWith('/_next') || /\.[a-z0-9]{2,5}$/i.test(p)) continue
      const abs = p.startsWith('/') ? p : new URL(p, BASE + route + '/').pathname
      if (!routeExists(abs)) entry.badLinks.push(h)
    }

    // Nav links: click each distinct internal link in nav/aside/header and verify it lands on a real page.
    const navHrefs = await page.$$eval('nav a[href], aside a[href], header a[href]', as => [...new Set(as.map(a => a.getAttribute('href')))])
    phase = 'nav'
    // The nav is one shared component: click every link on the first page, a sample elsewhere.
    const navLimit = pageIdx === 0 ? 60 : 4
    for (const h of navHrefs.filter(h => h && h.startsWith('/') && !h.startsWith('/api')).slice(0, navLimit)) {
      const p = h.split('#')[0].split('?')[0]
      if (!routeExists(p)) continue
      const before = entry.consoleErrors.length + entry.pageErrors.length
      try {
        const link = page.locator(`nav a[href="${h}"]:visible, aside a[href="${h}"]:visible, header a[href="${h}"]:visible`).first()
        await link.click({ timeout: 2500 })
        await page.waitForURL(u => new URL(u).pathname.replace(/\/$/, '') === p.replace(/\/$/, '') || new URL(u).pathname === '/login', { timeout: 6000 })
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
      } catch (e) {
        entry.navClicks.push(`nav link ${h} did not navigate: ${String(e.message).split('\n')[0]}`)
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => {})
      }
      if (entry.consoleErrors.length + entry.pageErrors.length > before) entry.navClicks.push(`errors after clicking ${h}`)
    }

    // Main buttons: click visible, enabled, non-destructive buttons; block mutating API calls.
    phase = 'click'
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    await page.route('**/api/**', r => {
      const m = r.request().method()
      if (m !== 'GET' && m !== 'HEAD' && !r.request().url().includes('/api/auth')) { entry.buttons.mutationsBlocked++; return r.abort('blockedbyclient') }
      return r.continue()
    })
    const buttons = page.locator('main button:visible, [role="main"] button:visible, body > div button:visible')
    const count = Math.min(await buttons.count(), 80)
    let clicked = 0
    for (let i = 0; i < count && clicked < MAX_BUTTONS; i++) {
      const b = buttons.nth(i)
      let label = ''
      try { label = ((await b.innerText({ timeout: 800 })) || (await b.getAttribute('aria-label')) || (await b.getAttribute('title')) || '').trim().slice(0, 40) } catch { continue }
      if (DANGEROUS.test(label)) { entry.buttons.skipped++; continue }
      if (!(await b.isEnabled().catch(() => false))) continue
      const urlBefore = page.url()
      const domBefore = await page.evaluate(() => document.body.innerHTML.length).catch(() => 0)
      let reqs = 0
      const onReq = () => { reqs++ }
      page.on('request', onReq)
      try {
        await b.click({ timeout: 2500, noWaitAfter: true })
        await page.waitForTimeout(350)
        clicked++
        entry.buttons.clicked++
        const domAfter = await page.evaluate(() => document.body.innerHTML.length).catch(() => domBefore)
        if (page.url() === urlBefore && domAfter === domBefore && reqs === 0) entry.buttons.noEffect++
      } catch { /* not clickable (overlay/detached) */ }
      page.off('request', onReq)
      if (new URL(page.url()).pathname !== new URL(urlBefore).pathname) {
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => {})
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
      }
    }
  } catch (e) {
    entry.pageErrors.push(`crawl exception: ${String(e.message).split('\n')[0]}`)
  }
  })()])
  if (timedOut) { page.close().catch(() => {}); await new Promise(r => setTimeout(r, 500)) }

  entry.ok = !entry.consoleErrors.length && !entry.pageErrors.length && !entry.failedRequests.length && !entry.badLinks.length && !entry.navClicks.length
  report.pages.push(entry)
  console.log(`${entry.ok ? 'OK  ' : 'FAIL'} ${route}  console=${entry.consoleErrors.length + entry.pageErrors.length} failedReq=${entry.failedRequests.length} badLinks=${entry.badLinks.length} nav=${entry.navClicks.length} btn=${entry.buttons.clicked}/noEffect ${entry.buttons.noEffect}`)
  for (const k of ['consoleErrors', 'pageErrors', 'failedRequests', 'badLinks', 'navClicks']) {
    for (const x of entry[k].slice(0, 6)) console.log(`      ${k}: ${x}`)
  }
  if (!timedOut) await page.close().catch(() => {})
}

const sum = k => report.pages.reduce((a, p) => a + p[k].length, 0)
report.totals = {
  pages: report.pages.length,
  pagesOk: report.pages.filter(p => p.ok).length,
  consoleErrors: sum('consoleErrors') + sum('pageErrors'),
  failedRequests: sum('failedRequests'),
  badLinks: sum('badLinks'),
  navFailures: sum('navClicks'),
}
console.log('\nTOTALS', JSON.stringify(report.totals))
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))])
process.exit(report.totals.pagesOk === report.totals.pages ? 0 : 1)
