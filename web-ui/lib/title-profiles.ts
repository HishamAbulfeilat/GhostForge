/**
 * Job-title access profiles.
 *
 * The setup wizard asks each user for their job title and grants the matching
 * profile's permissions. Pages are gated by the same permissions (PAGE_ACCESS),
 * so the navbar, the page guard and the API checks always agree. Admins hold
 * '*' and see everything regardless of title.
 *
 * Shared by client and server — keep this file free of Node imports.
 */

export interface TitleProfile {
  id: string
  label: string
  description: string
  /** Lower-case keywords matched as whole words against the title */
  keywords: string[]
  permissions: string[]
}

/** Everyone gets these, whatever their title */
export const BASE_PERMISSIONS = [
  'chat', 'conversation_history', 'web_search', 'weather', 'voice', 'semantic_memory',
  'reminders', 'calendar', 'contacts', 'clipboard', 'career', 'job_hunter',
]

const FILES = ['file_read', 'file_write', 'file_process', 'documents']
const ENGINEERING = [...FILES, 'terminal', 'github', 'copilot', 'code_helper', 'ai_models', 'mcp', 'browser', 'system_info']
const COMMS = ['email', 'send_message', 'user_message']

/**
 * Order matters: the first profile whose keyword matches wins, so specific
 * titles ("DevOps Engineer", "Data Engineer", "Engineering Manager") are
 * listed before the generic engineer profile.
 */
export const TITLE_PROFILES: TitleProfile[] = [
  {
    id: 'devops',
    label: 'DevOps / IT & Infrastructure',
    description: 'Full engineering toolkit plus remote access, system control and automation.',
    keywords: ['devops', 'sre', 'site reliability', 'platform', 'infrastructure', 'sysadmin', 'system administrator', 'systems administrator', 'cloud', 'it', 'network', 'security engineer', 'it support', 'helpdesk'],
    permissions: [...ENGINEERING, 'remote', 'mac_control', 'native_desktop', 'screenshots', 'admin_tools', 'n8n'],
  },
  {
    id: 'data',
    label: 'Data & AI',
    description: 'Files, code helper, AI models and AI Studio for analysis work.',
    keywords: ['data', 'analyst', 'analytics', 'scientist', 'machine learning', 'ml', 'ai engineer', 'bi', 'statistician', 'research scientist'],
    permissions: [...FILES, 'code_helper', 'ai_models', 'ai_studio', 'mcp', 'github', 'browser', 'terminal'],
  },
  {
    id: 'designer',
    label: 'Design & Creative',
    description: 'Files, browser, screenshots and AI Studio for design work.',
    keywords: ['designer', 'design', 'ux', 'ux researcher', 'user researcher', 'graphic', 'creative', 'illustrator', 'art director', 'video', 'photographer'],
    permissions: [...FILES, 'browser', 'screenshots', 'youtube', 'ai_studio'],
  },
  {
    id: 'people',
    label: 'HR & Recruiting',
    description: 'Documents, messaging and career tools for hiring work.',
    keywords: ['hr', 'human resources', 'recruiter', 'recruiting', 'talent', 'people', 'hiring'],
    permissions: [...FILES, ...COMMS],
  },
  {
    id: 'sales',
    label: 'Sales & Marketing',
    description: 'Email, messaging, documents and browser for outreach.',
    keywords: ['sales', 'marketing', 'business development', 'account executive', 'account manager', 'growth', 'seo', 'content', 'social media', 'brand'],
    permissions: [...FILES, ...COMMS, 'browser', 'youtube'],
  },
  {
    id: 'support',
    label: 'Support & Operations',
    description: 'Messaging, documents and workflows for day-to-day operations.',
    keywords: ['support', 'customer success', 'customer service', 'operations', 'assistant', 'office', 'coordinator', 'receptionist', 'administrator'],
    permissions: [...FILES, ...COMMS, 'n8n', 'browser'],
  },
  {
    id: 'finance',
    label: 'Finance & Legal',
    description: 'Documents, files and email.',
    keywords: ['finance', 'accountant', 'accounting', 'controller', 'auditor', 'bookkeeper', 'legal', 'lawyer', 'paralegal', 'counsel'],
    permissions: [...FILES, 'email'],
  },
  {
    id: 'manager',
    label: 'Management & Leadership',
    description: 'Documents, messaging, workflows and GitHub visibility.',
    keywords: ['manager', 'management', 'director', 'head of', 'lead', 'vp', 'chief', 'ceo', 'cto', 'coo', 'cfo', 'founder', 'owner', 'executive', 'product owner', 'scrum master', 'project'],
    permissions: [...FILES, ...COMMS, 'n8n', 'browser', 'github', 'system_info'],
  },
  {
    id: 'engineer',
    label: 'Software Engineering',
    description: 'Terminal, files, GitHub, Copilot, code helper and AI models.',
    keywords: ['engineer', 'engineering', 'developer', 'programmer', 'software', 'frontend', 'front end', 'backend', 'back end', 'full stack', 'fullstack', 'mobile', 'web', 'qa', 'tester', 'architect'],
    permissions: ENGINEERING,
  },
  {
    id: 'student',
    label: 'Student & Job Seeker',
    description: 'Career tools, the Job Hunter, documents and learning resources.',
    keywords: ['student', 'intern', 'graduate', 'job seeker', 'unemployed', 'looking for work', 'trainee', 'apprentice'],
    permissions: ['documents', 'file_read', 'file_process', 'browser', 'youtube'],
  },
  {
    id: 'general',
    label: 'General',
    description: 'Chat, search, reminders, career tools and the Job Hunter.',
    keywords: [],
    permissions: [],
  },
]

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Best profile for a free-text job title (falls back to General) */
export function profileForTitle(title: string): TitleProfile {
  const t = ` ${String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  for (const profile of TITLE_PROFILES) {
    if (profile.keywords.some(k => new RegExp(` ${escapeRe(k)} `).test(t))) return profile
  }
  return TITLE_PROFILES[TITLE_PROFILES.length - 1]
}

export function getProfile(id: string): TitleProfile | undefined {
  return TITLE_PROFILES.find(p => p.id === id)
}

/** Full permission set granted for a profile (base + profile-specific, de-duplicated) */
export function permissionsForProfile(profile: TitleProfile): string[] {
  return [...new Set([...BASE_PERMISSIONS, ...profile.permissions])]
}

// ── Page access ──────────────────────────────────────────────────────────────

export interface PageAccess {
  path: string
  label: string
  icon: string
  /** Permission required; null = any signed-in user; 'admin' = admins only */
  permission: string | null
  nav?: boolean
}

export const PAGE_ACCESS: PageAccess[] = [
  { path: '/jarvis',      label: 'JARVIS',      icon: '🤖', permission: 'chat' },
  { path: '/chat',        label: 'Chat',        icon: '💬', permission: 'chat', nav: true },
  { path: '/jobs',        label: 'Jobs',        icon: '🎯', permission: 'job_hunter', nav: true },
  { path: '/terminal',    label: 'Terminal',    icon: '🖥️', permission: 'terminal', nav: true },
  { path: '/maintenance', label: 'Maintenance', icon: '🛠️', permission: 'terminal', nav: true },
  { path: '/dashboard',   label: 'Dashboard',   icon: '📊', permission: 'system_info', nav: true },
  { path: '/agents',      label: 'Agents',       icon: '🤝', permission: 'admin_tools', nav: true },
  { path: '/media-tools', label: 'Media',       icon: '▶️', permission: 'youtube', nav: true },
  { path: '/files',       label: 'Files',      icon: '🗂️', permission: 'file_read', nav: true },
  { path: '/features',    label: 'Features',    icon: '⚡', permission: 'chat', nav: true },
  { path: '/orchestrate', label: 'Orchestrate', icon: '🧠', permission: 'code_helper', nav: true },
  // 'workflows' isn't a real permission key — the catalog calls this 'n8n' (see permissions.ts)
  { path: '/workflows',   label: 'Workflows',   icon: '🗺️', permission: 'n8n', nav: true },
  { path: '/automation',  label: 'Automation',  icon: '🔁', permission: 'n8n' },
  { path: '/mac-control', label: 'Control',     icon: '🕹️', permission: 'mac_control' },
  { path: '/remote',      label: 'Remote',      icon: '📡', permission: 'remote' },
  { path: '/models',      label: 'Models',      icon: '🧩', permission: 'ai_models' },
  { path: '/history',     label: 'History',     icon: '🕘', permission: 'conversation_history' },
  { path: '/users',       label: 'Users',       icon: '👥', permission: 'admin', nav: true },
  { path: '/marketplace', label: 'Market',      icon: '🏪', permission: 'ai_models', nav: true },
  { path: '/settings',    label: 'Settings',    icon: '⚙️', permission: null, nav: true },
  { path: '/setup',       label: 'Setup',       icon: '🧭', permission: null },
]

export interface AccessSubject {
  role: 'admin' | 'user'
  permissions: string[]
}

export function canAccessPage(user: AccessSubject | null | undefined, pathname: string): boolean {
  const page = PAGE_ACCESS.find(p => pathname === p.path || pathname.startsWith(p.path + '/'))
  if (!page) return true // pages outside the catalog (login, home) aren't gated here
  if (!user) return false
  if (user.role === 'admin') return true
  if (page.permission === null) return true
  if (page.permission === 'admin') return false
  return user.permissions.includes(page.permission)
}

export function allowedPages(user: AccessSubject | null | undefined): PageAccess[] {
  return PAGE_ACCESS.filter(p => canAccessPage(user, p.path))
}
