# Third-party notices

This file records third-party code and assets redistributed in this repository
for the Agent Town and Agent Office worlds. Per-directory detail also lives in
`web-ui/vendor/ai-town/NOTICE.md` and `web-ui/vendor/ai-town/THIRD_PARTY_NOTICES.md`.

## a16z-infra/ai-town (`web-ui/vendor/ai-town/`)

- MIT License, copyright (c) 2023 a16z-infra; full text in `web-ui/vendor/ai-town/LICENSE`.
- Source: <https://github.com/a16z-infra/ai-town/tree/8e05997f2409275669c8344b84a51692e83f3f33>
  (pinned commit `8e05997f2409275669c8344b84a51692e83f3f33`).
- Client rendering components and world-map data are vendored from that commit;
  the Convex/Clerk data layer is replaced by the GhostForge snapshot adapter in
  `web-ui/app/agent-world/town/`.

### Assets bundled

| File | License / credit |
|------|------------------|
| `web-ui/vendor/ai-town/assets/32x32folk.png` | Distributed by the pinned upstream repo under its MIT license; upstream README credits Replicate/Fal.ai pixel-art generation. No separate asset license is supplied. |
| `web-ui/vendor/ai-town/assets/gentle-obj.png` | Map tileset: "16x16 RPG Tileset" by hilau (CC BY-SA 3.0 / GPL-3.0), based on "16x16 Game Assets" by George Bailey (CC BY 4.0) and "LPC Thatched-roof Cottage" by bluecarrot16 (CC BY-SA 3.0 / GPL-3.0), which credits LPC base art by Lanea Zimmerman, Daniel Armstrong and Casper Nilsson. Retained unmodified; CC BY-SA share-alike terms apply to this file. |

Other upstream artwork (animated effect sheets, UI art, music) is **not**
bundled because the pinned repository provides no file-specific redistribution
license for it.

## harishkotra/agent-office (`web-ui/vendor/agent-office/`)

- MIT License, copyright (c) 2026 Harish Kotra; full text in `web-ui/vendor/agent-office/LICENSE`.
- Source: <https://github.com/harishkotra/agent-office/tree/58f11f9b31770c10bcf3d7a0618325d22bd0ee9e>
  (pinned commit `58f11f9b31770c10bcf3d7a0618325d22bd0ee9e`).
- The Phaser office scene (`packages/ui/src/game/Game.ts`) and event bus are vendored;
  the Colyseus/Ollama server state is replaced by the GhostForge snapshot adapter in
  `web-ui/vendor/agent-office/src/snapshot-room.ts` and `web-ui/app/agent-world/office/`.
  Deviations are listed in `web-ui/vendor/agent-office/NOTICE.md`.
- Also MIT: pablodelucca/pixel-agents, copyright (c) 2026 Pablo De Lucca
  (`web-ui/vendor/agent-office/pixel-agents/LICENSE`), the source of the character sprites.

### Assets bundled

| File | License / credit |
|------|------------------|
| `web-ui/public/vendor/agent-office/characters/char_0.png`, `char_1.png` | Character sprites from pablodelucca/pixel-agents (MIT), which are based on the "MetroCity Free Top-Down Character Pack" by JIK-A-4, published under CC0 1.0 (<https://jik-a-4.itch.io/metrocity-free-topdown-character-pack>); credit is not required but given here. Byte-identical to the pinned agent-office copies. |

The office floor, furniture and decorations are drawn in code by the scene (no image files).
The other four upstream sprite sheets (`char_2`-`char_5`) and upstream's empty `agent.png`
are not bundled because the scene does not load them.

## npm dependencies

| Package | License |
|---------|---------|
| `pixi.js` ^7 | MIT |
| `@pixi/react` ^7 | MIT |
| `pixi-viewport` ^5 | MIT |
| `phaser` ^3.90 | MIT |

These match upstream's majors. `pixi-viewport` 5 declares a Pixi 6 peer range
but is used with Pixi 7 exactly as upstream does, so `web-ui/.npmrc` sets
`legacy-peer-deps=true`.
