import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, isAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      active: user.active,
      createdAt: user.createdAt,
      jobTitle: user.jobTitle,
      profileId: user.profileId,
      setupComplete: Boolean(user.setupComplete),
    },
    isAdmin: isAdmin(user),
  })
}