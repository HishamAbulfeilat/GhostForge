# GhostForge feature matrix

This is a reachability audit of the repository as shipped, not a list of
roadmap claims. A feature is **reachable** when a user can invoke it from the
surface named in the column:

- **Web UI** means a page/component in `web-ui/app` or a web API that powers a
  visible page.
- **TUI** means a reachable screen/command in `tui/index.js`.
- **Terminal CLI** means a direct entry point via the CLI dispatcher (`cli/index.js` → scripts/*, or direct scripts); `bin/ghostforge` is a wrapper at this revision.
- **JARVIS** means a handler in `mark-l-bridge/server.py`, including the
  Mark-LV and opt-in OpenJarvis APIs.

`✅` is directly reachable, `⚠️` is available only as a lower-level/partial
surface (or requires an external service), and `❌` is not exposed by that
surface. The evidence column names the implementation that was checked.

| Feature | Web UI | TUI | Terminal CLI | JARVIS / bridge | Evidence |
|---|:---:|:---:|:---:|:---:|---|
| Dashboard, GitHub issues/PRs/actions | ✅ | ✅ | ✅ | ✅ | `app/dashboard`, `screenDashboard`, `scripts/dashboard.sh`, bridge `GET /api/github/dashboard` (`mark-l-bridge/github_dashboard.py`, read-only via gh or `GITHUB_TOKEN`, structured unavailable response) |
| Chat / unified model chat | ✅ | ✅ | ✅ | ✅ | `app/chat`, `screenGFAIChat`, `scripts/gemini.sh`, `/api/mark-l/chat/unified` |
| Chat chains / multi-model routing | ✅ | ✅ | ✅ | ✅ | `app/chat`, `screenChatChain`, `screenGFAIChat`, `scripts/ai-review.sh`, `/api/mark-l/chat/chain` |
| Web terminal / PTY | ✅ | ❌ | ✅ | ❌ | `app/terminal`, `scripts/pty-server.js` |
| Files browser and Monaco editor | ✅ | ⚠️ | ⚠️ | ✅ | `app/files`, `screenOpenProject`, `ghostforge files list\|read` (`scripts/files.mjs`, read-only, no editor), `/api/mark-l/file-control` |
| History and audit log | ✅ | ✅ | ✅ | ✅ | `app/history`, `screenAuditLog`, `scripts/daily-digest.sh`, bridge memory/history handlers |
| Command catalog / feature launcher | ✅ | ✅ | ✅ | ✅ | `app/features`, `screenCommands`/`screenCommandCenter`, `scripts/*`, bridge `GET /api/commands` (`mark-l-bridge/commands_catalog.py`, read-only) |
| Project open, project list, scaffolding | ⚠️ | ✅ | ✅ | ❌ | `app/setup`, `screenProjects`/`screenOpenProject`, `scripts/create-project.sh` |
| Setup and environment configuration | ✅ | ✅ | ✅ | ✅ | `app/setup`, `screenSetup`, `scripts/setup-env.sh`/`scripts/env-manager.sh`, bridge `GET /api/setup/status` (`mark-l-bridge/setup_status.py`, read-only presence/version status) |
| AI agents dashboard and dispatch | ✅ | ✅ | ⚠️ | ✅ | `app/agents`, `screenAgents`, `cli/index.js` → `scripts/agents/team.mjs`, `/api/mark-l/agents/*` |
| Agent World (federated agent and connector operations) | ✅ | ⚠️ | ⚠️ | ⚠️ | `app/agent-world` (worlds: forge/town/office/team); `screenWorlds` and `screenAgentTeam`; `cli/index.js` → `scripts/worlds.mjs` and `scripts/agents/team.mjs`; bridge `/api/mark-l/agents/*` provides lower-level operations |
| Agent teams, crews, tasks, messages | ✅ | ✅ | ⚠️ | ✅ | `app/agents`, `screenAgentTeam`, `cli/index.js` → `scripts/agents/team.mjs` (teams only; crews via bridge), `/api/mark-l/agents/crew/*` |
| JARVIS assistant | ✅ | ✅ | ✅ | ✅ | `app/jarvis`, `screenJarvis`, `app/api/jarvis/route.ts`, bridge health/chat, `scripts/jarvis.mjs` (`ghostforge jarvis health / ask`) |
| Voice input (STT) | ✅ | ✅ | ✅ | ❌ | `app/jarvis`, `screenVoice`, `scripts/voice.sh`, `app/api/jarvis/stt` |
| Voice output (TTS) | ✅ | ✅ | ✅ | ❌ | `app/jarvis`, `screenVoice`, `scripts/voice.sh`, `app/api/jarvis/tts` |
| Voice clone / voicebox | ✅ | ⚠️ | ✅ | ❌ | `app/jarvis`, `VoiceboxPanel`, `scripts/voice.sh` |
| JARVIS language/model selection | ✅ | ✅ | ✅ | ✅ | `app/jarvis`, `screenModelSelect`, `scripts/free-models.sh`, bridge model APIs |
| Screen capture, vision and OCR | ✅ | ✅ | ⚠️ | ✅ | `app/mac-control`/`app/jarvis`, `screenMacControl`, `/api/mark-l/screen-capture`, `/api/mark-l/ocr` |
| Cursor/macOS computer control | ✅ | ✅ | ⚠️ | ✅ | `app/mac-control`, `screenMacControl`, `scripts/ui-tars.sh`, `/api/mark-l/computer-control` |
| Browser automation and web search | ⚠️ | ✅ | ✅ | ✅ | `app/jarvis`/`app/remote`, `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-l/browser/*` |
| Clipboard, desktop and app launching | ⚠️ | ✅ | ⚠️ | ✅ | `app/mac-control`, `screenMacControl`, `/api/mark-l/clipboard`, `/desktop`, `/open-app` |
| Memory (CRUD, semantic search, import/export) | ✅ | ✅ | ✅ | ✅ | `app/jarvis`, `screenMemory` (tui/index.js line 767), `scripts/setup-memory.sh`, `/api/mark-l/memory/*` |
| Proactive assistant, morning briefing and inbox | ✅ | ✅ | ✅ | ❌ | `app/api/jarvis/proactive`, `app/api/jarvis/morning`, `scripts/daily-digest.sh`, TUI `screenBriefing` in `tui/index.js` (menu "Morning Briefing & Inbox"; calls both routes on `GF_WEB_UI_URL`, needs `GF_WEB_UI_TOKEN` session cookie; offline/401 messages) |
| Jarvis collaboration and sharing | ✅ | ✅ | ✅ | ✅ | `app/api/jarvis/collab`, `CollabShare`, `screenCollaboration`, `cli/index.js` + `scripts/collab.mjs`, bridge `/api/jarvis/collab` |
| Job Hunter (search, profile, CV, GitHub) | ✅ | ⚠️ | ✅ | ✅ | `app/jobs`, `JobHunterWidget`, `scripts/job-hunter.mjs`/`scripts/jobs.sh`, bridge `/api/jobs` backed by the real user-scoped profile and review-only autopilot flow |
| Workflow engine and workflow runs | ✅ | ✅ | ✅ | ✅ | `app/workflows` lists workflows and runs one via `/api/workflows` `action: run` with loading, error/retry, per-step result and allowlist-warning states (`app/workflows/runnable.ts` mirrors the bridge allowlist; runnable "Release readiness check" template; `web-ui/test/workflows-page.test.js`), `screenWorkflows`, `scripts/workflows.mjs`, bridge `/api/workflows?action=run` executes only allowlisted command steps and enforces `--max-steps 1-100` |
| n8n automation | ✅ | ✅ | ✅ | ✅ | `app/automation`, `screenN8n`, `cli/index.js` + `scripts/n8n.mjs`, bridge `/api/n8n/workflows` and `/api/n8n/trigger`; TUI can list and safely trigger active POST/ALL webhooks with confirmation and URL/API-key safeguards |
| Webhooks and trigger automation | ✅ | ✅ | ✅ | ✅ | `app/automation`, `screenWebhooks`, `/api/webhook`, `scripts/webhooks.mjs`, bridge webhook config/log/clear contract |
| Orchestrated multi-agent work | ✅ | ⚠️ | ✅ | ✅ | `app/orchestrate`, `OrchestratePanel`, `/api/jarvis/orchestrate`, `/api/mark-l/agents` |
| Remote setup and device management | ✅ | ✅ | ✅ | ✅ | `app/remote`, `app/api/remote/setup`, `screenDeviceInstall`, `scripts/setup-https.sh`, bridge `/api/remote/setup` and `/api/devices` for registry + bounded remote actions |
| Push notifications | ✅ | ✅ | ✅ | ❌ | `app/notifications`, `PushNotificationPanel`, `app/api/push`/service worker, `screenDeviceStatus`, `scripts/device-status.mjs push` |
| Device status and registry | ✅ | ✅ | ✅ | ✅ | `DeviceStatus`, `app/api/devices`, `screenDeviceStatus`, `scripts/device-status.mjs status`, bridge `/api/devices` + `/api/devices/status` |
| Models catalog, install and recommendations | ✅ | ✅ | ✅ | ✅ | `app/models`, `screenModelSelect`, `scripts/free-models.sh`, `/api/mark-l/models/*` |
| LLMFit model matching and auto-switch | ✅ | ✅ | ✅ | ❌ | `app/models`, `LLMfitAutoSwitch`, `screenLLMFit`, `scripts/free-models.sh` |
| Hugging Face model search | ✅ | ✅ | ✅ | ✅ | `app/marketplace`, `/api/huggingface`, `screenMarketplace`, `ghostforge models search <query>` (cli/index.js), bridge model search |
| Awesome LLM apps catalog | ✅ | ✅ | ✅ | ❌ | `app/marketplace`, `screenMarketplace`, `/api/awesome-llm-apps`, `scripts/awesome-llm-apps.mjs` |
| Marketplace catalog and install state | ✅ | ✅ | ✅ | ✅ | `app/marketplace`, `screenMarketplace`, `scripts/marketplace.sh`, bridge `GET /api/marketplace` (mark-l-bridge/server.py line 2650, _read_marketplace_json) |
| Custom model/API keys | ✅ | ⚠️ | ✅ | ⚠️ | `app/models`, `/api/models/custom`, `/api/models/keys`, bridge model install |
| OpenJarvis health, doctor and ask | ✅ | ✅ | ✅ | ✅ | `OpenJarvisPanel`, `app/api/openjarvis`, `screenOpenJarvis` (tui/index.js), `scripts/mark-liv.sh`, `/api/openjarvis/*` |
| Mark-LV tools and tool runner | ✅ | ✅ | ✅ | ✅ | `MarkLPanel`, `MarkLivToolsPanel` on `app/jarvis` via `app/api/mark-liv-tools`, `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-liv/tools` and `/run` |
| Weather, flights and reminders | ✅ | ✅ | ✅ | ✅ | `MarkLivToolsPanel` on `app/jarvis` via `app/api/mark-liv-tools`, `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-l/weather`, `/flight-finder`, `/reminder` |
| YouTube and game updater | ✅ | ✅ | ✅ | ✅ | `DeviceControlsPanel`, dashboard, `screenIntegrationsHub`, `scripts/mark-liv.sh`, `/api/mark-l/youtube`, `/game-updater` |
| Files/process control | ✅ | ✅ | ✅ | ✅ | `app/files`, `screenOpenProject`, `scripts/open-project.sh`, `/api/mark-l/file-process` |
| Code helper and developer agent | ⚠️ | ✅ | ✅ | ✅ | `app/chat`, `screenGFAIChat`, `scripts/explain.sh`, `/api/mark-l/code-helper`, `/dev-agent` |
| Security scan and pentest helpers | ✅ | ✅ | ✅ | ✅ | `app/security` + `app/api/security-scan` (admin-only, defensive scanners), `app/features`, `screenSecurity`, `scripts/security-check.sh`/`scripts/pentest.sh`, bridge `GET/POST /api/security-scan` (token-auth, mark-l-bridge/security_scan.py) |
| Doctor, health and diagnostics | ✅ | ✅ | ✅ | ✅ | `app/dashboard` + `app/api/doctor`, `screenDoctor`/`screenHealth`, `scripts/doctor.sh`/`health-check.sh`, bridge `/health` |
| Testing and coverage | ✅ | ✅ | ✅ | ✅ | `app/testing/page.tsx` + `app/api/test-run/route.ts` (admin-only test-run/coverage panel), `app/features`, `screenTest`, `scripts/test-all-features.sh`/`coverage.sh`, bridge `GET`/`POST /api/code-health` (`coverage` id, token auth) |
| Deploy and Azure tooling | ⚠️ | ✅ | ✅ | ✅ | `app/features`, `screenDeploy`, `scripts/deploy-azure.sh`, bridge `/api/release` deploy action |
| Git hooks, upgrades and release tooling | ✅ | ✅ | ✅ | ✅ | `app/maintenance`, `screenGitHooks`/`screenUpgrade`, `scripts/git-hooks.sh`/`upgrade.sh`/`release.sh`, bridge `/api/release` (status/prepare/notes/deploy) |
| API docs/types/mock generation | ✅ | ✅ | ✅ | ❌ | `app/api-docs`, `app/api-types`, `app/mock-api`, `app/api/execute`, `screenAPITypes`/`screenMockApi`, `scripts/api-docs.sh`/`api-types.sh`/`api-mock.sh` |
| i18n and RTL tooling | ⚠️ | ✅ | ✅ | ❌ | `app/layout.tsx`, `screenRTL`, `scripts/i18n.sh`/`rtl.sh` |
| Snippets, changelog, README and onboarding | ✅ | ✅ | ✅ | ✅ | `/snippets` (authenticated route, linked from `Navbar` and the command palette) and `/api/snippets` for snippets, `CHANGELOG.md`, and `README.md`; `screenSnippets`/`screenChangelogViewer`/`screenReadme`/`screenOnboardDev`, `scripts/snippet-manager.sh`/`changelog.sh`/`onboard-dev.sh`, bridge `GET /api/snippets`, `/api/snippets/{name}`, `/api/docs/{name}` (`mark-l-bridge/snippets_docs.py`, read-only) |
| Tickets, Azure DevOps and estimates | ✅ | ✅ | ✅ | ❌ | `app/tickets/page.tsx` + `app/api/tickets/route.ts` (admin-only panel), `screenTickets`/`screenAdo`/`screenEstimate`, `scripts/ticket.sh`/`ado.sh`/`estimate.sh` |
| Performance, bundle, unused-code and dependency health | ✅ | ✅ | ✅ | ✅ | `app/code-health/page.tsx` + `app/api/code-health/route.ts`, `screenPerf`/`screenBundle`/`screenUnused`, `scripts/perf.sh`/`bundle.sh`/`unused.sh`/`dep-health.sh`, bridge `GET`/`POST /api/code-health` (token auth) |
| Free APIs/models and provider setup | ✅ | ✅ | ✅ | ✅ | `app/models`, `screenFreeAPIs`/`screenFreeModels`, `scripts/free-models.sh`/`free-models.sh`, bridge `GET /api/free-apis` (token auth, key presence flags only, mark-l-bridge/resource_catalogs.py) |
| Users, login and access profiles | ✅ | ✅ | ✅ | ❌ | `app/login`, `app/users`, `app/api/auth`, `app/api/users`, `cli/index.js` + `scripts/users.mjs`, `screenUsers` |
| Bridge start/status and connection controls | ✅ | ✅ | ✅ | ✅ | `BridgeControl`, `screenHealth`, `scripts/bridge-server.js`, bridge `/api/mark-l/health` |
| Electron desktop integrations | ❌ | ❌ | ❌ | ⚠️ | Runtime integrations are in `electron-app/src/main/*` and accessible in the Electron app; `scripts/build-electron.sh` is packaging only; bridge overlap is partial |
| Android/iOS packaged app | ❌ | ❌ | ✅ | ❌ | `electron-app/android`, `electron-app/ios`, `scripts/build-android.sh`/`build-ios.sh` |
| Design resources, Vigolium and open-source tools | ✅ | ✅ | ✅ | ✅ | `app/design-resources`, `app/vigolium`, `app/open-source-tools`, `screenDesignResources`/`screenVigolium`/`screenOpenSourceTools`, `scripts/figma-tokens.sh`, bridge `GET /api/design-resources` (token auth, read-only, mark-l-bridge/resource_catalogs.py) |

## Concrete gaps

These are implementation limitations in the current checkout, not task-status
or blocked-work claims:

- All n8n surfaces are now wired: TUI can list and safely trigger active POST/ALL
  webhooks with confirmation and safeguards; terminal CLI (`ghostforge n8n`) is
  fully dispatched; bridge endpoints (`/api/n8n/workflows`, `/api/n8n/trigger`)
  are available. The remaining limitation is that all surfaces require a running
  external n8n service; n8n itself is not bundled or managed by GhostForge.
- JARVIS device handlers now expose live device status and bounded remote setup
  actions, in addition to persisted registry CRUD; the remaining limitation is
  that live host availability still depends on the local bridge environment.
- Electron-only integrations are available inside the packaged Electron app,
  but have no TUI or direct terminal CLI runtime controls. The build script is
  packaging support only. Android/iOS packaging likewise has CLI build scripts,
  but no web, TUI, or JARVIS app-control surface.

## Validation

Snapshot checked 2026-10-03 (refreshed stale rows for T-184 security-scan bridge endpoint, T-185 OpenJarvis TUI screen, T-186 testing/coverage web panel, T-187 Hugging Face CLI search):

- `node --check tui/index.js` — PASS (TUI syntax).
- `npm test` — PASS (root smoke suite).
- `node scripts/agents/health.mjs` — PASS (health 100/100).

The web route/navigation audit confirmed `/snippets` serves snippets and the
repository README/changelog through its authenticated API, and `/agent-world`
is linked from `Navbar`. The TUI source audit confirmed `screenN8n`,
`screenCollaboration`, and device screens are reachable from the menu. The CLI
dispatcher (`cli/index.js`) now wires
`ghostforge n8n`, `ghostforge collab`, `ghostforge users`, and `ghostforge device-status`
commands to their respective implementation scripts. The bridge provides `/api/n8n/workflows`,
`/api/n8n/trigger`, `/api/jarvis/collab`, `/api/devices`, and `/api/devices/status`
endpoints. These checks do not exercise a live n8n service; its endpoint and credentials
remain external prerequisites.

## Audit sources

The matrix was derived from these implementation surfaces in this revision:

- Web: `web-ui/app/**`, `web-ui/components/**`, and `web-ui/app/api/**`.
- TUI: `tui/index.js` screen declarations and the dispatch table near the
  program loop, including `screenWorkflows`, `screenN8n`, and `screenWebhooks`.
- CLI: the executable scripts in `scripts/`, especially `scripts/workflows.mjs`
  and `scripts/webhooks.mjs`, plus the agent-team commands under
  `scripts/agents/`.
- JARVIS: route decorators and handlers in `mark-l-bridge/server.py`, plus
  the Mark-LV/OpenJarvis adapters it calls.
