# Agent Worlds — design reference

Designed with Claude Design (canvas: https://claude.ai/artifact/6bSqAGRGFDSHJemEVfdbeC — owner-only).
One `.dc.html` per screen; the markup + `renderVals()` sample data show layout, tokens and states.

These files are design references, not a list of bundled upstream applications. The shipped `/agent-world` page renders the original GhostForge Forge World scene and a GhostForge Agent Office map from available session snapshots. Agent Town is a separately managed local world using the pinned a16z AI Town checkout in an ignored runtime directory; its source and assets are not vendored into GhostForge.

| File | Design intent | Shipped state |
|---|---|---|
| `Main.dc.html` | `/agents` command center: team builder (leader + workers, provider/model, template), 5-column board, workflow graph, stop-with-confirm | Design reference; not an implementation status claim |
| `DevMonitor.dc.html` | `tools/dev-monitor` standalone page: all Claude + Copilot sessions, progress, activity, pipeline counts | Design reference; not an implementation status claim |
| `ForgeWorld.dc.html` | Original Forge World: furnaces per worker, boss anvil, ore→forging→quench→armory lanes | Shipped as the GhostForge Forge World scene |
| `AgentOffice.dc.html` | Office layout inspired by harishkotra/agent-office | Shipped as a GhostForge Agent Office map using available session snapshots; the upstream front end is not vendored or used |
| `AgentTown.dc.html` | Town layout inspired by a16z-infra/ai-town | The selector offers the separately managed upstream world in an iframe; it is not bundled or copied into GhostForge |

The AI Town runtime is cloned at a pinned upstream commit into the gitignored `apps/worlds/ai-town/upstream/` directory by its setup script. The world is not a vendored source dependency; it must be installed and started explicitly. See [AI Town setup and smoke test](../../AI-TOWN.md). The Agent Office implementation remains GhostForge's own map and does not use the upstream front end.

**Tokens:** ground `#0E1014`, surface `#15181E`, line `#262A33`, text `#E8E6E1`, muted `#A9ADB6`; ember `#F2A65A` (boss/review), steel `#7CC4EA` (working), green `#8FD3A8` (done), red `#E58C8C` (blocked). Type: Space Grotesk (display), IBM Plex Sans (body), JetBrains Mono (data).
**Rules:** render only real snapshot data (no fake movement); every agent is a real `<button>` (keyboard + screen reader); reduced-motion safe; Forge World uses original art. Any future upstream integration must verify asset redistribution rights and document applicable licenses before including third-party assets.
