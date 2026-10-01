#!/usr/bin/env node
// Agent-team CLI — how agents (and humans) talk to the boss and to each other.
//
//   node scripts/agents/team.mjs start                       launch the boss and begin the team loop
//   node scripts/agents/team.mjs status                      board, agents, health
//   node scripts/agents/team.mjs say --from claude --to copilot "text"
//   node scripts/agents/team.mjs inbox --for copilot         recent messages
//   node scripts/agents/team.mjs done  T-004 --agent claude "summary"
//   node scripts/agents/team.mjs block T-004 --agent claude "reason"
//   node scripts/agents/team.mjs add "title" [--kind k] [--area a,b] [--agent any] [--leader id] [--assignee id] [--workflow mode] [--dependencies T-001,T-002] [--acceptance-criteria "criterion one;criterion two"] [--from human]
//   node scripts/agents/team.mjs stop                        boss stops after in-flight tasks
//
// Works from any worktree: state lives in the main repo (found via git).

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { stateDir, loadBoard, readMessages, say, writeResult, readJSON } from './lib/bus.mjs'

/** The main worktree root — shared by every agent worktree. */
export function mainRoot(cwd = process.cwd()) {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim()
  return path.dirname(common)
}

function parse(argv) {
  const flags = {}; const pos = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1]
      flags[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : argv[++i]
    } else pos.push(argv[i])
  }
  return { flags, pos }
}

function fmtStatus(dir) {
  const board = loadBoard(dir)
  const status = readJSON(path.join(dir, 'status.json'), null)
  const out = []
  out.push(`\n  Agent team — phase ${board.phase}` + (status
    ? `  ·  health ${status.health ?? '?'}/100  ·  merges ${status.merges ?? 0}  ·  heartbeat ${status.ts}`
    : '  ·  boss not running'))
  if (status?.pr) out.push(`  PR: ${status.pr}`)
  for (const [id, a] of Object.entries(status?.agents ?? {})) {
    out.push(`  ${id.padEnd(8)} ${a.state.padEnd(12)} ${a.task ?? ''} ${a.model ? `[${a.model}]` : ''} ${a.cooldownUntil ? `cooldown→${a.cooldownUntil}` : ''}`)
  }
  const by = s => board.tasks.filter(t => t.status === s)
  out.push(`\n  todo ${by('todo').length} · in-progress ${by('in-progress').length} · blocked ${by('blocked').length} · done ${by('done').length}\n`)
  for (const t of board.tasks.filter(t => t.status !== 'done').slice(0, 40)) {
    out.push(`  ${t.id} ${t.status.padEnd(11)} ${(t.owner ?? t.agent).padEnd(8)} ${t.kind.padEnd(12)} ${t.title}`)
  }
  const msgs = readMessages(dir, { limit: 8 })
  if (msgs.length) {
    out.push('\n  Recent messages:')
    for (const m of msgs) out.push(`  ${m.ts.slice(5, 16)} ${m.from} → ${m.to}: ${m.text.slice(0, 160)}`)
  }
  return out.join('\n') + '\n'
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { flags, pos } = parse(rest)
  const dir = stateDir(mainRoot())

  switch (cmd) {
    case 'start': {
      const boss = path.join(mainRoot(), 'scripts', 'agents', 'boss.mjs')
      if (!fs.existsSync(boss)) throw new Error('Agent team boss launcher was not found at scripts/agents/boss.mjs')
      const child = spawn(process.execPath, [boss, 'start'], {
        cwd: mainRoot(),
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      })
      child.unref?.()
      console.log('boss start requested')
      break
    }
    case 'status':
      process.stdout.write(fmtStatus(dir))
      break
    case 'say': {
      const text = pos.join(' ')
      if (!flags.from || !text) throw new Error('usage: say --from <me> --to <agent|all|boss> "text"')
      say(dir, flags.from, flags.to || 'all', text)
      console.log('sent')
      break
    }
    case 'inbox':
      for (const m of readMessages(dir, { to: flags.for, limit: Number(flags.limit) || 20 })) console.log(`${m.ts} ${m.from} → ${m.to}: ${m.text}`)
      break
    case 'done':
    case 'block': {
      const [id, ...words] = pos
      if (!id || !flags.agent) throw new Error(`usage: ${cmd} T-001 --agent <me> "summary"`)
      writeResult(dir, id, { agent: flags.agent, outcome: cmd === 'done' ? 'done' : 'blocked', summary: words.join(' ') })
      console.log(`recorded ${cmd} for ${id}`)
      break
    }
    case 'add': {
      const title = pos.join(' ')
      if (!title) throw new Error('usage: add "title" [--kind k] [--area a,b] [--agent any] [--leader id] [--assignee id] [--workflow mode] [--dependencies T-001,T-002] [--acceptance-criteria "criterion one;criterion two"]')
      const listFlag = (value, separator) => value ? String(value).split(separator).map(item => item.trim()).filter(Boolean) : []
      const req = {
        title,
        kind: flags.kind,
        area: listFlag(flags.area, ','),
        agent: flags.agent || 'any',
        from: flags.from || 'human',
      }
      if (flags.assignee) req.assignee = flags.assignee
      if (flags.leader) req.leader = flags.leader
      if (flags.workflow) req.workflow = flags.workflow
      const dependencies = listFlag(flags.dependencies, ',')
      if (dependencies.length) req.dependencies = dependencies
      const acceptanceCriteria = listFlag(flags['acceptance-criteria'], ';')
      if (acceptanceCriteria.length) req.acceptanceCriteria = acceptanceCriteria
      fs.appendFileSync(path.join(dir, 'requests.jsonl'), JSON.stringify(req) + '\n')
      console.log('queued for the boss')
      break
    }
    case 'stop':
      fs.writeFileSync(path.join(dir, 'STOP'), new Date().toISOString())
      console.log('boss will stop after in-flight tasks finish')
      break
    default:
      console.log('commands: start | status | say | inbox | done | block | add | stop   (see the header of scripts/agents/team.mjs)')
  }
}

try { main() } catch (e) { console.error(e.message); process.exit(1) }
