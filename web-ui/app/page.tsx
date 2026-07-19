import { redirect } from 'next/navigation'
import { isAuthenticatedSession } from '@/lib/auth'

export default function Home() {
  redirect(isAuthenticatedSession() ? '/chat' : '/login')
}
