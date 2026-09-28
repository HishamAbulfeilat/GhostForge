/**
 * GitHub profile setup from the user's CV.
 *
 * GitHub shows the README of the special repository `<login>/<login>` on the
 * user's profile page. This drafts that README (plus bio, location, website
 * and company) from the CV and the user's real public repositories, lets the
 * user review and edit it, then creates the repository if needed, commits the
 * README, and updates the profile fields.
 *
 * Tokens are passed per request and never stored or logged. Only
 * api.github.com is contacted.
 */
import { auditLog } from '../audit'
import { getProfile, saveProfile, type GithubProfileDraft } from './store'

const API = 'https://api.github.com'
const GH_USER = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i

export function validGithubUsername(u: string): boolean {
  return GH_USER.test(String(u || ''))
}

/**
 * Build an api.github.com URL from path segments. Every segment is validated
 * (usernames against GitHub's rules, the rest against a fixed allowlist) and
 * URL-encoded, and the result must stay on api.github.com — user input can
 * only ever select a GitHub account, never the host or a different endpoint.
 */
const FIXED_SEGMENTS = new Set(['user', 'users', 'repos', 'contents', 'README.md'])

export function githubApiUrl(segments: string[], query: Record<string, string> = {}): string {
  const parts = segments.map(s => {
    if (!FIXED_SEGMENTS.has(s) && !validGithubUsername(s)) throw new Error(`Invalid GitHub API path segment "${s}"`)
    return encodeURIComponent(s)
  })
  const url = new URL(`/${parts.join('/')}`, API)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  if (url.origin !== API) throw new Error('Refusing to call a host other than api.github.com')
  return url.toString()
}

async function gh<T>(segments: string[], init: RequestInit & { token?: string; query?: Record<string, string> } = {}): Promise<{ status: number; data: T | null }> {
  const { token, query, ...rest } = init
  const res = await fetch(githubApiUrl(segments, query), {
    ...rest,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GhostForge-JobHunter',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let data: T | null = null
  try { data = text ? JSON.parse(text) as T : null } catch { /* non-JSON */ }
  return { status: res.status, data }
}

export interface GithubRepoSummary { name: string; description: string; language: string; stars: number; url: string }
export interface GithubUserSummary { login: string; name: string; bio: string; location: string; blog: string; company: string; publicRepos: number }

/** Public profile + the user's best own (non-fork) repositories */
export async function fetchGithubData(username: string): Promise<{ user: GithubUserSummary; repos: GithubRepoSummary[] }> {
  if (!validGithubUsername(username)) throw new Error('That is not a valid GitHub username')
  const u = await gh<Record<string, unknown>>(['users', username])
  if (u.status === 404) throw new Error(`GitHub user "${username}" not found`)
  if (u.status !== 200 || !u.data) throw new Error(`GitHub returned ${u.status}`)
  const r = await gh<Array<Record<string, unknown>>>(['users', username, 'repos'], { query: { type: 'owner', sort: 'updated', per_page: '100' } })
  const repos = (r.data || [])
    .filter(x => !x.fork && !x.archived && String(x.name).toLowerCase() !== username.toLowerCase())
    .map(x => ({
      name: String(x.name), description: String(x.description || ''), language: String(x.language || ''),
      stars: Number(x.stargazers_count) || 0, url: String(x.html_url), pushed: String(x.pushed_at || ''),
    }))
    .sort((a, b) => b.stars - a.stars || b.pushed.localeCompare(a.pushed))
    .slice(0, 6)
    .map(r => ({ name: r.name, description: r.description, language: r.language, stars: r.stars, url: r.url }))
  const d = u.data
  return {
    user: {
      login: String(d.login), name: String(d.name || ''), bio: String(d.bio || ''), location: String(d.location || ''),
      blog: String(d.blog || ''), company: String(d.company || ''), publicRepos: Number(d.public_repos) || 0,
    },
    repos,
  }
}

export interface PublishResult {
  repoUrl: string
  profileUrl: string
  createdRepo: boolean
  profileUpdated: boolean
  notes: string[]
}

/** Create <login>/<login> if needed, commit the README, update profile fields */
export async function publishGithubProfile(
  username: string,
  token: string,
  draft: Pick<GithubProfileDraft, 'username' | 'readme' | 'bio' | 'location' | 'blog' | 'company'>,
  opts: { updateProfile?: boolean } = {},
): Promise<PublishResult> {
  if (!token) throw new Error('A GitHub token is required to publish')
  if (!draft.readme?.trim()) throw new Error('The README is empty')

  const me = await gh<{ login: string }>(['user'], { token })
  if (me.status === 401) throw new Error('GitHub rejected the token')
  if (me.status !== 200 || !me.data) throw new Error(`GitHub returned ${me.status} for the token`)
  const login = String(me.data.login)
  if (!validGithubUsername(login)) throw new Error('GitHub returned an unexpected account name')
  // The profile README only works in the repository named after the account
  if (login.toLowerCase() !== draft.username.toLowerCase()) {
    throw new Error(`The token belongs to "${login}", not "${draft.username}"`)
  }

  const notes: string[] = []
  let createdRepo = false
  const repo = await gh(['repos', login, login], { token })
  if (repo.status === 404) {
    const created = await gh(['user', 'repos'], {
      token, method: 'POST',
      body: JSON.stringify({ name: login, description: `${login}'s GitHub profile`, auto_init: true, has_issues: false, has_wiki: false, has_projects: false }),
    })
    if (created.status !== 201) throw new Error(`Could not create the ${login}/${login} repository (GitHub ${created.status}) — the token needs repository write access`)
    createdRepo = true
  } else if (repo.status !== 200) {
    throw new Error(`GitHub returned ${repo.status} for ${login}/${login}`)
  }

  const existing = await gh<{ sha: string }>(['repos', login, login, 'contents', 'README.md'], { token })
  const put = await gh(['repos', login, login, 'contents', 'README.md'], {
    token, method: 'PUT',
    body: JSON.stringify({
      message: createdRepo ? 'Set up profile README (GhostForge)' : 'Update profile README (GhostForge)',
      content: Buffer.from(draft.readme, 'utf8').toString('base64'),
      ...(existing.status === 200 && existing.data?.sha ? { sha: existing.data.sha } : {}),
    }),
  })
  if (put.status !== 200 && put.status !== 201) throw new Error(`Could not commit README.md (GitHub ${put.status})`)

  let profileUpdated = false
  if (opts.updateProfile !== false) {
    const fields = Object.fromEntries(Object.entries({ bio: draft.bio, location: draft.location, blog: draft.blog, company: draft.company }).filter(([, v]) => v))
    if (Object.keys(fields).length) {
      const patch = await gh(['user'], { token, method: 'PATCH', body: JSON.stringify(fields) })
      profileUpdated = patch.status === 200
      if (!profileUpdated) notes.push('Profile bio/location/website were not updated — the token needs the "user" scope (classic) or "Profile: write" (fine-grained).')
    }
  }

  const repoUrl = `https://github.com/${login}/${login}`
  const current = await getProfile(username)
  if (current.githubProfile) await saveProfile(username, { githubProfile: { ...current.githubProfile, ...draft, publishedAt: new Date().toISOString() } })
  void auditLog({ level: 'info', event: 'github_profile_published', params: { username, github: login, createdRepo, profileUpdated } })
  return { repoUrl, profileUrl: `https://github.com/${login}`, createdRepo, profileUpdated, notes }
}
