import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin } from '@/lib/auth'
import { isFreeTierSyncable, syncFreeKeysToOmniRoute, syncProviderToOmniRoute } from '@/lib/omniroute-sync'
import { PROVIDERS, isProviderId, keySource, saveProviderKey } from '@/lib/providers'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/models/keys — admin only. Keys are never returned to the browser.
 *   { provider, key }   save a provider API key ("" clears it); a saved key
 *                       overrides the environment. Free-tier keys are also
 *                       registered with OmniRoute.
 *   { action: 'sync' }  re-register every free-tier key with OmniRoute
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUser(req)
  if (!me || !isAdmin(me)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { provider?: unknown; key?: unknown; action?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.action === 'sync') {
    return NextResponse.json({ ok: true, omniroute: await syncFreeKeysToOmniRoute() })
  }

  if (!isProviderId(body.provider) || !PROVIDERS[body.provider].keyEnv) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }
  const key = typeof body.key === 'string' ? body.key.trim() : ''
  if (key.length > 500 || /\s/.test(key)) {
    return NextResponse.json({ error: 'That does not look like an API key' }, { status: 400 })
  }

  try {
    saveProviderKey(body.provider, key)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Cannot save key' }, { status: 500 })
  }

  const omniroute = isFreeTierSyncable(body.provider) ? await syncProviderToOmniRoute(body.provider) : null
  return NextResponse.json({ ok: true, keySource: keySource(body.provider), omniroute })
}
