# Claude Code mods in GhostForge

Mods are Claude Code plugins that run TypeScript inside Claude Code (panes,
status lines, guards on prompts and tool calls). Claude Code 2.1.287 or later.

## Mods this repo turns on

`.claude/settings.json` registers three marketplaces and enables one mod from
each. Anyone who opens the repo — this laptop, another device, or a Claude
Code cloud session — gets them after accepting the workspace trust prompt.

| Mod | What it does | Source |
|---|---|---|
| `secret-redactor` | Redacts keys, tokens, emails and IPs from prompts, tool calls and context | [ray-amjad/awesome-claude-code-function-hooks](https://github.com/ray-amjad/awesome-claude-code-function-hooks) |
| `burn-meter` | Token and cost burn above the prompt; `/burn` opens a pane | [OneWave-AI/claude-code-mods](https://github.com/OneWave-AI/claude-code-mods) |
| `context-lens` | Shows what fills the context window; `/context-lens` | [Arunjay4213/claude-mods](https://github.com/Arunjay4213/claude-mods) |

Reviewed 2026-10-08 with `claude plugin validate`: none makes network
requests, starts processes or writes files.

To install them on a machine by hand (or to get them in sessions started
outside this repo):

```
claude plugin marketplace add ray-amjad/awesome-claude-code-function-hooks
claude plugin marketplace add OneWave-AI/claude-code-mods
claude plugin marketplace add Arunjay4213/claude-mods
claude plugin install secret-redactor@awesome-claude-code-function-hooks --scope user
claude plugin install burn-meter@claude-code-mods --scope user
claude plugin install context-lens@claude-mods --scope user
```

Then run `/reload-plugins` in an open session and check with `/plugin`.

## Where to find more

Also listed in the GhostForge marketplace under **Claude Code Mods**:

- [ClaudeMod](https://www.claudemod.com/) — mods, skills, MCP servers, hooks, agents, plugins
- [Claude Mods](https://claude-mods.com/) — in-process mods with install commands per listing
- [Awesome Claude Code Mods](https://mods.aidojo.si/) ([repo](https://github.com/karanb192/awesome-claude-code-mods), CC0) — ~2,700 scanned mods, each showing what it can access

## Rules

- Mods are **not sandboxed**: they see every prompt and tool call and run with
  your permissions. Add one at a time; read it and run
  `claude plugin validate ./<repo>` first. Never bulk-install a directory.
- To turn mods off: disable one in `/plugin`, start with `claude --safe-mode`,
  or set `"disableAllHooks": true` in `~/.claude/settings.json`.
