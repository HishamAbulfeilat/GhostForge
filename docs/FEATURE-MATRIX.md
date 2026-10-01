# GhostForge feature matrix

This is a reachability audit of the repository as shipped, not a list of
roadmap claims. A feature is **reachable** when a user can invoke it from the
surface named in the column:

- **Web UI** means a page/component in `web-ui/app` or a web API that powers a
  visible page.
- **TUI** means a reachable screen/command in `tui/index.js`.
- **Terminal CLI** means a direct entry point under `scripts/` (the scripts are
  the current CLI; `bin/ghostforge` is only a wrapper at this revision).
- **JARVIS** means a handler in `mark-l-bridge/server.py`, including the
  Mark-LV and opt-in OpenJarvis APIs.

`✅` is directly reachable, `⚠️` is available only as a lower-level/partial
surface (or requires an external service), and `❌` is not exposed by that
surface. The evidence column names the implementation that was checked.

| Feature | Web UI | TUI | Terminal CLI | JARVIS / bridge | Evidence |
|---|:---:|:---:|:---:|:---:|---|
| Dashboard, GitHub issues/PRs/actions | ✅ | ✅ | ✅ | ❌ | `app/dashboard`, `screenDashboard`, `scripts/dashboard.sh` |
| Chat / unified model chat | ✅ | ✅ | ✅ | ✅ | `app/chat`, `screenGFAIChat`, `scripts/gemini.sh`, `/api/mark-l/chat/unified` |
| Chat chains / multi-model routing | ✅ | ⚠️ | ✅ | ✅ | `app/chat`, `screenGFAIChat`, `scripts/ai-review.sh`, `/api/mark-l/chat/chain` |
| Web terminal / PTY | ✅ | ❌ | ✅ | ❌ | `app/terminal`, `scripts/pty-server.js` |
| Files browser and Monaco editor | ✅ | ⚠️ | ❌ | ✅ | `app/files`, `screenOpenProject`, `/api/mark-l/file-control` |
| History and audit log | ✅ | ✅ | ✅ | ✅ | `app/history`, `screenAuditLog`, `scripts/daily-digest.sh`, bridge memory/history handlers |
| Command catalog / feature launcher | ✅ | ✅ | ✅ | ❌ | `app/features`, `screenCommands`/`screenCommandCenter`, `scripts/*` |
| Project open, project list, scaffolding | ⚠️ | ✅ | ✅ | ❌ | `app/setup`, `screenProjects`/`screenOpenProject`, `scripts/create-project.sh` |
| Setup and environment configuration | ✅ | ✅ | ✅ | ❌ | `app/setup`, `screenSetup`, `scripts/setup-env.sh`/`scripts/env-manager.sh` |
| AI agents dashboard and dispatch | ✅ | ✅ | ⚠️ | ✅ | `app/agents`, `screenAgents`, `scripts/agents/team.mjs`, `/api/mark-l/agents/*` |
| Agent teams, crews, tasks, messages | ✅ | ✅ | ⚠️ | ✅ | `app/agents`, `screenAgentTeam`, `scripts/agents/team.mjs`, `/api/mark-l/agents/crew/*` |
| JARVIS assistant | ✅ | ✅ | ⚠️ | ✅ | `app/jarvis`, `screenJarvis`, `app/api/jarvis/route.ts`, bridge health/chat |
| Voice input (STT) | ✅ | ✅ | ✅ | ❌ | `app/jarvis`, `screenVoice`, `scripts/voice.sh`, `app/api/jarvis/stt` |
| Voice output (TTS) | ✅ | ✅ | ✅ | ❌ | `app/jarvis`, `screenVoice`, `scripts/voice.sh`, `app/api/jarvis/tts` |
| Voice clone / voicebox | ✅ | ⚠️ | ✅ | ❌ | `app/jarvis`, `VoiceboxPanel`, `scripts/voice.sh` |
| JARVIS language/model selection | ✅ | ✅ | ✅ | ✅ | `app/jarvis`, `screenModelSelect`, `scripts/free-models.sh`, bridge model APIs |
| Screen capture, vision and OCR | ✅ | ✅ | ⚠️ | ✅ | `app/mac-control`/`app/jarvis`, `screenMacControl`, `/api/mark-l/screen-capture`, `/api/mark-l/ocr` |
| Cursor/macOS computer control | ✅ | ✅ | ⚠️ | ✅ | `app/mac-control`, `screenMacControl`, `scripts/ui-tars.sh`, `/api/mark-l/computer-control` |
| Browser automation and web search | ⚠️ | ✅ | ✅ | ✅ | `app/jarvis`/`app/remote`, `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-l/browser/*` |
| Clipboard, desktop and app launching | ⚠️ | ✅ | ⚠️ | ✅ | `app/mac-control`, `screenMacControl`, `/api/mark-l/clipboard`, `/desktop`, `/open-app` |
| Memory (CRUD, semantic search, import/export) | ✅ | ⚠️ | ✅ | ✅ | `app/jarvis`, `scripts/setup-memory.sh`, `/api/mark-l/memory/*` |
| Proactive assistant, morning briefing and inbox | ✅ | ⚠️ | ✅ | ❌ | `app/api/jarvis/proactive`, `app/api/jarvis/morning`, `scripts/daily-digest.sh` |
| Jarvis collaboration and sharing | ✅ | ❌ | ❌ | ✅ | `app/api/jarvis/collab`, `CollabShare`, bridge `/api/jarvis/collab` |
| Job Hunter (search, profile, CV, GitHub) | ✅ | ⚠️ | ✅ | ⚠️ | `app/jobs`, `JobHunterWidget`, `scripts/job-hunter.mjs`/`scripts/jobs.sh`, bridge `/api/jobs` (limited actions; search/autopilot are stubs) |
| Workflow engine and workflow runs | ✅ | ⚠️ | ❌ | ⚠️ | `app/workflows`, `/api/workflows`, bridge `/api/workflows` (persisted state/actions, no run executor); no dedicated `screenWorkflow` or CLI entry point |
| n8n automation | ✅ | ⚠️ | ❌ | ❌ | `app/automation`, `electron-app/src/main/n8n-integration.ts` |
| Webhooks and trigger automation | ✅ | ❌ | ❌ | ✅ | `app/automation`, `/api/webhook`, bridge `/api/webhook`; no TUI screen or CLI entry point |
| Orchestrated multi-agent work | ✅ | ⚠️ | ✅ | ✅ | `app/orchestrate`, `OrchestratePanel`, `/api/jarvis/orchestrate`, `/api/mark-l/agents` |
| Remote setup and device management | ✅ | ✅ | ✅ | ⚠️ | `app/remote`, `app/api/remote/setup`, `screenDeviceInstall`, `scripts/setup-https.sh`, bridge `/api/devices` (registry only) |
| Push notifications | ⚠️ | ✅ | ✅ | ❌ | `app/api/push`/service worker (no visible push-management page), `screenDeviceStatus`, `scripts/device-status.mjs push` |
| Device status and registry | ✅ | ✅ | ✅ | ⚠️ | `DeviceStatus`, `app/api/devices`, `screenDeviceStatus`, `scripts/device-status.mjs status`, bridge `/api/devices` (registry, not live status) |
| Models catalog, install and recommendations | ✅ | ✅ | ✅ | ✅ | `app/models`, `screenModelSelect`, `scripts/free-models.sh`, `/api/mark-l/models/*` |
| LLMFit model matching and auto-switch | ✅ | ✅ | ✅ | ❌ | `app/models`, `LLMfitAutoSwitch`, `screenLLMFit`, `scripts/free-models.sh` |
| Hugging Face model search | ✅ | ✅ | ⚠️ | ✅ | `app/marketplace`, `/api/huggingface`, `screenMarketplace`, bridge model search |
| Awesome LLM apps catalog | ✅ | ✅ | ✅ | ❌ | `app/marketplace`, `screenMarketplace`, `/api/awesome-llm-apps`, `scripts/awesome-llm-apps.mjs` |
| Marketplace catalog and install state | ✅ | ✅ | ✅ | ❌ | `app/marketplace`, `screenMarketplace`, `scripts/marketplace.sh` |
| Custom model/API keys | ✅ | ⚠️ | ✅ | ⚠️ | `app/models`, `/api/models/custom`, `/api/models/keys`, bridge model install |
| OpenJarvis health, doctor and ask | ✅ | ⚠️ | ✅ | ✅ | `OpenJarvisPanel`, `app/api/openjarvis`, `scripts/mark-liv.sh`, `/api/openjarvis/*` |
| Mark-LV tools and tool runner | ⚠️ | ✅ | ✅ | ✅ | `MarkLPanel`, `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-liv/tools` and `/run` |
| Weather, flights and reminders | ⚠️ | ✅ | ✅ | ✅ | `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-l/weather`, `/flight-finder`, `/reminder` |
| YouTube and game updater | ✅ | ✅ | ✅ | ✅ | `DeviceControlsPanel`, dashboard, `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-l/youtube`, `/game-updater` |
| Files/process control | ✅ | ✅ | ✅ | ✅ | `app/files`, `screenOpenProject`, `scripts/open-project.sh`, `/api/mark-l/file-process` |
| Code helper and developer agent | ⚠️ | ✅ | ✅ | ✅ | `app/chat`, `screenGFAIChat`, `scripts/explain.sh`, `/api/mark-l/code-helper`, `/dev-agent` |
| Security scan and pentest helpers | ⚠️ | ✅ | ✅ | ❌ | `app/features`, `screenSecurity`, `scripts/security-check.sh`/`scripts/pentest.sh` |
| Doctor, health and diagnostics | ✅ | ✅ | ✅ | ✅ | `app/doctor`, `screenDoctor`/`screenHealth`, `scripts/doctor.sh`/`health-check.sh`, bridge `/health` |
| Testing and coverage | ⚠️ | ✅ | ✅ | ❌ | `app/features`, `screenTest`, `scripts/test-all-features.sh`/`coverage.sh` |
| Deploy and Azure tooling | ⚠️ | ✅ | ✅ | ❌ | `app/features`, `screenDeploy`, `scripts/deploy-azure.sh` |
| Git hooks, upgrades and release tooling | ❌ | ✅ | ✅ | ⚠️ | `screenGitHooks`/`screenUpgrade`, `scripts/git-hooks.sh`/`upgrade.sh`/`release.sh`, bridge `/api/release` (status/prepare/notes only) |
| API docs/types/mock generation | ✅ | ✅ | ✅ | ❌ | `app/api-docs`, `app/api-types`, `app/mock-api`, `app/api/execute`, `screenAPITypes`/`screenMockApi`, `scripts/api-docs.sh`/`api-types.sh`/`api-mock.sh` |
| i18n and RTL tooling | ⚠️ | ✅ | ✅ | ❌ | `app/layout.tsx`, `screenRTL`, `scripts/i18n.sh`/`rtl.sh` |
| Snippets, changelog, README and onboarding | ❌ | ✅ | ✅ | ❌ | `screenSnippets`/`screenChangelogViewer`/`screenReadme`/`screenOnboardDev`, `scripts/snippet-manager.sh`/`changelog.sh`/`onboard-dev.sh` |
| Tickets, Azure DevOps and estimates | ⚠️ | ✅ | ✅ | ❌ | `screenTickets`/`screenAdo`/`screenEstimate`, `scripts/ticket.sh`/`ado.sh`/`estimate.sh` |
| Performance, bundle, unused-code and dependency health | ⚠️ | ✅ | ✅ | ❌ | `screenPerf`/`screenBundle`/`screenUnused`, `scripts/perf.sh`/`bundle.sh`/`unused.sh`/`dep-health.sh` |
| Free APIs/models and provider setup | ✅ | ✅ | ✅ | ❌ | `app/models`, `screenFreeAPIs`/`screenFreeModels`, `scripts/free-models.sh`/`free-models.sh` |
| Users, login and access profiles | ✅ | ❌ | ❌ | ❌ | `app/login`, `app/users`, `app/api/auth`, `app/api/users` |
| Bridge start/status and connection controls | ✅ | ✅ | ✅ | ✅ | `BridgeControl`, `screenHealth`, `scripts/bridge-server.js`, bridge `/api/mark-l/health` |
| Electron desktop integrations | ❌ | ❌ | ✅ | ⚠️ | `electron-app/src/main/*`, `scripts/build-electron.sh`; bridge overlap is partial |
| Android/iOS packaged app | ❌ | ❌ | ✅ | ❌ | `electron-app/android`, `electron-app/ios`, `scripts/build-android.sh`/`build-ios.sh` |
| Design resources, Vigolium and open-source tools | ✅ | ✅ | ✅ | ❌ | `app/design-resources`, `app/vigolium`, `app/open-source-tools`, `screenDesignResources`/`screenVigolium`/`screenOpenSourceTools`, `scripts/figma-tokens.sh` |

## Concrete gaps

Completed T-051 through T-057 surfaces are reflected in the matrix above and
are not repeated here. The checklist records concrete missing or partial
cross-surface work; `⚠️` cells are intentionally called out where they mark a
specific limitation.

- [ ] Add TUI and terminal CLI collaboration/sharing controls for JARVIS.
- [ ] Expose user, login and access-profile administration in the TUI or
  terminal CLI.
- [ ] Add dedicated TUI and terminal CLI controls for workflow runs, n8n
  automation and webhook trigger management.
- [ ] Add a web UI for Git hooks, upgrades and release management; the bridge
  release contract currently exposes status, preparation and notes actions
  only.
- [ ] Add deployment/Azure operations to the JARVIS bridge; its current
  release contract does not perform deployments.
- [ ] Implement workflow execution in the JARVIS bridge beyond persisted
  workflow state and step updates.
- [ ] Extend the JARVIS jobs contract beyond limited state actions and stub
  search/autopilot responses.
- [ ] Add a visible web UI for managing push notifications; the existing push
  API and service worker do not provide a management page.
- [ ] Provide JARVIS live device-status and remote-setup operations beyond the
  current persisted device registry.
- [ ] Add a TUI and terminal CLI surface for Electron-only desktop
  integrations and packaged mobile apps, or document them as desktop-only
  capabilities.

## Audit sources

The matrix was derived from these implementation surfaces in this revision:

- Web: `web-ui/app/**`, `web-ui/components/**`, and `web-ui/app/api/**`.
- TUI: `tui/index.js` screen declarations and the dispatch table near the
  program loop.
- CLI: every executable script in `scripts/`, including the agent-team
  commands under `scripts/agents/`.
- JARVIS: route decorators and handlers in `mark-l-bridge/server.py`, plus
  the Mark-LV/OpenJarvis adapters it calls.
