This directory vendors the Agent Office client scene from
https://github.com/harishkotra/agent-office at commit
58f11f9b31770c10bcf3d7a0618325d22bd0ee9e (2026-10-02).

Licenses (both MIT, full text included):
- `LICENSE` — Copyright (c) 2026 Harish Kotra (agent-office).
- `pixel-agents/LICENSE` — Copyright (c) 2026 Pablo De Lucca (pixel-agents,
  https://github.com/pablodelucca/pixel-agents, vendored upstream as
  `pixel-agents-repo/`). The upstream client scene does not import any
  pixel-agents code; only its character sprites (below) originate there, so
  its license is carried alongside.

Vendored from `packages/ui/src/`: `game/Game.ts` (office scene, agent
containers, name tags, thought and emote bubbles, focus ring, camera follow,
layout rendering) and `events.ts`.

GhostForge-owned files in this directory: `src/snapshot-room.ts` (replaces the
Colyseus client with the GhostForge agent snapshot) and `src/game/schema.ts`
(plain state shapes instead of `@colyseus/schema` classes). The snapshot
adapter that maps agents/tasks/boss to office state lives in
`web-ui/app/agent-world/office/`.

Local deviations from upstream `Game.ts` (everything else is verbatim):
- `import * as Colyseus from 'colyseus.js'` -> `'../snapshot-room'`.
- Sprite paths `/assets/characters/char_N.png` -> `/vendor/agent-office/characters/char_N.png`.
- Status text no longer mentions Colyseus or a WebSocket endpoint.
- The three hard-coded desk labels ("Alice's Desk", "Bob's Desk", "Vacant") read "Desk".
- The WASD/arrow key handler ignores Ctrl/Meta/Alt chords so browser shortcuts still work.

See `/THIRD_PARTY_NOTICES.md` for the character sprite credits.
