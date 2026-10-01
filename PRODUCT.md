# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

GhostForge developers and operators who supervise multiple autonomous coding agents across local worktrees, app sessions, cloud workers, and remote devices. They need to understand current work, ownership, dependencies, health, and failures without reading raw state files.

## Product Purpose

GhostForge is an operator-grade AI development studio. Agent World makes its multi-agent system observable and controllable from one authenticated operations surface while preserving the CLI and TUI as recovery paths.

## Positioning

GhostForge combines a live spatial view of agent activity with the same real task board, workflow metadata, source provenance, and authenticated controls used by its automation runtime. The visual world is an operational projection of reported state, not a simulated game.

## Operating Context

Operators use `/agents` inside the GhostForge web app and `/agent-world` as a focused operations-center route. Agent state arrives through the existing `/api/agents` snapshot and future project connector fields. The boss remains the only integration authority; web surfaces are control clients.

## Capabilities and Constraints

- Preserve the authenticated `GET`/`POST /api/agents` contract and `admin_tools` gate.
- Render every count, source, session, task, edge, message, and status from snapshot data.
- Support local, app, cloud, remote, and unknown source kinds without exposing connector credentials.
- Preserve start, stop, refresh, message, task, leader, assignee, workflow, dependency, and acceptance-criteria controls.
- Remain responsive, keyboard accessible, reduced-motion friendly, and RTL-safe.
- Use existing dependencies and GhostForge tokens; runtime federation remains server-owned.

## Brand Commitments

GhostForge is “operator-grade dev tools, forged in the shadows.” The Agent World surface is an original virtual forge and visibly attributes TaskVille, a16z AI Town, and Agent Office as inspiration without cloning them.

## Evidence on Hand

Real agent-team state, task metadata, messages, health, phase, provider/model information, and workflow leadership are available from the authenticated snapshot. Project, workspace, source, device, and explicit federated session fields are optional until backend connectors report them; the interface must not fabricate replacements.

## Product Principles

1. Operational truth before spectacle.
2. Spatial understanding with a serious non-spatial fallback.
3. Provenance is visible wherever state is shown.
4. Missing data is explicit and recoverable.
5. Controls remain familiar across web, TUI, and CLI.

## Accessibility & Inclusion

The surface must meet WCAG 2.1 AA expectations, support keyboard-only operation, honor reduced motion, use logical RTL-safe layout utilities, and preserve readable board/table fallbacks.
