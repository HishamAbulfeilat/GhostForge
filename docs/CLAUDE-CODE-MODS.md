# Claude Code mods in GhostForge

Mods are Claude Code plugins that run TypeScript inside Claude Code (panes,
status lines, guards on prompts and tool calls). Claude Code 2.1.287 or later.

## Mods this repo turns on

`.claude/settings.json` registers GhostForge's own marketplace,
`ghostforge-mods` (`claude-mods/.claude-plugin/marketplace.json`), and enables
the three mods in it. Anyone who opens the repo — this laptop, another device,
or a Claude Code cloud session — gets them after accepting the workspace trust
prompt.

Each mod is fetched from its upstream repo **pinned to the exact commit that
was reviewed** (`sha` in the marketplace file), so an upstream change can't
reach anyone until it is reviewed here.

| Mod | What it does | Source |
|---|---|---|
| `secret-redactor` | Redacts keys, tokens, emails and IPs from prompts, tool calls and context | [ray-amjad/awesome-claude-code-function-hooks](https://github.com/ray-amjad/awesome-claude-code-function-hooks) |
| `burn-meter` | Token and cost burn above the prompt; `/burn` opens a pane | [OneWave-AI/claude-code-mods](https://github.com/OneWave-AI/claude-code-mods) |
| `context-lens` | Shows what fills the context window; `/context-lens` | [Arunjay4213/claude-mods](https://github.com/Arunjay4213/claude-mods) |

Reviewed 2026-10-08 with `claude plugin validate`: none makes network
requests, starts processes or writes files.

To install them on a machine by hand (or to get them in sessions started
outside this repo):

From a clone of this repo:

```
claude plugin marketplace add ./claude-mods
claude plugin install secret-redactor@ghostforge-mods --scope user
claude plugin install burn-meter@ghostforge-mods --scope user
claude plugin install context-lens@ghostforge-mods --scope user
```

(The marketplace file lives in a subfolder, so `marketplace add` needs the
local path; inside the repo, accepting the trust prompt does the same.)

Then run `/reload-plugins` in an open session and check with `/plugin`.

### Updating a mod

1. Clone the upstream repo, `git diff <pinned sha>..HEAD -- <plugin path>`, and read it.
2. `claude plugin validate ./<plugin path>` — check the `hooks:` and `calls:` lines.
3. Put the new full 40-character SHA in `claude-mods/.claude-plugin/marketplace.json`,
   then `claude plugin validate ./claude-mods`.

### Adding a mod

Add an entry to the same marketplace file with a `git-subdir` source and a
`sha`, after the same review, and enable it in `.claude/settings.json`.

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
