/**
 * Runs once when the Next.js server starts. Starts the Job Hunter autopilot
 * scheduler (Node runtime only; GF_JOB_AUTOPILOT=0 disables it).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startAutopilotScheduler } = await import('./lib/job-hunter/autopilot')
    startAutopilotScheduler()
  }
}
