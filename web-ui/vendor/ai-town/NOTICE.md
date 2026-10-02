This directory vendors the AI Town client renderer from
https://github.com/a16z-infra/ai-town at commit
8e05997f2409275669c8344b84a51692e83f3f33 (2026-10-01).

The upstream MIT license is included as `LICENSE`. Upstream renderer code and
world-map data are retained in `src/components/` and `data/`; the GhostForge
snapshot adapter is maintained under `web-ui/app/agent-world/town/`. The
renderer is mounted with GhostForge snapshot data; upstream Convex/Clerk
simulation and authentication integrations are not included.

See the repository-root `THIRD_PARTY_NOTICES.md` for asset licenses and
attributions.
