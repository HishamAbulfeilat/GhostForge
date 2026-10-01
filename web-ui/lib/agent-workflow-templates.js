const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const MAX_TEMPLATES = 50
const MAX_TEMPLATE_BYTES = 8192
const MAX_STORAGE_BYTES = 128 * 1024
const TEMPLATE_KINDS = Object.freeze(['feature', 'bugfix', 'security', 'performance', 'refactor', 'test', 'docs', 'chore'])
const WORKFLOW_MODES = Object.freeze(['ordered', 'parallel'])
const TEMPLATE_KEYS = Object.freeze(['name', 'title', 'kind', 'leader', 'assignee', 'workflow', 'dependencies', 'acceptanceCriteria'])
const SAVED_KEYS = Object.freeze([...TEMPLATE_KEYS, 'id', 'createdAt'])
const locks = new Map()

class AgentWorkflowTemplateError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'AgentWorkflowTemplateError'
    this.status = status
  }
}

function withLock(key, callback) {
  const previous = locks.get(key) || Promise.resolve()
  const next = previous.then(callback, callback)
  locks.set(key, next.catch(() => {}))
  return next
}

function safeUsername(username) {
  if (typeof username !== 'string' || !username.trim() || username.length > 128) {
    throw new AgentWorkflowTemplateError('A valid admin account is required.', 400)
  }
  return crypto.createHash('sha256').update(username.trim().toLowerCase()).digest('hex')
}

function storageFile(username, storageRoot = path.join(os.homedir(), '.ghostforge', 'agent-workflow-templates')) {
  return path.join(storageRoot, `${safeUsername(username)}.json`)
}

function ownKeysExactly(value, expected) {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every(key => expected.includes(key))
}

function safeText(value, field, maxLength) {
  if (typeof value !== 'string') throw new AgentWorkflowTemplateError(`${field} must be text.`)
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new AgentWorkflowTemplateError(`${field} must be 1-${maxLength} characters without control characters.`)
  }
  return text
}

function safeIdentity(value, field) {
  const text = safeText(value, field, 64)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) {
    throw new AgentWorkflowTemplateError(`${field} contains unsupported characters.`)
  }
  return text
}

function normalizeTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ownKeysExactly(input, TEMPLATE_KEYS)) {
    throw new AgentWorkflowTemplateError('Template must contain exactly the supported fields.')
  }

  const name = safeText(input.name, 'Template name', 80)
  const title = safeText(input.title, 'Task title', 180)
  if (title.startsWith('-')) throw new AgentWorkflowTemplateError('Task title cannot start with a dash.')
  if (!TEMPLATE_KINDS.includes(input.kind)) throw new AgentWorkflowTemplateError('Template task kind is unsupported.')
  if (!WORKFLOW_MODES.includes(input.workflow)) throw new AgentWorkflowTemplateError('Template workflow mode is unsupported.')
  const leader = safeIdentity(input.leader, 'Workflow leader')
  const assignee = safeIdentity(input.assignee, 'Workflow assignee')

  if (!Array.isArray(input.dependencies) || input.dependencies.length > 20) {
    throw new AgentWorkflowTemplateError('Dependencies must be a list of at most 20 task IDs.')
  }
  const dependencies = input.dependencies.map((entry, index) => {
    const dependency = safeText(entry, `Dependency ${index + 1}`, 64)
    if (!/^[A-Za-z0-9][A-Za-z0-9._#-]*$/.test(dependency)) {
      throw new AgentWorkflowTemplateError(`Dependency ${index + 1} contains unsupported characters.`)
    }
    return dependency
  })
  if (new Set(dependencies).size !== dependencies.length) {
    throw new AgentWorkflowTemplateError('Dependencies cannot contain duplicates.')
  }

  if (!Array.isArray(input.acceptanceCriteria) || input.acceptanceCriteria.length > 20) {
    throw new AgentWorkflowTemplateError('Acceptance criteria must be a list of at most 20 items.')
  }
  const acceptanceCriteria = input.acceptanceCriteria.map((entry, index) => safeText(entry, `Acceptance criterion ${index + 1}`, 240))

  return { name, title, kind: input.kind, leader, assignee, workflow: input.workflow, dependencies, acceptanceCriteria }
}

function normalizeSavedTemplate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !ownKeysExactly(input, SAVED_KEYS)) {
    throw new Error('Stored workflow template has an invalid shape.')
  }
  const normalized = normalizeTemplate(Object.fromEntries(TEMPLATE_KEYS.map(key => [key, input[key]])))
  if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id)) {
    throw new Error('Stored workflow template has an invalid ID.')
  }
  if (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) {
    throw new Error('Stored workflow template has an invalid timestamp.')
  }
  return { ...normalized, id: input.id, createdAt: input.createdAt }
}

function readAll(username, storageRoot) {
  const file = storageFile(username, storageRoot)
  let fd
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    fd = fs.openSync(file, flags)
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_STORAGE_BYTES) {
      throw new Error('Stored workflow templates exceed the storage limit or are not a regular file.')
    }
    const raw = fs.readFileSync(fd, 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_STORAGE_BYTES) {
      throw new Error('Stored workflow templates exceed the storage limit.')
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1 || !Array.isArray(parsed.templates) || parsed.templates.length > MAX_TEMPLATES) {
      throw new Error('Stored workflow templates have an invalid format.')
    }
    return parsed.templates.map(normalizeSavedTemplate)
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw new Error('Unable to read workflow templates: stored data is invalid or unavailable.')
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function writeAll(username, templates, storageRoot) {
  const file = storageFile(username, storageRoot)
  const encoded = JSON.stringify({ version: 1, templates })
  if (Buffer.byteLength(encoded, 'utf8') > MAX_STORAGE_BYTES) {
    throw new AgentWorkflowTemplateError('Workflow template storage limit reached.', 413)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, encoded, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, file)
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error
    }
  }
}

function listAgentWorkflowTemplates(username, storageRoot) {
  return readAll(username, storageRoot).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function getAgentWorkflowTemplate(username, id, storageRoot) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) {
    throw new AgentWorkflowTemplateError('Template ID is invalid.')
  }
  return readAll(username, storageRoot).find(template => template.id === id) || null
}

async function saveAgentWorkflowTemplate(username, input, storageRoot) {
  const template = normalizeTemplate(input)
  const file = storageFile(username, storageRoot)
  return withLock(file, () => {
    const templates = readAll(username, storageRoot)
    if (templates.length >= MAX_TEMPLATES) {
      throw new AgentWorkflowTemplateError(`At most ${MAX_TEMPLATES} workflow templates can be saved.`, 413)
    }
    if (templates.some(existing => existing.name.toLowerCase() === template.name.toLowerCase())) {
      throw new AgentWorkflowTemplateError('A template with that name already exists.', 409)
    }
    const saved = { ...template, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    const next = [...templates, saved]
    const encoded = JSON.stringify({ version: 1, templates: next })
    if (Buffer.byteLength(encoded, 'utf8') > MAX_STORAGE_BYTES || Buffer.byteLength(JSON.stringify(saved), 'utf8') > MAX_TEMPLATE_BYTES) {
      throw new AgentWorkflowTemplateError('Workflow template storage limit reached.', 413)
    }
    writeAll(username, next, storageRoot)
    return saved
  })
}

module.exports = {
  AgentWorkflowTemplateError,
  MAX_TEMPLATES,
  MAX_TEMPLATE_BYTES,
  MAX_STORAGE_BYTES,
  listAgentWorkflowTemplates,
  getAgentWorkflowTemplate,
  saveAgentWorkflowTemplate,
}
