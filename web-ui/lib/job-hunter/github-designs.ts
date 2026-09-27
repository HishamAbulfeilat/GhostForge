/**
 * GitHub profile designs.
 *
 * One AI call reads the CV and returns the person's content (headline,
 * about, skills, highlights, focus) plus which style suits them and why.
 * Five designs are then assembled from that content by code, each using
 * popular community README widgets (skillicons.dev, github-readme-stats,
 * streak stats, readme-typing-svg, capsule-render, activity graph). Widget
 * URLs are built here from the real username and skills — never by the
 * model — so every image resolves. An optional "creative" design lets the
 * model write a free-form README when the user asks for something different.
 */
import { extractJson } from './match'
import { getProfile, saveProfile, type GithubDesign, type GithubProfileDraft, type JobProfile } from './store'
import { fetchGithubData, type GithubRepoSummary } from './github-profile'

type Generate = (opts: { system?: string; prompt?: string; maxTokens?: number }) => Promise<string>

export const DESIGN_STYLES = [
  { id: 'minimal', name: 'Clean & minimal', blurb: 'Plain, fast to read, no images. Suits senior, research and leadership profiles.' },
  { id: 'badges', name: 'Badge wall', blurb: 'Tech-stack badges with stats cards. A classic developer profile.' },
  { id: 'terminal', name: 'Terminal', blurb: 'A `whoami` shell session with a typing header and dark cards. Suits engineers, DevOps and security.' },
  { id: 'visual', name: 'Visual showcase', blurb: 'Wave banner, skill icons, stats, streak and activity graph. Suits frontend, design and creative profiles.' },
  { id: 'story', name: 'Storyteller', blurb: 'A narrative about me with a career timeline. Suits managers, career changers and non-engineers.' },
] as const

export type DesignStyle = typeof DESIGN_STYLES[number]['id'] | 'creative'

export interface ProfileContent {
  name: string
  headline: string
  about: string[]
  typingLines: string[]
  skills: string[]
  highlights: string[]
  focus: string[]
  timeline: Array<{ period: string; role: string; org: string }>
  recommendedStyle: string
  why: string
  bio: string
  location: string
  company: string
  blog: string
}

// ── skill icons ─────────────────────────────────────────────────────────────

/** Skill name (normalized) → skillicons.dev id and simple-icons slug */
const SKILLS: Record<string, { icon: string; slug?: string; label: string }> = {
  javascript: { icon: 'js', slug: 'javascript', label: 'JavaScript' }, js: { icon: 'js', slug: 'javascript', label: 'JavaScript' },
  typescript: { icon: 'ts', slug: 'typescript', label: 'TypeScript' }, ts: { icon: 'ts', slug: 'typescript', label: 'TypeScript' },
  react: { icon: 'react', slug: 'react', label: 'React' }, 'react native': { icon: 'react', slug: 'react', label: 'React Native' },
  'next.js': { icon: 'nextjs', slug: 'nextdotjs', label: 'Next.js' }, nextjs: { icon: 'nextjs', slug: 'nextdotjs', label: 'Next.js' },
  vue: { icon: 'vue', slug: 'vuedotjs', label: 'Vue' }, angular: { icon: 'angular', slug: 'angular', label: 'Angular' },
  svelte: { icon: 'svelte', slug: 'svelte', label: 'Svelte' }, html: { icon: 'html', slug: 'html5', label: 'HTML' },
  css: { icon: 'css', slug: 'css', label: 'CSS' }, tailwind: { icon: 'tailwind', slug: 'tailwindcss', label: 'Tailwind CSS' },
  'tailwind css': { icon: 'tailwind', slug: 'tailwindcss', label: 'Tailwind CSS' }, sass: { icon: 'sass', slug: 'sass', label: 'Sass' },
  redux: { icon: 'redux', slug: 'redux', label: 'Redux' }, graphql: { icon: 'graphql', slug: 'graphql', label: 'GraphQL' },
  node: { icon: 'nodejs', slug: 'nodedotjs', label: 'Node.js' }, 'node.js': { icon: 'nodejs', slug: 'nodedotjs', label: 'Node.js' },
  nodejs: { icon: 'nodejs', slug: 'nodedotjs', label: 'Node.js' }, express: { icon: 'express', slug: 'express', label: 'Express' },
  nestjs: { icon: 'nestjs', slug: 'nestjs', label: 'NestJS' }, python: { icon: 'py', slug: 'python', label: 'Python' },
  django: { icon: 'django', slug: 'django', label: 'Django' }, flask: { icon: 'flask', slug: 'flask', label: 'Flask' },
  fastapi: { icon: 'fastapi', slug: 'fastapi', label: 'FastAPI' }, java: { icon: 'java', slug: 'openjdk', label: 'Java' },
  spring: { icon: 'spring', slug: 'spring', label: 'Spring' }, kotlin: { icon: 'kotlin', slug: 'kotlin', label: 'Kotlin' },
  swift: { icon: 'swift', slug: 'swift', label: 'Swift' }, go: { icon: 'go', slug: 'go', label: 'Go' }, golang: { icon: 'go', slug: 'go', label: 'Go' },
  rust: { icon: 'rust', slug: 'rust', label: 'Rust' }, 'c++': { icon: 'cpp', slug: 'cplusplus', label: 'C++' },
  'c#': { icon: 'cs', slug: 'dotnet', label: 'C#' }, '.net': { icon: 'dotnet', slug: 'dotnet', label: '.NET' },
  php: { icon: 'php', slug: 'php', label: 'PHP' }, laravel: { icon: 'laravel', slug: 'laravel', label: 'Laravel' },
  ruby: { icon: 'ruby', slug: 'ruby', label: 'Ruby' }, rails: { icon: 'rails', slug: 'rubyonrails', label: 'Rails' },
  dart: { icon: 'dart', slug: 'dart', label: 'Dart' }, flutter: { icon: 'flutter', slug: 'flutter', label: 'Flutter' },
  docker: { icon: 'docker', slug: 'docker', label: 'Docker' }, kubernetes: { icon: 'kubernetes', slug: 'kubernetes', label: 'Kubernetes' },
  aws: { icon: 'aws', slug: 'amazonwebservices', label: 'AWS' }, azure: { icon: 'azure', slug: 'microsoftazure', label: 'Azure' },
  gcp: { icon: 'gcp', slug: 'googlecloud', label: 'Google Cloud' }, terraform: { icon: 'terraform', slug: 'terraform', label: 'Terraform' },
  ansible: { icon: 'ansible', slug: 'ansible', label: 'Ansible' }, linux: { icon: 'linux', slug: 'linux', label: 'Linux' },
  git: { icon: 'git', slug: 'git', label: 'Git' }, 'github actions': { icon: 'githubactions', slug: 'githubactions', label: 'GitHub Actions' },
  jenkins: { icon: 'jenkins', slug: 'jenkins', label: 'Jenkins' }, nginx: { icon: 'nginx', slug: 'nginx', label: 'Nginx' },
  postgresql: { icon: 'postgres', slug: 'postgresql', label: 'PostgreSQL' }, postgres: { icon: 'postgres', slug: 'postgresql', label: 'PostgreSQL' },
  mysql: { icon: 'mysql', slug: 'mysql', label: 'MySQL' }, mongodb: { icon: 'mongodb', slug: 'mongodb', label: 'MongoDB' },
  redis: { icon: 'redis', slug: 'redis', label: 'Redis' }, firebase: { icon: 'firebase', slug: 'firebase', label: 'Firebase' },
  supabase: { icon: 'supabase', slug: 'supabase', label: 'Supabase' }, prisma: { icon: 'prisma', slug: 'prisma', label: 'Prisma' },
  tensorflow: { icon: 'tensorflow', slug: 'tensorflow', label: 'TensorFlow' }, pytorch: { icon: 'pytorch', slug: 'pytorch', label: 'PyTorch' },
  'scikit-learn': { icon: 'sklearn', slug: 'scikitlearn', label: 'scikit-learn' }, r: { icon: 'r', slug: 'r', label: 'R' },
  figma: { icon: 'figma', slug: 'figma', label: 'Figma' }, photoshop: { icon: 'ps', label: 'Photoshop' },
  illustrator: { icon: 'ai', label: 'Illustrator' }, blender: { icon: 'blender', slug: 'blender', label: 'Blender' },
  unity: { icon: 'unity', slug: 'unity', label: 'Unity' }, electron: { icon: 'electron', slug: 'electron', label: 'Electron' },
  vite: { icon: 'vite', slug: 'vite', label: 'Vite' }, jest: { icon: 'jest', slug: 'jest', label: 'Jest' },
  webpack: { icon: 'webpack', slug: 'webpack', label: 'Webpack' },
}

export function knownSkills(skills: string[]) {
  const seen = new Set<string>()
  const out: Array<{ icon: string; slug?: string; label: string }> = []
  for (const s of skills) {
    const hit = SKILLS[String(s).toLowerCase().trim()]
    if (hit && !seen.has(hit.icon + hit.label)) { seen.add(hit.icon + hit.label); out.push(hit) }
  }
  return out
}

// ── widgets (community README services) ─────────────────────────────────────

const enc = encodeURIComponent

export const widgets = {
  skillIcons: (skills: string[], theme: 'dark' | 'light' = 'dark') => {
    const ids = knownSkills(skills).map(s => s.icon)
    return ids.length ? `[![Skills](https://skillicons.dev/icons?i=${[...new Set(ids)].slice(0, 20).join(',')}&theme=${theme})](https://skillicons.dev)` : ''
  },
  badges: (skills: string[]) => {
    const known = knownSkills(skills)
    const unknown = skills.filter(s => !SKILLS[String(s).toLowerCase().trim()]).slice(0, 8)
    return [
      ...known.map(s => `![${s.label}](https://img.shields.io/badge/${enc(s.label.replace(/-/g, '--'))}-1f2937?style=for-the-badge${s.slug ? `&logo=${s.slug}&logoColor=white` : ''})`),
      ...unknown.map(s => `![${s}](https://img.shields.io/badge/${enc(String(s).replace(/-/g, '--'))}-1f2937?style=for-the-badge)`),
    ].join(' ')
  },
  // Services verified to render through GitHub's image proxy. github-readme-stats and
  // github-readme-activity-graph were replaced: their public instances return 502.
  // github-profile-summary-cards themes: github_dark, radical, tokyonight, dracula, nord_dark, ...
  stats: (u: string, theme = 'github_dark') => `![${u}'s GitHub stats](https://github-profile-summary-cards.vercel.app/api/cards/stats?username=${u}&theme=${theme})`,
  topLangs: (u: string, theme = 'github_dark') => `![Top languages](https://github-profile-summary-cards.vercel.app/api/cards/repos-per-language?username=${u}&theme=${theme})`,
  profileCard: (u: string, theme = 'github_dark') => `![${u}'s GitHub profile](https://github-profile-summary-cards.vercel.app/api/cards/profile-details?username=${u}&theme=${theme})`,
  streak: (u: string, theme = 'transparent') => `![GitHub streak](https://streak-stats.demolab.com?user=${u}&hide_border=true&theme=${theme})`,
  activity: (u: string, color = '38bdf8') => `![Contribution chart](https://ghchart.rshah.org/${color}/${u})`,
  typing: (lines: string[], color = '38BDF8') => lines.length
    ? `![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&size=22&pause=1000&color=${color}&center=true&vCenter=true&width=600&lines=${lines.slice(0, 4).map(l => enc(l.replace(/;/g, ','))).join(';')})`
    : '',
  banner: (text: string, sub: string) =>
    `![Header](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=180&section=header&text=${enc(text)}&fontSize=42&fontAlignY=35&desc=${enc(sub)}&descAlignY=55&animation=fadeIn)`,
  footer: () => '![Footer](https://capsule-render.vercel.app/api?type=waving&color=gradient&height=100&section=footer)',
  views: (u: string) => `![Profile views](https://komarev.com/ghpvc/?username=${u}&style=flat-square&color=38bdf8)`,
}

// ── content extraction ──────────────────────────────────────────────────────

const list = (v: unknown, max: number, len = 200) => (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x.trim()).slice(0, max).map(x => String(x).replace(/—/g, ' - ').slice(0, len))

/** Heuristic style for when the model's pick is missing or invalid */
export function heuristicStyle(skills: string[], headline: string): Exclude<DesignStyle, 'creative'> {
  const text = `${skills.join(' ')} ${headline}`.toLowerCase()
  if (/devops|sre|security|infrastructure|kubernetes|terraform|linux|backend|systems/.test(text)) return 'terminal'
  if (/design|ux|ui|frontend|front-end|figma|creative|animation|react|css/.test(text)) return 'visual'
  if (/manager|director|lead|head of|founder|ceo|cto|consultant|recruit|sales|marketing/.test(text)) return 'story'
  if (/research|scientist|phd|professor|analyst/.test(text)) return 'minimal'
  return 'badges'
}

export async function extractProfileContent(profile: JobProfile, repos: GithubRepoSummary[], notes: string, generate: Generate): Promise<ProfileContent> {
  if (!profile.cv) throw new Error('Upload your CV first')
  const out = await generate({
    system: `You prepare content for a person's GitHub profile README from their CV.
Use only facts from the CV and the notes. Never invent employers, dates, numbers or projects.
Also choose the README style that best fits the person's skills, field and personality:
minimal (research/senior/leadership, understated), badges (classic developer), terminal (backend/devops/security/hacker vibe),
visual (frontend/design/creative, expressive), story (managers, career changers, non-engineers).
Return ONLY JSON:
{"name": "first + last", "headline": "one line, max 80 chars", "about": ["2-4 short sentences"],
 "typingLines": ["3-4 very short phrases for an animated typing header"], "skills": ["technologies and tools, max 20"],
 "highlights": ["3-5 achievements from the CV"], "focus": ["2-3 things they're working on or learning, only if stated or in notes"],
 "timeline": [{"period": "2021 - Present", "role": "...", "org": "..."}],
 "recommendedStyle": "minimal|badges|terminal|visual|story", "why": "one sentence on why this style fits them",
 "bio": "GitHub bio, max 160 chars", "location": "", "company": "current employer or empty", "blog": "personal site from CV or empty"}`,
    prompt: `NOTES FROM THE USER:\n${notes.slice(0, 1500) || '(none)'}\n\nTHEIR REPOSITORIES:\n${repos.map(r => `- ${r.name} (${r.language || 'n/a'}): ${r.description}`).join('\n') || '(none)'}\n\nCV:\n${profile.cv.text.slice(0, 10000)}`,
    maxTokens: 1800,
  })
  const j = extractJson<Record<string, unknown>>(out)
  if (!j) throw new Error('The model did not return profile content — try again or pick another model')
  const a = profile.applicant
  const name = String(j.name || `${a.firstName} ${a.lastName}`).trim().slice(0, 80)
  const skills = list(j.skills, 20, 40)
  const headline = String(j.headline || '').replace(/—/g, ' - ').slice(0, 100)
  const ids = DESIGN_STYLES.map(s => s.id) as string[]
  const picked = ids.includes(String(j.recommendedStyle)) ? String(j.recommendedStyle) : heuristicStyle(skills, headline)
  return {
    name, headline, skills,
    about: list(j.about, 4, 400),
    typingLines: list(j.typingLines, 4, 50),
    highlights: list(j.highlights, 5, 300),
    focus: list(j.focus, 3, 150),
    timeline: (Array.isArray(j.timeline) ? j.timeline : []).slice(0, 6).map(t => {
      const x = (t || {}) as Record<string, unknown>
      return { period: String(x.period || '').slice(0, 40), role: String(x.role || '').slice(0, 80), org: String(x.org || '').slice(0, 80) }
    }).filter(t => t.role),
    recommendedStyle: picked,
    why: String(j.why || '').replace(/—/g, ' - ').slice(0, 300),
    bio: String(j.bio || headline).slice(0, 160),
    location: String(j.location || a.city || '').slice(0, 100),
    company: String(j.company || '').slice(0, 100),
    blog: String(j.blog || a.portfolio || '').slice(0, 200),
  }
}

// ── templates ───────────────────────────────────────────────────────────────

interface Ctx { c: ProfileContent; u: string; repos: GithubRepoSummary[]; contact: Array<{ label: string; url: string }> }

const first = (name: string) => name.split(/\s+/)[0] || name
const repoLine = (r: GithubRepoSummary) => `- **[${r.name}](${r.url})**${r.description ? ` - ${r.description}` : ''}${r.language ? ` \`${r.language}\`` : ''}`
const contactLine = (ctx: Ctx) => ctx.contact.map(x => `[${x.label}](${x.url})`).join(' · ')
const section = (title: string, body: string) => (body.trim() ? `## ${title}\n\n${body.trim()}\n` : '')

const TEMPLATES: Record<Exclude<DesignStyle, 'creative'>, (ctx: Ctx) => string> = {
  minimal: (ctx) => {
    const { c, repos } = ctx
    return [
      `# ${c.name}\n\n${c.headline}\n`,
      section('About', c.about.join(' ')),
      section('Selected work', c.highlights.map(h => `- ${h}`).join('\n')),
      section('Projects', repos.map(repoLine).join('\n')),
      section('Tools', c.skills.join(' · ')),
      section('Contact', contactLine(ctx)),
    ].filter(Boolean).join('\n')
  },

  badges: (ctx) => {
    const { c, u, repos } = ctx
    return [
      `# Hi, I'm ${first(c.name)} 👋\n\n**${c.headline}**\n`,
      section('About me', c.about.map(s => `- ${s}`).join('\n')),
      section('Tech stack', widgets.badges(c.skills)),
      section('Highlights', c.highlights.map(h => `- ${h}`).join('\n')),
      section('Featured projects', repos.map(repoLine).join('\n')),
      section('GitHub stats', `<p>\n  <img src="https://github-profile-summary-cards.vercel.app/api/cards/stats?username=${u}&theme=github_dark" height="165" />\n  <img src="https://github-profile-summary-cards.vercel.app/api/cards/repos-per-language?username=${u}&theme=github_dark" height="165" />\n</p>`),
      section('Get in touch', contactLine(ctx)),
    ].filter(Boolean).join('\n')
  },

  terminal: (ctx) => {
    const { c, u, repos } = ctx
    const shell = [
      '```bash',
      `$ whoami`,
      `${c.name} - ${c.headline}`,
      '',
      `$ cat about.txt`,
      ...c.about.map(s => `> ${s}`),
      '',
      `$ ls ./skills`,
      c.skills.join('  '),
      ...(c.focus.length ? ['', '$ cat now.txt', ...c.focus.map(f => `* ${f}`)] : []),
      '```',
    ].join('\n')
    return [
      `<div align="center">\n\n${widgets.typing([c.headline, ...c.typingLines], '00FF9C')}\n\n</div>\n`,
      shell + '\n',
      section('~/highlights', c.highlights.map(h => `- ${h}`).join('\n')),
      section('~/projects', repos.map(repoLine).join('\n')),
      section('~/toolbox', widgets.skillIcons(c.skills, 'dark')),
      section('~/stats', `${widgets.stats(u, 'radical')}\n\n${widgets.streak(u, 'radical')}`),
      section('~/contact', contactLine(ctx)),
    ].filter(Boolean).join('\n')
  },

  visual: (ctx) => {
    const { c, u, repos } = ctx
    return [
      widgets.banner(c.name, c.headline),
      `<div align="center">\n\n${widgets.typing(c.typingLines.length ? c.typingLines : [c.headline])}\n\n${contactLine(ctx)}\n\n</div>\n`,
      section('✨ About me', c.about.join(' ')),
      c.focus.length ? section('🔭 Right now', c.focus.map(f => `- ${f}`).join('\n')) : '',
      section('🛠️ Skills', `<div align="center">\n\n${widgets.skillIcons(c.skills, 'dark')}\n\n</div>`),
      section('🏆 Highlights', c.highlights.map(h => `- ${h}`).join('\n')),
      section('🚀 Projects', repos.map(repoLine).join('\n')),
      section('📊 Activity', `<div align="center">\n\n${widgets.profileCard(u, 'tokyonight')}\n\n${widgets.stats(u, 'tokyonight')}\n${widgets.topLangs(u, 'tokyonight')}\n\n${widgets.streak(u, 'tokyonight')}\n\n${widgets.activity(u, '7aa2f7')}\n\n</div>`),
      widgets.footer(),
    ].filter(Boolean).join('\n')
  },

  story: (ctx) => {
    const { c, repos } = ctx
    const table = c.timeline.length
      ? ['| When | Role | Where |', '|---|---|---|', ...c.timeline.map(t => `| ${t.period} | ${t.role} | ${t.org} |`)].join('\n')
      : ''
    return [
      `# ${c.name}\n\n> ${c.headline}\n`,
      section('My story', c.about.join('\n\n')),
      section('Along the way', table),
      section('What I\'m proud of', c.highlights.map(h => `- ${h}`).join('\n')),
      c.focus.length ? section('What I\'m doing now', c.focus.map(f => `- ${f}`).join('\n')) : '',
      section('Things I\'ve built', repos.map(repoLine).join('\n')),
      section('Toolkit', c.skills.join(', ')),
      section('Say hello', contactLine(ctx)),
    ].filter(Boolean).join('\n')
  },
}

export function renderDesign(style: Exclude<DesignStyle, 'creative'>, ctx: Ctx): string {
  return TEMPLATES[style](ctx).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** A free-form design written by the model, using the same verified content and widgets */
async function creativeDesign(ctx: Ctx, notes: string, generate: Generate): Promise<string> {
  const { c, u, repos } = ctx
  const out = await generate({
    system: `You are a creative designer of GitHub profile READMEs. Design something distinctive and tasteful that fits this person — layout, headings, emoji, tables, HTML <div align="center">, <details> sections are all fine.
Use ONLY the facts, repositories, links and widget snippets provided; do not invent facts or new image URLs.
Output only the README Markdown.`,
    prompt: `PERSON:\n${JSON.stringify({ name: c.name, headline: c.headline, about: c.about, highlights: c.highlights, focus: c.focus, timeline: c.timeline, skills: c.skills })}
NOTES / REQUEST FROM THE USER:\n${notes.slice(0, 1500) || '(be creative)'}
REPOSITORIES (use these links exactly):\n${repos.map(repoLine).join('\n') || '(none)'}
CONTACT LINKS:\n${contactLine(ctx) || '(none)'}
WIDGET SNIPPETS (use any, verbatim):
${[widgets.banner(c.name, c.headline), widgets.typing(c.typingLines), widgets.skillIcons(c.skills), widgets.badges(c.skills), widgets.profileCard(u), widgets.stats(u), widgets.topLangs(u), widgets.streak(u, 'dark'), widgets.activity(u), widgets.views(u), widgets.footer()].filter(Boolean).join('\n')}`,
    maxTokens: 3000,
  })
  const readme = out.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:markdown|md)?\s*|```\s*$/gi, '').replace(/—/g, ' - ').trim()
  if (readme.length < 120) throw new Error('The creative design came back empty — try again or pick another model')
  return readme + '\n'
}

function contactLinks(profile: JobProfile, blog: string): Array<{ label: string; url: string }> {
  const a = profile.applicant
  const https = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)
  return [
    a.linkedin && { label: 'LinkedIn', url: https(a.linkedin) },
    (a.portfolio || blog) && { label: 'Website', url: https(a.portfolio || blog) },
    a.email && { label: 'Email', url: `mailto:${a.email}` },
  ].filter(Boolean) as Array<{ label: string; url: string }>
}

// ── public API ──────────────────────────────────────────────────────────────

export interface DesignSet {
  designs: GithubDesign[]
  fields: Pick<GithubProfileDraft, 'bio' | 'location' | 'blog' | 'company'>
  username: string
}

/** Generate every template design (recommended first) and, if asked, a creative one */
export async function generateGithubDesigns(
  username: string,
  githubUser: string,
  opts: { notes?: string; creative?: boolean },
  generate: Generate,
): Promise<DesignSet> {
  const profile = await getProfile(username)
  const { user, repos } = await fetchGithubData(githubUser)
  const content = await extractProfileContent(profile, repos, opts.notes || '', generate)
  const ctx: Ctx = { c: content, u: user.login, repos, contact: contactLinks(profile, content.blog) }

  const designs: GithubDesign[] = DESIGN_STYLES.map(s => ({
    style: s.id,
    name: s.name,
    why: s.id === content.recommendedStyle ? (content.why || s.blurb) : s.blurb,
    recommended: s.id === content.recommendedStyle,
    readme: renderDesign(s.id, ctx),
  }))
  if (opts.creative) {
    designs.push({ style: 'creative', name: 'Creative (AI-designed)', why: 'A one-off design written for you by the AI.', recommended: false, readme: await creativeDesign(ctx, opts.notes || '', generate) })
  }
  designs.sort((a, b) => Number(b.recommended) - Number(a.recommended))

  const fields = { bio: content.bio, location: content.location, blog: content.blog, company: content.company }
  const recommended = designs.find(d => d.recommended) || designs[0]
  await saveProfile(username, {
    githubDesigns: designs,
    githubProfile: { username: user.login, readme: recommended.readme, ...fields, updatedAt: new Date().toISOString() },
  })
  return { designs, fields, username: user.login }
}

/** Load one of the generated designs into the editable draft */
export async function selectGithubDesign(username: string, style: string): Promise<GithubProfileDraft> {
  const p = await getProfile(username)
  const design = p.githubDesigns?.find(d => d.style === style)
  if (!design || !p.githubProfile) throw new Error('Generate designs first')
  const draft = { ...p.githubProfile, readme: design.readme, updatedAt: new Date().toISOString() }
  await saveProfile(username, { githubProfile: draft })
  return draft
}

/**
 * Render README Markdown to HTML with GitHub's own renderer, for previews.
 * The HTML is shown in a sandboxed iframe (no scripts) on the client.
 */
export async function renderPreview(markdown: string): Promise<string> {
  try {
    const res = await fetch('https://api.github.com/markdown', {
      method: 'POST',
      headers: { Accept: 'text/html', 'Content-Type': 'application/json', 'User-Agent': 'GhostForge-JobHunter', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ text: markdown.slice(0, 60_000), mode: 'gfm' }),
      signal: AbortSignal.timeout(15_000),
    })
    return res.ok ? await res.text() : ''
  } catch {
    return ''
  }
}
