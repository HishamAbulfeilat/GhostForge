#!/usr/bin/env node
import { parseArgs, startWorld, stopWorld, statusWorld, setupWorld, WORLDS } from './lib.mjs'

const HELP = `Usage: ghostforge worlds <start|stop|status|setup> [ai-town|agent-office|all] [--json]

  setup   clone the pinned upstream into apps/worlds/<name>/checkout/ and install it
  start   launch the world on 127.0.0.1 (pid files in the agent state dir)
  stop    stop the world's processes
  status  show pid and port state (bounded 1s probe on 127.0.0.1)

Worlds: ${Object.keys(WORLDS).join(', ')}. LLM access: local Ollama (OLLAMA_HOST) or the
GhostForge gateway env (OMNIROUTE_URL / OMNIROUTE_API_KEY); no keys are stored.`

export async function main(argv) {
  let args
  try { args = parseArgs(argv) } catch (err) { console.error(`${err.message}\n\n${HELP}`); return 2 }
  if (args.help) { console.log(HELP); return 0 }
  try {
    if (args.action === 'status') {
      const results = []
      for (const name of args.worlds) results.push(await statusWorld(name))
      if (args.json) {
        console.log(JSON.stringify(results, null, 2))
      } else {
        for (const r of results) {
          console.log(`${r.world}${r.installed ? '' : ' (not set up)'}`)
          for (const s of r.services) {
            console.log(`  ${s.service.padEnd(8)} ${s.host}:${s.port}  ${s.state}${s.pid ? ` (pid ${s.pid})` : ''}`)
          }
        }
      }
    } else {
      const fn = { start: startWorld, stop: stopWorld, setup: setupWorld }[args.action]
      for (const name of args.worlds) fn(name)
    }
    return 0
  } catch (err) { console.error(err.message); return 1 }
}

main(process.argv.slice(2)).then(code => process.exit(code))
