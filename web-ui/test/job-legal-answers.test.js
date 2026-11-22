// Legal eligibility and history questions: no fixed rule and no AI answer.
// Only the user's own answer (saved, or for this one job) fills them; otherwise
// they come back to the user as questions. Ordinary questions are unaffected.
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const fakeHome = mkdtempSync(join(tmpdir(), 'gf-legal-answers-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.NODE_ENV = 'test'

const hooks = Module.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      if (specifier.startsWith('.')) {
        for (const ext of ['.ts', '.js', '/index.ts']) {
          try { return nextResolve(specifier + ext, context) } catch { /* next */ }
        }
      }
      throw err
    }
  },
})

const writer = require('../lib/job-hunter/writer.ts')

test.after(() => {
  hooks.deregister()
  rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

// Lives in Japan, NOT authorized to work there, needs sponsorship
const profile = {
  cv: { text: 'Jane Example\nSenior Engineer | Acme KK | 2021 - Present', fileName: 'cv.pdf', filePath: '/tmp/cv.pdf', uploadedAt: '' },
  applicant: {
    firstName: 'Jane', lastName: 'Example', email: 'jane@example.com', phone: '+81 90 0000 0000', city: 'Tokyo', country: 'Japan',
    linkedin: '', github: '', portfolio: '', workAuthorized: 'no', needsSponsorship: 'yes', howHeard: 'Job board',
  },
  preferences: { titles: [], locations: [], remote: 'any', minSalary: null, mustHaves: [], niceToHaves: [], dealbreakers: [], companies: [] },
  customAnswers: {},
  updatedAt: '',
}
const job = (extra = {}) => ({ id: 'j1', title: 'Engineer', company: 'Beta', location: 'Tokyo, Japan', description: '', coverLetter: '', ...extra })

const LEGAL = [
  // citizenship / immigration status: where they live is not their citizenship
  'Country of citizenship', 'Nationality', 'Are you a US citizen?', 'Are you a permanent resident or green card holder?',
  'Do you hold a valid UK visa?', 'Visa status', 'Do you currently hold a work permit for Germany?', 'What is your immigration status?',
  // "which country" is not a Yes/No the profile can answer
  'Country you are authorized to work in', 'Countries where you are legally authorized to work',
  'Are you a U.S. citizen or authorized to work in the U.S.?',
  // age, licence, clearance, export control
  'Are you over 18?', 'Are you at least 18 years of age?', 'Are you 18 or older?', 'Are you of legal working age?',
  "Do you have a valid driver's license?", 'Do you have an active security clearance?', 'Are you a U.S. person under export control regulations?',
  // criminal and employment history
  'Have you ever been convicted of a crime?', 'Have you ever pleaded guilty to an offence?',
  'Have you ever been terminated or asked to resign from a job?', 'Have you previously applied to Beta?',
  'Have you applied for a position with us before?', 'Do you have relatives working at Beta?',
  'Are you bound by a non-compete agreement?',
]

test('legal eligibility and history questions get no fixed-rule answer and are never sent to the AI', () => {
  for (const label of LEGAL) {
    assert.equal(writer.answerFor(label, profile, job()), '', label)
    assert.equal(writer.needsUserAnswer(label), true, label)
  }
})

test('ordinary questions are still answered or left to the AI as before', () => {
  const a = l => writer.answerFor(l, profile, job())
  assert.equal(a('Country'), 'Japan')
  assert.equal(a('Country of residence'), 'Japan')
  assert.equal(a('Current location'), 'Tokyo, Japan')
  assert.equal(a('Full name'), 'Jane Example')
  // Sponsorship wording that mentions a visa is still the sponsorship rule (own country only)
  assert.equal(a('Will you now or in the future require sponsorship for an employment visa?'), 'Yes')
  assert.equal(a('Do you require a work visa to work in Japan?'), 'Yes')
  assert.equal(a('Are you legally authorized to work in Japan?'), 'No')
  for (const label of ['Years of experience with React', 'Do you have at least 10 years of experience with Python?', 'Notice period',
    'Are you willing to relocate?', 'Salary expectations', 'Have you worked with relational databases?', 'Why do you want to join Beta?'])
    assert.equal(writer.needsUserAnswer(label), false, label)
})

test('the user\'s own answers fill them: saved answers carry over, employer-specific ones stay with the job', () => {
  const saved = { ...profile, customAnswers: { 'Country of citizenship': 'Jordan', 'Have you previously applied to this company?': 'No', 'Do you hold a visa for this country?': 'No' } }
  assert.equal(writer.answerFor('Country of citizenship', saved, job()), 'Jordan')
  assert.equal(writer.reusableAnswer('Country of citizenship'), true)
  // Depends on the employer or where the job is: never carried to another application
  assert.equal(writer.answerFor('Have you previously applied to this company?', saved, job()), '')
  assert.equal(writer.reusableAnswer('Have you previously applied to this company?'), false)
  assert.equal(writer.answerFor('Do you hold a visa for this country?', saved, job()), '')
  assert.equal(writer.reusableAnswer('Do you hold a visa for this country?'), false)
  assert.equal(writer.reusableAnswer('Do you have relatives working here?'), false)
  // The answer the user gave for this one job is used for it
  const j = job({ jobAnswers: { 'Have you previously applied to this company?': 'Yes' } })
  assert.equal(writer.answerFor('Have you previously applied to this company?', profile, j), 'Yes')
})
