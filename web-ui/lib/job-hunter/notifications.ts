import { sendToUser } from '../push'

/** In-app status is durable; push delivery depends on the user's subscriptions. */
export async function notifyJob(username: string, id: string, payload: { title: string; body: string }): Promise<'sent' | 'unavailable' | 'failed'> {
  try {
    const result = await sendToUser(username, { ...payload, tag: `job-hunter:${id}`, url: '/jobs' })
    if (result.delivered > 0) return 'sent'
    if (result.failed > 0) {
      console.warn('[Job Hunter] Blocker push delivery failed.')
      return 'failed'
    }
    return 'unavailable'
  } catch {
    console.warn('[Job Hunter] Notification unavailable; check the job status in the app.')
    return 'failed'
  }
}
