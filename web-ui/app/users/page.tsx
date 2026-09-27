'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PERMISSIONS_BY_GROUP, PERMISSION_GROUPS, DEFAULT_USER_PERMISSIONS, type PermissionDef } from '@/lib/permissions'
import type { DeviceRecord } from '@/lib/devices'

interface PublicUser {
  id: string
  name: string
  username: string
  role: 'admin' | 'user'
  permissions: string[]
  active: boolean
  createdAt: string
  lastSeen?: string
  owner?: boolean
}

interface EditState {
  userId: string
  permissions: string[]
  role: 'admin' | 'user'
}

type EditFunction = EditState

const GROUP_LABELS: Record<string, string> = {
  core: 'Core', search: 'Search & Info', files: 'Files & Documents', messaging: 'Messaging',
  system: 'System & Mac Control', productivity: 'Productivity', ai: 'AI Power',
}

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<PublicUser[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  // Only the owner may change users; other admins get a read-only view
  const [canManage, setCanManage] = useState(false)
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<EditFunction | null>(null)
  const [creating, setCreating] = useState(false)
  const [devicesByUser, setDevicesByUser] = useState<Record<string, DeviceRecord[]>>({})
  const [devicesOpen, setDevicesOpen] = useState<string | null>(null)

  // New user form
  const [nuName, setNuName] = useState('')
  const [nuUsername, setNuUsername] = useState('')
  const [nuPassword, setNuPassword] = useState('')
  const [nuRole, setNuRole] = useState<'user' | 'admin'>('user')
  const [nuPerms, setNuPerms] = useState<string[]>(DEFAULT_USER_PERMISSIONS)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      if (res.status === 403) { setForbidden(true); setLoading(false); return }
      if (!res.ok) { setMessage('Failed to load users'); setLoading(false); return }
      const data = await res.json()
      setUsers(data.users)
      setCanManage(Boolean(data.canManage))
    } catch {
      setMessage('Unable to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const togglePerm = (key: string) => {
    if (!editing) return
    const perms = editing.permissions.includes(key)
      ? editing.permissions.filter(p => p !== key)
      : [...editing.permissions, key]
    setEditing({ ...editing, permissions: perms })
  }

  const toggleNuPerm = (key: string) => {
    setNuPerms(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key])
  }

  const saveEdits = async () => {
    if (!editing) return
    setMessage('')
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editing.userId, permissions: editing.permissions, role: editing.role }),
    })
    if (res.ok) { setMessage('Saved'); setEditing(null); void load() }
    else { const d = await res.json().catch(() => null); setMessage(d?.error || 'Failed to save') }
  }

  const create = async () => {
    setMessage('')
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nuName, username: nuUsername, password: nuPassword,
          role: nuRole, permissions: nuRole === 'admin' ? ['*'] : nuPerms, active: true,
        }),
      })
      if (res.ok) {
        setMessage('User created')
        setCreating(false); setNuName(''); setNuUsername(''); setNuPassword(''); setNuRole('user'); setNuPerms(DEFAULT_USER_PERMISSIONS)
        void load()
      } else {
        const d = await res.json().catch(() => null); setMessage(d?.error || 'Failed to create user')
      }
    } catch { setMessage('Unable to create user') }
  }

  const toggleActive = async (u: PublicUser) => {
    setMessage('')
    const res = await fetch('/api/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, active: !u.active }),
    })
    if (res.ok) { void load() } else { const d = await res.json().catch(() => null); setMessage(d?.error || 'Failed') }
  }

  const deleteUser = async (u: PublicUser) => {
    setMessage('')
    if (!confirm(`Delete user ${u.name} (${u.username})?`)) return
    const res = await fetch(`/api/users?id=${u.id}`, { method: 'DELETE' })
    if (res.ok) { void load() } else { const d = await res.json().catch(() => null); setMessage(d?.error || 'Failed') }
  }

  const resetPassword = async (u: PublicUser) => {
    const pw = prompt(`New password for ${u.username}:`)
    if (!pw) return
    setMessage('')
    const res = await fetch('/api/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, password: pw }),
    })
    if (res.ok) setMessage('Password updated')
    else { const d = await res.json().catch(() => null); setMessage(d?.error || 'Failed to update password') }
  }

  const toggleDevices = async (u: PublicUser) => {
    if (devicesOpen === u.username) { setDevicesOpen(null); return }
    try {
      const res = await fetch(`/api/devices?user=${u.username}`)
      if (!res.ok) { setMessage('Failed to load devices'); return }
      const data = await res.json() as { devices: DeviceRecord[] }
      setDevicesByUser(prev => ({ ...prev, [u.username]: data.devices || [] }))
      setDevicesOpen(u.username)
    } catch { setMessage('Unable to load devices') }
  }

  const removeDevice = async (username: string, id: string) => {
    setMessage('')
    if (!confirm('Remove this device record?')) return
    const res = await fetch(`/api/devices?user=${username}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) { setDevicesByUser(prev => ({ ...prev, [username]: (prev[username]||[]).filter(d => d.id !== id) })) }
    else { const d = await res.json().catch(() => null); setMessage(d?.error || 'Failed to remove') }
  }

  if (forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
        <div className="max-w-sm rounded-2xl border border-red-900/40 bg-gray-900 p-8 text-center">
          <div className="text-4xl">🚫</div>
          <h1 className="mt-2 text-lg font-semibold text-white">Access denied</h1>
          <p className="mt-1 text-sm text-gray-400">Only an administrator can view this page.</p>
          <button onClick={() => router.push('/chat')} className="mt-4 rounded-xl bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700">Back to chat</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">👥 Users</h1>
            <p className="text-sm text-gray-400">{canManage ? 'Manage GhostForge accounts and permissions' : 'Read-only — only the owner can change users and permissions'}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/chat"><span className="rounded-xl bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700">← Chat</span></Link>
            {canManage && (
              <button onClick={() => setCreating(!creating)} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">
                {creating ? 'Cancel' : '+ New user'}
              </button>
            )}
          </div>
        </div>

        {message ? <p className="mb-4 rounded-xl bg-gray-900 px-4 py-2 text-sm text-sky-300">{message}</p> : null}

        {creating && canManage && (
          <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <h3 className="mb-3 font-semibold text-white">New user</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={nuName} onChange={e => setNuName(e.target.value)} placeholder="Full name" className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 outline-none" />
              <input value={nuUsername} onChange={e => setNuUsername(e.target.value)} placeholder="Username" className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 outline-none" />
              <input value={nuPassword} onChange={e => setNuPassword(e.target.value)} placeholder="Password (min 8 characters)" type="password" className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 outline-none" />
              <select value={nuRole} onChange={e => setNuRole(e.target.value as 'user' | 'admin')} className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-white outline-none">
                <option value="user">User (limited)</option>
                <option value="admin">Admin (full access)</option>
              </select>
            </div>

            {nuRole === 'user' && (
              <div className="mt-4">
                <p className="mb-2 text-sm text-gray-400">Permissions</p>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {allPermissionDefs().map(p => (
                    <label key={p.key} className="flex items-center gap-2 text-sm text-gray-300">
                      <input type="checkbox" checked={nuPerms.includes(p.key)} onChange={() => toggleNuPerm(p.key)}
                        className="h-4 w-4 rounded border-gray-600 accent-sky-500" />
                      {p.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => void create()} className="mt-4 rounded-xl bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500">Create user</button>
          </div>
        )}

        {loading ? <p className="text-gray-500">Loading…</p> : (
          <div className="space-y-3">
            {users.map(u => (
              <div key={u.id} className={`rounded-2xl border p-5 ${u.active ? 'border-gray-800 bg-gray-900' : 'border-gray-800/50 bg-gray-900/40 opacity-70'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-sky-900/60 text-lg font-bold text-sky-200">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-white">
                        {u.name} <span className="text-gray-500">@{u.username}</span>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${u.role === 'admin' ? 'bg-amber-900/60 text-amber-300' : 'bg-blue-900/60 text-blue-300'}`}>{u.role}</span>
                        {u.owner && <span className="rounded-md bg-emerald-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">owner</span>}
                        <span className={`h-2 w-2 rounded-full ${u.active ? 'bg-emerald-400' : 'bg-red-400'}`} title={u.active ? 'Active' : 'Inactive'} />
                      </div>
                      <div className="text-xs text-gray-500">
                        {u.lastSeen ? `Last seen ${new Date(u.lastSeen).toLocaleString()}` : 'Never logged in'}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {canManage && !u.owner && (
                      <button onClick={() => setEditing(u.role === 'admin' ? { userId: u.id, permissions: ['*'], role: 'admin' } : { userId: u.id, permissions: u.permissions, role: 'user' })}
                        className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">Permissions</button>
                    )}
                    <button onClick={() => void toggleDevices(u)} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">
                      {devicesOpen === u.username ? 'Hide devices' : 'Devices'}
                    </button>
                    {canManage && (
                      <button onClick={() => void resetPassword(u)} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">Reset password</button>
                    )}
                    {canManage && !u.owner && (
                      <>
                        <button onClick={() => void toggleActive(u)} className={`rounded-lg px-3 py-1.5 text-xs ${u.active ? 'bg-amber-900/40 text-amber-200 hover:bg-amber-900/60' : 'bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/60'}`}>
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => void deleteUser(u)} className="rounded-lg bg-red-900/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/60">Delete</button>
                      </>
                    )}
                  </div>
                </div>

                {canManage && editing && editing.userId === u.id && (
                  <PermissionEditor editing={editing} setEditing={setEditing} onSave={() => void saveEdits()} />
                )}

                {devicesOpen === u.username && (
                  <DevicePanel devices={devicesByUser[u.username] || []} onRemove={canManage ? id => void removeDevice(u.username, id) : undefined} />
                )}
              </div>
            ))}
            {users.length === 0 && <p className="text-gray-500">No users yet. Create the first user above.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function PermissionEditor({ editing, setEditing, onSave }: { editing: EditFunction; setEditing: (e: EditFunction | null) => void; onSave: () => void }) {
  if (editing.role === 'admin') {
    return (
      <div className="mt-4 rounded-xl border border-amber-900/40 bg-amber-950/20 p-4">
        <p className="text-sm text-amber-200">Admins have full access to everything. To restrict, switch the role to <b>User</b>.</p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => setEditing({ ...editing, role: 'user', permissions: DEFAULT_USER_PERMISSIONS })} className="rounded-lg bg-amber-800/60 px-3 py-1.5 text-xs text-white hover:bg-amber-800">Switch to limited user</button>
          <button onClick={onSave} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500">Save changes</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
      {PERMISSION_GROUPS.map(group => {
        const defs = PERMISSIONS_BY_GROUP[group] || []
        if (!defs.length) return null
        return (
          <div key={group} className="mb-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{GROUP_LABELS[group] || group}</p>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {defs.map(p => (
                <label key={p.key} className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={editing.permissions.includes(p.key)}
                    onChange={() => { const exists = editing.permissions.includes(p.key); setEditing({ ...editing, permissions: exists ? editing.permissions.filter(x => x !== p.key) : [...editing.permissions, p.key] }) }}
                    className="h-4 w-4 rounded border-gray-600 accent-sky-500" />
                  <span title={p.description}>{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
      <div className="mt-2 flex gap-2">
        <button onClick={() => setEditing({ ...editing, permissions: DEFAULT_USER_PERMISSIONS })} className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">Restore defaults</button>
        <button onClick={onSave} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white hover:bg-sky-500">Save permissions</button>
      </div>
    </div>
  )
}

function allPermissionDefs(): PermissionDef[] {
  return PERMISSION_GROUPS.flatMap(g => PERMISSIONS_BY_GROUP[g] || [])
}

function platformIcon(p?: string): string {
  switch (p) {
    case 'mac': return '🖥'
    case 'windows': return '🪟'
    case 'linux': return '🐧'
    case 'ios': return '📱'
    case 'android': return '🤖'
    default: return '🌐'
  }
}

function DevicePanel({ devices, onRemove }: { devices: DeviceRecord[]; onRemove?: (id: string) => void }) {
  if (!devices.length) {
    return (
      <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
        <p className="text-sm text-gray-500">No devices linked yet. They appear automatically when this user signs in from a browser.</p>
      </div>
    )
  }
  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Linked devices ({devices.length})</p>
      <div className="space-y-2">
        {devices.map(d => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="text-lg">{platformIcon(d.platform)}</span>
              <div>
                <div className="flex items-center gap-2 text-sm text-white">
                  {d.name}
                  {d.isLocal && <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[9px] uppercase text-emerald-300" title="Same machine as server">local</span>}
                  {d.current && <span className="rounded bg-sky-900/50 px-1.5 py-0.5 text-[9px] uppercase text-sky-300" title="Currently active session">current</span>}
                </div>
                <div className="text-xs text-gray-500">
                  {d.browser ? `${d.browser} · ` : ''}
                  IP {d.ip}
                  {d.mac ? ` · MAC ${d.mac}` : ''}
                  {d.model && d.model !== d.name ? ` · ${d.model}` : ''}
                  {d.hostname ? ` · ${d.hostname}` : ''}
                </div>
                {d.details && Object.keys(d.details).length > 0 && (
                  <div className="mt-0.5 text-[11px] text-gray-600">
                    {Object.entries(d.details).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                  </div>
                )}
                <div className="text-[11px] text-gray-600">First {new Date(d.firstSeen).toLocaleString()} · Last {new Date(d.lastSeen).toLocaleString()}</div>
              </div>
            </div>
            {onRemove && <button onClick={() => onRemove(d.id)} className="rounded-lg bg-red-900/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/60">Remove</button>}
          </div>
        ))}
      </div>
    </div>
  )
}