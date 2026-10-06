# GhostForge Product Analysis

**Perspective:** business analysis of the checked-in product, not a roadmap
claim or a measure of customer adoption.  
**Evidence snapshot:** 2026-10-01. Surface availability is cross-checked
against [`FEATURE-MATRIX.md`](FEATURE-MATRIX.md) and the named route, screen,
CLI, bridge, Electron, and Android implementations. A reachable entry point
does not by itself prove that an external integration is configured or that
every workflow is complete.

## Executive assessment

GhostForge is an unusually broad, multi-surface developer studio: a Next.js
web application, a deep terminal UI, script-backed terminal commands, a
Python JARVIS bridge, an Electron desktop app, and Android/iOS packaging. Its
clearest product opportunity is to make these parts feel like one dependable
workspace rather than a large collection of tools with uneven reachability.
The strongest differentiator is the breadth of local developer tooling
combined with an agent-team control plane; its largest product risk is the
gap between a feature's presence somewhere in the repository and an
understandable, consistent end-to-end experience on the surface a user chose.

Recommended direction: keep the breadth, but make a few core journeys
exceptionally clear and verifiable—setup, choose/connect a model, work on a
project, delegate a task, inspect its evidence, and resume or review it from
another supported surface. Treat provider credentials, external services,
bridge state, and platform-specific controls as explicit prerequisites, not
implied capabilities.

## Target users and jobs to be done

These are product hypotheses based on the shipped capabilities; validate them
with usage data and user interviews before treating them as market segments.

| Target user | Job to be done | Desired outcome |
|---|---|---|
| Independent developer / technical founder | “Help me move from idea or issue to working, tested code without stitching together a dozen tools.” | A project-centric workflow for chat, files, terminal, tests, GitHub, and task follow-up. |
| Terminal-first engineer | “Let me run common development, QA, deployment, and maintenance tasks quickly in my shell.” | Discoverable CLI commands and a fast keyboard-driven TUI with clear command results. |
| AI-assisted developer / model experimenter | “Let me compare, select, and use local, hosted, or lower-cost models without rebuilding my workflow for each provider.” | A transparent model catalog, routing/configuration, and clear disclosure of external requirements. |
| Engineering lead / agent-team operator | “Delegate bounded work to agents, see who is doing what, and know whether the result is ready to review.” | A reliable task lifecycle with ownership, acceptance criteria, progress, evidence, and human control. |
| Automation / platform engineer | “Connect my existing developer tools and automate repeatable work without hiding where execution happens.” | Explicit connector health, safe triggers, workflow history, and actionable failure information. |
| Voice-first or accessibility-focused user | “Ask an assistant to help while I am away from the keyboard or using other applications.” | Dependable voice input/output, understandable permissions, and recoverable assistant actions. |
| Self-hosting / local-control advocate | “Keep useful developer and agent workflows close to my own projects and infrastructure.” | Clear local-vs-remote boundaries, safe defaults, and simple setup without accidental credential exposure. |

## Value proposition

**Proposed positioning:** *GhostForge is a self-hostable developer command
center that brings project work, AI tools, agent teams, and automation into
one workspace—with web, terminal, desktop, and assistant entry points.*

The value is not merely the number of tools. It is the potential to carry a
developer's task and context between surfaces: discover a task on GitHub,
inspect or implement it in a project workspace, ask JARVIS or a model for
help, delegate bounded work, and review the resulting status and evidence.
The implemented repository contains many of those building blocks, but the
product should not claim seamless cross-surface continuity until task state,
capability availability, and failure behavior are consistent and tested.

## Shipped feature inventory and reachability

The table is the current **reachability inventory**. It mirrors the
feature-level claims in `FEATURE-MATRIX.md`, whose evidence references were
checked against implementation locations in `web-ui/app/**`,
`web-ui/components/**`, `web-ui/app/api/**`, `tui/index.js`, `scripts/**`,
`cli/index.js`, and `mark-l-bridge/server.py`. The web/TUI/CLI/bridge
abbreviations below align with the matrix's Web UI, TUI, Terminal CLI, and
JARVIS / bridge columns.

**Legend:** `Y` = reachable; `P` = partial, lower-level, or dependent on an
external service; `—` = not exposed on that surface. Reachability does not
mean feature parity, an available credential, or a live external service.

| Feature | Web | TUI | CLI | Bridge |
|---|:---:|:---:|:---:|:---:|
| Dashboard, GitHub issues/PRs/actions | Y | Y | Y | — |
| Chat / unified model chat | Y | Y | Y | Y |
| Chat chains / multi-model routing | Y | P | Y | Y |
| Web terminal / PTY | Y | — | Y | — |
| Files browser and Monaco editor | Y | P | — | Y |
| History and audit log | Y | Y | Y | Y |
| Command catalog / feature launcher | Y | Y | Y | — |
| Project open, project list, scaffolding | P | Y | Y | — |
| Setup and environment configuration | Y | Y | Y | — |
| AI agents dashboard and dispatch | Y | Y | P | Y |
| Agent World (federated agent and connector operations) | Y | P | P | P |
| Agent teams, crews, tasks, messages | Y | Y | P | Y |
| JARVIS assistant | Y | Y | P | Y |
| Voice input (STT) | Y | Y | Y | — |
| Voice output (TTS) | Y | Y | Y | — |
| Voice clone / voicebox | Y | P | Y | — |
| JARVIS language/model selection | Y | Y | Y | Y |
| Screen capture, vision and OCR | Y | Y | P | Y |
| Cursor/macOS computer control | Y | Y | P | Y |
| Browser automation and web search | P | Y | Y | Y |
| Clipboard, desktop and app launching | P | Y | P | Y |
| Memory (CRUD, semantic search, import/export) | Y | P | Y | Y |
| Proactive assistant, morning briefing and inbox | Y | P | Y | — |
| Jarvis collaboration and sharing | Y | Y | Y | Y |
| Job Hunter (search, profile, CV, GitHub) | Y | P | Y | Y |
| Workflow engine and workflow runs | P | Y | Y | Y |
| n8n automation | Y | Y | Y | Y |
| Webhooks and trigger automation | Y | Y | Y | Y |
| Orchestrated multi-agent work | Y | P | Y | Y |
| Remote setup and device management | Y | Y | Y | Y |
| Push notifications | Y | Y | Y | — |
| Device status and registry | Y | Y | Y | Y |
| Models catalog, install and recommendations | Y | Y | Y | Y |
| LLMFit model matching and auto-switch | Y | Y | Y | — |
| Hugging Face model search | Y | Y | P | Y |
| Awesome LLM apps catalog | Y | Y | Y | — |
| Marketplace catalog and install state | Y | Y | Y | — |
| Custom model/API keys | Y | P | Y | P |
| OpenJarvis health, doctor and ask | Y | P | Y | Y |
| Mark-LV tools and tool runner | P | Y | Y | Y |
| Weather, flights and reminders | P | Y | Y | Y |
| YouTube and game updater | Y | Y | Y | Y |
| Files/process control | Y | Y | Y | Y |
| Code helper and developer agent | P | Y | Y | Y |
| Security scan and pentest helpers | P | Y | Y | — |
| Doctor, health and diagnostics | Y | Y | Y | Y |
| Testing and coverage | P | Y | Y | — |
| Deploy and Azure tooling | P | Y | Y | Y |
| Git hooks, upgrades and release tooling | Y | Y | Y | Y |
| API docs/types/mock generation | Y | Y | Y | — |
| i18n and RTL tooling | P | Y | Y | — |
| Snippets, changelog, README and onboarding | Y | Y | Y | — |
| Tickets, Azure DevOps and estimates | P | Y | Y | — |
| Performance, bundle, unused-code and dependency health | P | Y | Y | — |
| Free APIs/models and provider setup | Y | Y | Y | — |
| Users, login and access profiles | Y | Y | Y | — |
| Bridge start/status and connection controls | Y | Y | Y | Y |
| Electron desktop integrations | — | — | — | P |
| Android/iOS packaged app | — | — | Y | — |
| Design resources, Vigolium and open-source tools | Y | Y | Y | — |

Two additional shipped surfaces are not separate columns in the matrix:

| Surface | Checked-in capability | Product boundary |
|---|---|---|
| Electron desktop | A real Electron main process, preload, and renderer, with integrations for voice, screen capture, browser automation, memory, proactive assistance, N8N, system controls, and more (`electron-app/src/main/**`). | Runtime integrations are Electron-specific and are not a complete mirror of web/TUI/CLI. Packaging/build scripts are not equivalent to runtime controls on other surfaces. |
| Android / iOS | Capacitor projects, Android/iOS native project scaffolding, a web asset directory, and build scripts (`electron-app/android`, `electron-app/ios`, `electron-app/android-web`, `scripts/build-android.sh`, `scripts/build-ios.sh`). | Packaging reachability does not establish a complete native feature set or parity with the desktop/web products. Android and iOS require dedicated device-level capability and lifecycle validation. |

### Important operating constraints

- n8n features require an external n8n service; GhostForge does not bundle or
  manage that service.
- Remote Agent World connectors are opt-in. The default is local-only, and
  remote data depends on an explicitly allowed endpoint and a valid snapshot.
- JARVIS bridge integrations depend on the bridge environment and, for
  optional integrations, the relevant installed package/service and
  configuration.
- Features marked partial in the matrix have a narrower entry point or
  external dependency; users should see that limitation before starting a
  workflow.
- Electron-only controls and mobile packaging do not imply identical
  operating-system permissions, integrations, or behavior across Windows,
  macOS, Linux, Android, and iOS.

## UX/UI pain points by surface

The items below are evidence-based product risks inferred from the route,
screen, and platform structure—not usability-test findings. Validate
frequency and severity with users before committing to a redesign.

### Web

- **Breadth competes with orientation.** Many individual tool pages and
  partial routes increase discoverability and navigation costs. Users need a
  short path from project/task intent to the right tool, plus a reliable
  explanation when a feature is partial or requires an external service.
- **The command center and workflow pages need a coherent task lifecycle.**
  Dashboard, `/agents`, Agent World, `/orchestrate`, `/workflows`, history, and
  terminal each provide related context. The UI should make clear which view
  is authoritative for a run's status, result, and next action.
- **Admin and access boundaries can surprise users.** Agent World and agent
  management are privileged experiences; sign-in, permission-denied, loading,
  stale, empty, offline, and error states must remain distinct.
- **A web page is not necessarily a complete workflow.** The matrix labels
  some features partial; communicate missing actions and bridge/provider
  prerequisites inline rather than sending users to discover them later.

### TUI

- **A large screen catalogue creates a learning burden.** `tui/index.js`
  contains many screens and dispatch routes. An experienced user benefits
  from speed, but a new user can struggle to know where a feature lives or
  whether it has a shortcut, a confirmation step, or a CLI equivalent.
- **Terminal output must explain consequences and recovery.** For remote
  actions, automation triggers, installs, and provider-dependent work, show
  the target, prerequisite, outcome, and safe retry/cancel path; a terminal
  error string alone does not support informed recovery.
- **Parity is intentionally uneven.** Several web capabilities are only
  partial in the TUI. The TUI should label those limits and provide a
  deliberate handoff rather than presenting similarly named screens as
  equivalent.

### Terminal CLI

- **Script-backed commands are powerful but fragmented.** The root exposes
  many `scripts/**` entry points while `bin/ghostforge` is only a wrapper at
  this revision. A discoverable, consistent command map, help output, and
  stable structured results would reduce memorization and make scripting
  safer.
- **Command availability and prerequisites need a common contract.** Platform,
  optional dependencies, credentials, and local services affect whether a
  command can finish. Preflight checks and actionable non-zero failures
  should replace guesswork.
- **A CLI feature and a CLI build/package command are different things.**
  Documentation should distinguish runtime controls from packaging support,
  especially for Electron and mobile.

### JARVIS / bridge

- **Assistant behavior depends on environment and integration health.** The
  bridge exposes many authenticated endpoints, but local runtime, optional
  OpenJarvis/Mark-LV dependencies, model access, and device availability
  determine what actually works. A single health view should identify the
  unavailable dependency and its scope.
- **Tool actions need understandable consent and execution status.** Browser,
  computer, file, device, workflow, and webhook operations can have different
  effects. Consistent target previews, confirmation rules, progress, and
  audit outcomes help users trust automation without hiding what it did.
- **Conversation continuity is not the same as workspace continuity.** Users
  need a visible link between a JARVIS conversation, its project/task, any
  delegated agent work, and the resulting history.
- **The bridge is not automatically a turnkey cloud service.** It is a local
  integration boundary; disclose bind address, authentication, configured
  integrations, and runtime status instead of implying that every assistant
  capability is hosted or available by default.

### Electron

- **The desktop app is a rich but distinct experience.** Do not make users
  infer that every web/TUI feature exists in Electron or that an Electron
  integration also exists in the bridge.
- **System-level permissions are part of onboarding.** Screen capture,
  microphone, clipboard, app launching, and automation can be blocked or
  granted differently by OS. Explain why a permission is needed, where it is
  managed, and how a user can recover after denial.
- **Platform support needs demonstrated evidence.** The project declares
  Windows, macOS, and Linux builds, but release confidence should come from
  install/launch and critical journey tests per OS, not the presence of build
  scripts alone.

### Android

- **A packaged shell is not yet a mobile product promise.** Capacitor config
  and a generated native project establish a build path, not parity with
  desktop controls or proof of a complete phone-first experience.
- **Mobile constraints affect core assistant journeys.** Microphone, push
  notification, network interruption, background execution, screen size, and
  OS permission lifecycles require device-level validation and clear states.
- **The connection model needs to be explicit.** Users should know whether
  the app talks to a same-device service, a reachable local bridge, or a
  remote endpoint, and what remains available offline.

## Cross-platform gaps and product implications

1. **Uneven surface reachability:** the feature matrix has many web/TUI/CLI
   entries but a much smaller set of complete workflows shared across every
   surface. Partial entries are useful, but users need an explicit capability
   map and a consistent handoff.
2. **No demonstrated portable workspace/task contract:** several surfaces
   expose related agent, chat, history, workflow, and JARVIS operations. The
   product should establish a stable task/run identity and common lifecycle
   before promising that work can move seamlessly between them.
3. **External dependencies are product dependencies:** n8n, model providers,
   optional bridge packages, remote connectors, and host-level controls all
   affect success. Each integration needs setup validation and health
   feedback at the point of use.
4. **Desktop/mobile packaging outpaces verified parity:** Electron contains
   substantial native integrations, while Android/iOS have packaging
   scaffolding. Maintain separate, truthful support claims and a platform
   smoke-test matrix.
5. **Onboarding and recovery are cross-cutting:** setup, environment
   configuration, provider keys, permissions, connector state, and diagnostic
   tools exist across different surfaces. A first-run checklist and common
   health vocabulary would reduce setup failure and support load.
6. **Catalog breadth needs task-oriented navigation:** feature pages and
   scripts are valuable to power users; guided “what are you trying to do?”
   routes should expose them without removing direct expert access.

## Competitor comparison

This is a positioning comparison of product shape, not a feature-by-feature
benchmark. Public products change frequently; references below were checked
2026-10-01. “Copilot Workspace” is compared through the current official
GitHub Copilot cloud-agent documentation, which is the current documented
GitHub-hosted coding-agent workflow; this analysis does not assume a distinct
legacy Workspace preview remains available.

| Product | Primary center of gravity | Relative strength | GhostForge opportunity / caution |
|---|---|---|---|
| [Cursor Agent](https://cursor.com/help/ai-features/agent) | AI-native code editor and agent workflow. | Agent can search a codebase, edit multiple files, run terminal commands, iterate on errors, and expose modes for asking, planning, debugging, and implementation. | GhostForge can differentiate with a broader developer command center, TUI/CLI and local agent operations; it should not imply an equally polished inline editing loop without proving it. |
| [GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) (requested as “Copilot Workspace”) | GitHub-native asynchronous delegation on a branch. | Repository research, plans, changes, test/lint execution in an ephemeral GitHub Actions environment, review/iteration, and optional PR creation; integrates with issues and PRs. | GhostForge's local boss/worker workflow and multi-surface controls can serve users who want a local, self-managed agent workspace. GitHub's issue-to-branch-to-review path is a strong benchmark for clear asynchronous progress and evidence. |
| [Devin](https://docs.devin.ai/work-with-devin/advanced-capabilities) (Devin-style agents) | Managed autonomous software-engineering sessions. | Official docs describe parallel managed sessions in isolated VMs, coordination, session analysis, reusable playbooks, knowledge management, and schedules. | GhostForge should compete on control, inspectability, local integration, and accessible entry points—not make unqualified claims of equivalent autonomy, cloud isolation, or enterprise operation. |
| [AgenticOS](https://github.com/agenticos-ai/-agentic-os) (specific repository reviewed) | Lightweight AI-agent deployment starter. | The reviewed repository README emphasizes a small React deployment structure and a Vercel/Anthropic-key setup path. | This specific repository is better treated as a narrow starter/template than a proven feature-parity control plane. Do not generalize its status to every project named “agentic-os”; position GhostForge on breadth and integrated developer tooling. |
| [Hermes Workspace](https://github.com/outsourc-e/hermes-workspace) | Workspace/control panel for Hermes agents. | Its README positions it as an agent command center spanning chat, files, memory, skills, and terminal. | The focused agent workspace is a useful benchmark for cohesion. GhostForge has broader developer tools and surfaces; it can learn from a tighter central workspace around agent state, tools, and task context. |

## Prioritised improvement backlog

**Scoring:** Impact (I) and effort (E) are each rated 1–5, with 5 highest.
Priority is primarily leverage (`I ÷ E`), with dependencies and risk used to
break ties. A 5 for effort means a larger, multi-surface investment. These
are proposed outcomes, not claims that no work is already underway.

| Rank | ID | Improvement | I | E | Why now | Acceptance criteria |
|---:|---|---|:---:|:---:|---|---|
| 1 | B1 | Add a guided first-run setup and readiness checklist for project, model/provider, bridge, and optional integrations. | 5 | 2 | Setup/configuration is spread across several surfaces and many features have prerequisites. | A fresh user can see required vs optional setup, run a readiness check, get actionable missing-prerequisite steps, and reach a working chat/model path; automated tests cover ready, missing-key, bridge-offline, and optional-service states. |
| 2 | B2 | Normalize integration and capability health across web, TUI, CLI, and JARVIS. | 5 | 3 | External services and platform capabilities otherwise fail late and inconsistently. | A documented status contract distinguishes configured/ready, unavailable, stale, and error; at least one representative connector from each surface reports status and a next step; contract tests cover each state. |
| 3 | B3 | Define a cross-surface task/run identity and lifecycle contract for delegated work. | 5 | 4 | Dashboard, orchestration, workflows, history, and assistant context need to agree on what “this task” means. | A task created from an existing supported entry point retains a stable ID, owner/assignee, status, acceptance criteria, and result link through API, persisted state, and at least two consuming surfaces; tests verify updates and unknown states. |
| 4 | B4 | Complete and harden team/workflow composition with reusable templates and observable execution. | 5 | 4 | Agent teams are a core differentiator, but composition and run feedback must be dependable rather than merely visible. | An admin can create a valid leader/worker team, define dependencies and acceptance criteria, save/reload a template, launch it, and see per-task states; invalid references and unauthorized requests are rejected in route and UI tests. |
| 5 | B5 | Add a project-aware “start here” launcher that routes intent to an existing tool or workflow. | 4 | 2 | The feature catalogue is large; users should not need to know GhostForge's internal page/script map. | For a fixed, documented set of at least 10 common intents, the launcher routes to the correct reachable feature with project context or explicitly reports unsupported/partial capability; keyboard navigation and regression tests cover all choices. |
| 6 | B6 | Publish a capability/parity contract for every product surface and gate UI claims against it. | 4 | 2 | Current availability is broad but intentionally uneven. | A checked-in capability manifest or equivalent documented source lists each core journey by web/TUI/CLI/bridge/Electron/Android; CI or tests fail when a declared route/command is missing, and UI labels partial/external requirements. |
| 7 | B7 | Turn Android packaging into a validated, phone-first companion journey—or narrow its support claim. | 4 | 3 | Native build configuration alone does not establish a usable mobile experience. | A documented Android-device smoke path verifies sign-in/connection, one assistant interaction, permission denial/recovery, offline indication, and notification behavior; unsupported actions are labeled, not shown as working controls. |
| 8 | B8 | Define and test Electron's supported capability set across Windows, macOS, and Linux. | 4 | 3 | The app has many main-process integrations and OS-dependent permissions. | A platform matrix identifies supported integrations and prerequisites; CI or a repeatable test script builds and launches a smoke app on each supported OS and exercises one permission-denial and recovery case. |
| 9 | B9 | Make task/agent navigation and run evidence consistent across `/agents`, Agent World, workflows, and history. | 4 | 3 | Related operations are discoverable in multiple areas, which can split status and next steps. | From each selected agent task/run, users can find its current status, owning workflow, latest event/result, and history; empty/error/stale states are tested without presenting missing data as success. |
| 10 | B10 | Add dependency-aware preflight, safe failure messages, and recovery guidance to CLI/TUI actions. | 4 | 2 | Script breadth is useful only if operators can predict prerequisites and failure consequences. | A selected set of 10 high-use commands reports missing binaries, credentials, and services before side effects, exits non-zero on failure, and documents a recovery step; tests cover representative Windows and POSIX paths where applicable. |
| 11 | B11 | Establish an assistant-to-task handoff linking JARVIS conversation, delegated work, and final evidence. | 3 | 4 | Assistant capability exists across web/TUI/bridge/Electron, but continuity is not guaranteed by feature reachability. | A user can create one task from an assistant session and navigate both directions between conversation and task; the resulting task/result is persisted and access-controlled; integration tests verify the link. |
| 12 | B12 | Add a task-focused usage and integration-setup guide with ownership and freshness. | 3 | 2 | The repository has broad capability but relies on users to assemble a mental map. | The guide maps at least five user jobs to verified entry points, lists external requirements and platform limits, links to maintained implementation docs, and is checked for dead links in CI. |

## Top 10 backlog tasks

Each item below is independently verifiable and can be tracked as a separate
delivery task. These concise task definitions correspond to B1–B10 above.

1. **B1 — Ship first-run readiness.** Add a setup checklist for project,
   provider/model, bridge, and optional integrations. Verify automated ready,
   missing-credential, offline-bridge, and optional-service states, each with
   a user-actionable next step.
2. **B2 — Standardize integration health.** Define configured/ready,
   unavailable, stale, and error states; implement the contract for one
   representative integration per surface and test every state and recovery
   message.
3. **B3 — Persist task identity end to end.** Carry a stable task ID, owner,
   status, acceptance criteria, and result link from an existing creation
   surface through persisted state and two consumer surfaces; add tests for
   state transitions and missing/unknown values.
4. **B4 — Complete team/workflow templates.** Implement admin-validated team
   composition, dependency-aware tasks, acceptance criteria, save/reload
   templates, launch, and per-task run status; test happy path, invalid
   dependencies, and denied access.
5. **B5 — Build the task-intent launcher.** Route at least 10 documented
   intents to existing features with project context; test correct routes,
   keyboard use, and explicit unsupported/partial results.
6. **B6 — Publish and enforce surface capabilities.** Record core feature
   availability across web, TUI, CLI, bridge, Electron, and Android; add a
   test that detects a declared-but-unreachable route or command and verify
   that partial/external dependencies are disclosed.
7. **B7 — Validate the Android companion journey.** Document and execute a
   real-device smoke test for connection, assistant use, denied-permission
   recovery, offline behavior, and notifications; label unsupported functions.
8. **B8 — Verify Electron OS support.** Add an explicit feature/prerequisite
   matrix and repeatable build/launch smoke test for Windows, macOS, and Linux;
   verify an OS permission denial does not fail silently.
9. **B9 — Unify agent-run evidence.** Provide status, workflow association,
   latest result/event, and history navigation for a task across `/agents`,
   Agent World, workflows, and history; test populated, empty, stale, and
   error states.
10. **B10 — Add CLI/TUI preflight and recovery.** For 10 high-use actions,
    detect prerequisites before side effects, return a failing exit status
    when blocked, show recovery instructions, and test representative platform
    differences.

## References and evidence

- Repository snapshot and evidence map: [`FEATURE-MATRIX.md`](FEATURE-MATRIX.md).
- Agent World contract and connector behavior:
  [`AGENT-WORLD.md`](AGENT-WORLD.md).
- Product and team operating context:
  [`SESSION-HANDOFF.md`](SESSION-HANDOFF.md).
- Cursor Agent documentation:
  <https://cursor.com/help/ai-features/agent>.
- GitHub Copilot cloud-agent documentation:
  <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent>.
- Devin advanced capabilities:
  <https://docs.devin.ai/work-with-devin/advanced-capabilities>.
- AgenticOS repository README:
  <https://github.com/agenticos-ai/-agentic-os>.
- Hermes Workspace repository README:
  <https://github.com/outsourc-e/hermes-workspace>.
