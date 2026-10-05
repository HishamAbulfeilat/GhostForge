import { NextRequest, NextResponse } from 'next/server'
import { hostedGuard } from '@/lib/hosted'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { auditLog } from '@/lib/audit'
import {
  TEMPLATES,
  getTemplate,
  isTemplateId,
  listProjects,
  runScaffold,
  validateProjectName,
} from './runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// One scaffolder run at a time per server process: create-next-app and friends
// are heavy, and two runs would race on the same node_modules caches.
let scaffoldInProgress = false

async function requireAdmin(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (!isAdmin(me)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { me }
}

/** GET — the registered projects and the templates they can be scaffolded from. */
export async function GET(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const { error } = await requireAdmin(req)
  if (error) return error
  return NextResponse.json({ projects: listProjects(), templates: TEMPLATES })
}

/**
 * POST { template, name } — scaffold a new project.
 *
 * `template` must be one of the allow-listed ids and `name` must be a plain
 * folder name; neither reaches a command line (the wizard is driven on stdin,
 * and the argv holds only the server-resolved script path).
 */
export async function POST(req: NextRequest) {
  const hostedBlock = hostedGuard(req)
  if (hostedBlock) return hostedBlock
  const { me, error } = await requireAdmin(req)
  if (error) return error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Body must be an object' }, { status: 400 })
  }
  const keys = Object.keys(body).sort()
  if (keys.length !== 2 || keys[0] !== 'name' || keys[1] !== 'template') {
    return NextResponse.json(
      { error: 'Send exactly { "template": "<id>", "name": "<folder-name>" }' },
      { status: 400 },
    )
  }

  const { template, name } = body as { template: unknown; name: unknown }
  if (!isTemplateId(template)) {
    return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
  }
  const validName = validateProjectName(name)
  if (!validName.value) {
    return NextResponse.json({ error: validName.error }, { status: 400 })
  }

  if (scaffoldInProgress) {
    return NextResponse.json({ error: 'A scaffold is already in progress' }, { status: 409 })
  }
  scaffoldInProgress = true
  try {
    const result = await runScaffold(getTemplate(template).id, validName.value)
    void auditLog({
      level: 'info',
      event: 'project_scaffold',
      tool: template,
      params: { user: me.username },
      result: result.status,
    })
    return NextResponse.json(result)
  } finally {
    scaffoldInProgress = false
  }
}