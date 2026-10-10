/**
 * Runs once when the Next.js server starts. Starts the Job Hunter autopilot
 * scheduler (Node runtime only; GF_JOB_AUTOPILOT=0 disables it).
 *
 * Hosted mode (GHOSTFORGE_MODE=hosted): refuses to start without AUTH_SECRET
 * and ADMIN_PASSWORD, removes the server's own integration secrets from the
 * environment, and does not start the autopilot (it drives a browser on the host).
 */
export async function register() {
  // Keep the NEXT_RUNTIME === 'nodejs' block shape: Next drops it from the Edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { isHostedMode, assertHostedConfig, scrubOwnerSecrets } = await import('./lib/hosted')
    if (isHostedMode()) {
      assertHostedConfig()
      const removed = scrubOwnerSecrets()
      if (removed.length) console.warn(`[hosted] ignoring server secrets from the environment: ${removed.join(', ')}`)
    } else {
      const { startAutopilotScheduler } = await import('./lib/job-hunter/autopilot')
      startAutopilotScheduler()
      // Confirmed batch applications continue after a restart
      if (process.env.NODE_ENV !== 'test') {
        const { resumeApplyBatches } = await import('./lib/job-hunter/batch')
        void resumeApplyBatches().catch(() => {})
        const { startFollowUpReminders } = await import('./lib/job-hunter/pipeline')
        startFollowUpReminders()
      }
    }
  }
}
