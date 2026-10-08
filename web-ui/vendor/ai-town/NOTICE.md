This directory vendors the AI Town client renderer from
https://github.com/a16z-infra/ai-town at commit
8e05997f2409275669c8344b84a51692e83f3f33 (2026-10-01).

The upstream MIT license is included as `LICENSE`. Upstream renderer code and
world-map data are retained in `src/components/` and `data/`; the GhostForge
snapshot adapter is maintained under `web-ui/app/agent-world/town/`.

See `THIRD_PARTY_NOTICES.md` for the separately credited game art.

Local deviations from upstream: a type-only cast in `src/components/PixiViewport.tsx`
(pixi-viewport 5.1 typings lag its runtime), and `src/types.ts` / `src/components/Game.tsx`
replace the Convex/Clerk data layer with the GhostForge snapshot adapter. `src/types.ts`
adds optional `orientation` / `isMoving` fields and `src/components/Player.tsx` passes
them to the unchanged upstream `Character`, so characters walk as upstream does; the
movement is driven by `app/agent-world/shared/town/walkers.ts`.

Agent World additions (minimal, recorded here as upstream deviations):
- `src/components/Game.tsx` and `src/components/PixiGame.tsx` accept an optional
  `viewportRef`, so the host can read and pan the pixi-viewport camera (minimap,
  speech-bubble placement). Without it they behave exactly as upstream.
- `src/types.ts` adds an optional `emoji`, and `src/components/Player.tsx` passes it
  to upstream `Character`'s existing `emoji` bubble (⏳ waiting, ⚠️ stalled, ☕ break).
- `src/components/Character.tsx` gets its parsed `Spritesheet` from the new
  `src/components/spritesheetCache.ts` instead of parsing one per character: one
  sheet per (texture, frame data), reference counted, textures destroyed a
  second after the last character using it unmounts (upstream never destroys
  them). The rendering itself is unchanged.
- `src/components/Game.tsx` accepts an optional `paused` and passes it to
  `@pixi/react`'s own `Stage` props (`raf={!paused}`,
  `renderOnComponentChange={!paused}`), so the host can stop the ticker while
  the scene is scrolled off screen. Without it, behaviour is upstream's.
