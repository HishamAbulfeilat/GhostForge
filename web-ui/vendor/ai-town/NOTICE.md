This directory vendors the AI Town client renderer from
https://github.com/a16z-infra/ai-town at commit
8e05997f2409275669c8344b84a51692e83f3f33 (2026-10-01).

The upstream MIT license is included as `LICENSE`. Upstream renderer code and
world-map data are retained in `src/components/` and `data/`; the GhostForge
snapshot adapter is maintained under `web-ui/app/agent-world/town/`.

See `THIRD_PARTY_NOTICES.md` for the separately credited game art.

Local deviations from upstream: a type-only cast in `src/components/PixiViewport.tsx`
(pixi-viewport 5.1 typings lag its runtime), and `src/types.ts` / `src/components/Game.tsx`
replace the Convex/Clerk data layer with the GhostForge snapshot adapter.
