# Agent Worlds — design reference

Designed with Claude Design (canvas: https://claude.ai/artifact/6bSqAGRGFDSHJemEVfdbeC — owner-only).
One `.dc.html` per screen; the markup + `renderVals()` sample data show layout, tokens and states.

| File | Implements |
|---|---|
| `Main.dc.html` | `/agents` command center: team builder (leader + workers, provider/model, template), 5-column board, workflow graph, stop-with-confirm |
| `DevMonitor.dc.html` | `tools/dev-monitor` standalone page: all Claude + Copilot sessions, progress, activity, pipeline counts |
| `ForgeWorld.dc.html` | Forge World (original): furnaces per worker, boss anvil, ore→forging→quench→armory lanes |
| `AgentOffice.dc.html` | Agent Office (harishkotra/agent-office patterns): boss office, desks + thought bubbles, review room, lounge |
| `AgentTown.dc.html` | Agent Town (a16z-infra/ai-town patterns): tile map, buildings per status, characters + speech, zoom |

**Tokens:** ground `#0E1014`, surface `#15181E`, line `#262A33`, text `#E8E6E1`, muted `#A9ADB6`; ember `#F2A65A` (boss/review), steel `#7CC4EA` (working), green `#8FD3A8` (done), red `#E58C8C` (blocked). Type: Space Grotesk (display), IBM Plex Sans (body), JetBrains Mono (data).
**Rules:** render only real snapshot data (no fake movement); every agent is a real `<button>` (keyboard + screen reader); reduced-motion safe; original/procedural art only.
