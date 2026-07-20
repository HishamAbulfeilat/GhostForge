import { redirect } from 'next/navigation'
import { isAuthenticatedSession } from '@/lib/auth'

export default async function Home() {
  redirect((await isAuthenticatedSession()) ? '/chat' : '/login')
}
