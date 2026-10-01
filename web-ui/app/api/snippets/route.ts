import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { getCurrentUser } from '@/lib/auth'
import { repoRootFromLib } from '@/lib/agent-team-api'

export const dynamic = 'force-dynamic'

// Fixed repo-root documents; the `doc` query param may only name one of these.
const DOCS = ['CHANGELOG.md', 'README.md'] as const
const SNIPPETS_DIR = 'snippets'
const SNIPPET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_FILE_BYTES = 256 * 1024

function readRegularFile(root: string, relative: string): string | null {
  const target = path.join(root, relative)
  let fd: number | undefined
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null
    return fs.readFileSync(fd, 'utf8')
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function listSnippets(root: string): string[] {
  try {
    return fs.readdirSync(path.join(root, SNIPPETS_DIR), { withFileTypes: true })
      .filter(entry => entry.isFile() && SNIPPET_NAME.test(entry.name))
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request)
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })

  const root = repoRootFromLib()
  const params = request.nextUrl?.searchParams ?? new URL(request.url).searchParams
  const doc = params.get('doc')
  const snippet = params.get('snippet')

  if (doc !== null && snippet !== null) {
    return NextResponse.json({ error: 'Specify only one of doc or snippet.' }, { status: 400 })
  }

  if (doc !== null) {
    if (!(DOCS as readonly string[]).includes(doc)) {
      return NextResponse.json({ error: 'Unknown document.' }, { status: 404 })
    }
    const content = readRegularFile(root, doc)
    if (content === null) return NextResponse.json({ error: 'Document unavailable.' }, { status: 404 })
    return NextResponse.json({ name: doc, content })
  }

  if (snippet !== null) {
    if (!SNIPPET_NAME.test(snippet) || !listSnippets(root).includes(snippet)) {
      return NextResponse.json({ error: 'Unknown snippet.' }, { status: 404 })
    }
    const content = readRegularFile(root, `${SNIPPETS_DIR}/${snippet}`)
    if (content === null) return NextResponse.json({ error: 'Snippet unavailable.' }, { status: 404 })
    return NextResponse.json({ name: snippet, content })
  }

  return NextResponse.json({ docs: DOCS, snippets: listSnippets(root) })
}
