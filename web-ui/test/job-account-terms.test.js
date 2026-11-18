// Account sign-in assistance stops for real consent (terms checkboxes and
// toggles, "I agree" buttons, "By creating an account you agree…" wording) but
// not for the "Terms" / "Privacy Policy" links in the footer of almost every
// sign-in page. Runs on a jsdom stand-in for the page, so no browser is needed.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname } = require('node:path')
const ts = require('typescript')
const { JSDOM } = require('jsdom')

const home = mkdtempSync(join(tmpdir(), 'gf-job-account-terms-'))
process.env.HOME = home
process.env.USERPROFILE = home
const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) } catch (error) {
      if (specifier.startsWith('.')) {
        for (const suffix of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + suffix, context) } catch { /* next suffix */ }
        }
      }
      throw error
    }
  },
})
function load(file, dependencies) {
  const filename = join(__dirname, file)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(dirname(filename))
  const near = Module.createRequire(filename)
  loaded.require = request => Object.hasOwn(dependencies, request) ? dependencies[request] : near(request)
  loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename)
  return loaded.exports
}
const accounts = load('../lib/job-hunter/accounts.ts', {
  './notifications': { notifyJob: async () => 'unavailable' },
  './apply': { withProfileLock: (_key, fn) => fn(), resolvesPublicly: async () => true },
})
test.after(() => {
  hooks.deregister()
  rmSync(home, { recursive: true, force: true })
})

/** The parts of a Playwright Page that accountBlocker uses, over a jsdom document. */
function fakePage(html) {
  const { window } = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://careers.example.com/login', pretendToBeVisual: true })
  const doc = window.document
  const hidden = el => el && el.nodeType === 1 && (window.getComputedStyle(el).display === 'none' || el.hidden
    || el.style.position === 'absolute' && el.style.opacity === '0' && el.style.width === '1px' || hidden(el.parentElement))
  window.Element.prototype.getBoundingClientRect = function () {
    return hidden(this) ? { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 } : { width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 }
  }
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', { get() { return this.textContent }, configurable: true })
  window.CSS ??= {}
  window.CSS.escape ??= s => String(s).replace(/["\\]/g, '\\$&')
  const inPage = fn => {
    const globals = { document: doc, window, getComputedStyle: window.getComputedStyle.bind(window), CSS: window.CSS }
    const saved = {}
    for (const k of Object.keys(globals)) {
      saved[k] = Object.getOwnPropertyDescriptor(globalThis, k)
      Object.defineProperty(globalThis, k, { value: globals[k], configurable: true, writable: true })
    }
    try { return fn() } finally {
      for (const k of Object.keys(globals)) {
        if (saved[k]) Object.defineProperty(globalThis, k, saved[k])
        else delete globalThis[k]
      }
    }
  }
  return {
    evaluate: async (fn, arg) => inPage(() => fn(arg)),
    locator: sel => ({
      count: async () => doc.querySelectorAll(sel.replace(/:visible/g, '')).length,
      // Like a browser's innerText: block elements end a line.
      innerText: async () => {
        const clone = doc.querySelector(sel).cloneNode(true)
        clone.querySelectorAll('p, div, form, footer, nav, header, li, section, button, label').forEach(el => el.append('\n'))
        return clone.textContent
      },
    }),
    getByLabel: () => ({ filter: () => ({ count: async () => 0 }) }),
  }
}

const loginForm = `<form method="post" action="/session">
  <label>Email<input type="email" name="email"></label>
  <label>Password<input type="password"></label>
  <label><input type="checkbox" name="remember"> Remember me</label>
  <button>Sign in</button></form>`
const footer = `<footer><nav><a href="/terms">Terms</a> · <a href="/privacy">Privacy Policy</a> · <a href="/legal">User Agreement</a>
  · <a href="/terms">Terms of Service</a> · <button>Your Privacy Choices</button> · <a href="/cookies">Cookie settings</a></nav>
  <p>© 2026 Example Careers. All rights reserved.</p></footer>`
const cookieBanner = `<div class="banner"><div><p>We use cookies to improve your experience. By continuing to browse, you agree to our use of cookies.</p>
  <button>Accept</button><button>Accept all cookies</button><button>Reject</button></div></div>`

test('footer and navigation links to Terms / Privacy Policy no longer block sign-in assistance', async () => {
  assert.equal(await accounts.accountBlocker(fakePage(loginForm + footer)), null)
  assert.equal(await accounts.accountBlocker(fakePage(loginForm + footer + cookieBanner)), null, 'a cookie banner is not account consent')
  assert.equal(await accounts.accountBlocker(fakePage(`<header><a href="/privacy">Privacy</a></header>${loginForm}<p>Read our <a href="/privacy">privacy notice</a>.</p>`)), null)
})

test('real consent still stops assistance: terms checkboxes, styled toggles, I agree buttons and implicit wording', async () => {
  const cases = {
    'terms checkbox': `${loginForm}<label><input type="checkbox" name="tos"> I agree to the <a href="/terms">Terms of Service</a></label>`,
    'checkbox with label[for]': `${loginForm}<input type="checkbox" id="pp"><label for="pp">Privacy policy</label>`,
    'styled checkbox (input hidden, label shown)': `${loginForm}<label><input type="checkbox" style="position:absolute;opacity:0;width:1px"><span>Accept the terms and conditions</span></label>`,
    'toggle switch': `${loginForm}<div role="switch" aria-checked="false" aria-label="Consent to data processing"></div>`,
    'I agree button': `${loginForm}<div class="modal"><p>Updated terms</p><button>I agree</button></div>`,
    'agree and continue button': `${loginForm.replace('<button>Sign in</button>', '<button>Agree and continue</button>')}`,
    'implicit wording': `${loginForm}<p>By creating an account, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>${footer}`,
    'implicit sign-in wording': `${loginForm}<p>By signing in you accept the updated terms.</p>`,
    'explicit statement': `${loginForm}<p>I have read and agree to the candidate privacy statement.</p>`,
    'Accept button inside the sign-in form': `${loginForm.replace('<button>Sign in</button>', '<p>We use cookies.</p><button>Accept</button>')}`,
  }
  for (const [name, html] of Object.entries(cases)) {
    assert.match(await accounts.accountBlocker(fakePage(html)) || '', /Terms or privacy consent require your review/, name)
  }
})

test('captcha and verification still come first', async () => {
  assert.match(await accounts.accountBlocker(fakePage(`${loginForm}<div id="captcha"></div>${footer}`)), /Captcha/)
  assert.match(await accounts.accountBlocker(fakePage(`${loginForm}<p>Check your email for a verification code</p>`)), /verification/)
})

test('the terms rule itself: wording that agrees, never bare link text', () => {
  const none = { toggles: [], buttons: [] }
  for (const text of ['Terms', 'Privacy Policy', 'User Agreement', 'Terms of Use | Privacy notice | Accessibility', 'By continuing to browse, you agree to our use of cookies.',
    'Your use of this site is subject to our Terms.', 'Read the privacy statement before applying.'])
    assert.equal(accounts.termsConsent(text, none), false, text)
  for (const text of ['By registering you agree to our privacy policy', 'By clicking Sign in, you agree to the Terms.', 'I accept the terms', 'I consent to the processing of my data'])
    assert.equal(accounts.termsConsent(text, none), true, text)
  assert.equal(accounts.termsConsent('', { toggles: ['Remember me', 'Show password', 'Keep me signed in'], buttons: ['Sign in', 'Your Privacy Choices', 'Accept all cookies', 'Accept (cookie notice)'] }), false)
  assert.equal(accounts.termsConsent('', { toggles: ['I acknowledge the candidate privacy notice'], buttons: [] }), true)
  assert.equal(accounts.termsConsent('', { toggles: ['Electronic signature'], buttons: [] }), true, 'signatures are the user\'s too')
  assert.equal(accounts.termsConsent('', { toggles: [], buttons: ['Accept terms'] }), true)
  assert.equal(accounts.termsConsent('', { toggles: [], buttons: ['I agree'] }), true)
})
