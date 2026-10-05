# CI workflows and known failure modes

| Workflow | Runs on | What it checks |
|---|---|---|
| **PR Quality Check** (`pr-check.yml`) | pull requests | ESLint (web-ui), tests, env-check, unused code, RTL classes, React Doctor, npm audit — posts one summary comment |
| **Security** (`security.yml`) | PRs, pushes to `main`, weekly | Dependency review, npm audit gate (high/critical), gitleaks secret scan, security regression tests, CycloneDX SBOMs |
| **CodeQL** (`codeql.yml`) | PRs and pushes to `main` / `agent/integration`, weekly | CodeQL `security-extended` code scanning for JavaScript/TypeScript and Python → Security → Code scanning when the repo is public; run summary + SARIF artifact while private ([details](#codeql-code-scanning), [CODE-SCANNING.md](CODE-SCANNING.md)) |
| **Build Apps** (`build-apps.yml`) | pushes to `main`, `v*` tags | Windows, Linux, macOS, Android, iOS builds; tags publish a Release (signing: [SIGNING.md](SIGNING.md)) |

## CodeQL code scanning

`codeql.yml` runs one matrix job per language (`javascript-typescript`,
`python`) with `build-mode: none` and the `security-extended` query suite, on
pushes and pull requests to `main` and `agent/integration`, every Tuesday at
04:41 UTC, and on manual dispatch. The workflow defaults to
`contents: read`; only the analyze job gets `security-events: write` (and
`actions: read`) so it can upload SARIF. When the repository is public, results
appear under **Security → Code scanning**, one category per language
(`/language:javascript-typescript`, `/language:python`). While it is private,
GitHub refuses uploads without paid Code Security, so the job runs with
`upload: never`, lists the findings on the run's Summary page and keeps the
SARIF as a `codeql-<language>` artifact. The job reads the visibility from the
API on every run, so making the repo public turns uploads on with no edits; see
[CODE-SCANNING.md](CODE-SCANNING.md).

Third-party and generated code is excluded with `paths-ignore`:
`**/node_modules/**` (including the still-tracked `tui/node_modules`),
`vendor/**` (Mark-LV), `web-ui/vendor/**`, the gitignored world-app checkouts
under `apps/worlds/*/`, the bundled `extension/dist/**`, and the Capacitor
`electron-app/android|ios` projects. Fix findings in first-party code; if a path
is genuinely third-party, add it to `paths-ignore` rather than dismissing
alerts one by one. Dismiss false positives in the Code scanning UI with a reason.

`codeql.yml` is the only CodeQL workflow. `security.yml` used to carry a
JavaScript-only CodeQL job; it was removed because `codeql.yml` covers the same
`/language:javascript-typescript` category plus Python and `agent/integration`.
If Code scanning still lists the old `security.yml` analysis as a stale
configuration, delete that configuration from the alert view; `codeql.yml`
reports the same findings under its own configuration.

## Troubleshooting

Every entry below was hit for real while setting these builds up.

### Android build scripts: CI-safe and portable
`electron-app/scripts/build-android.sh` now validates `JAVA_HOME`/`ANDROID_HOME`/`ANDROID_SDK_ROOT`, accepts a target (`debug`, `release`, or `bundle`), and exits cleanly with a clear error when the JDK or SDK is missing. It avoids host-specific assumptions (no macOS-only paths or interactive prompt) and keeps the CI command deterministic with `assembleDebug`/`assembleRelease`/`bundleRelease`.

Use:

```bash
cd electron-app
bash scripts/build-android.sh debug
bash scripts/build-android.sh release
bash scripts/build-android.sh bundle
```

The GitHub Actions workflow still invokes the Gradle wrapper directly in `electron-app/android` with `JAVA_HOME` from `actions/setup-java` and the Android SDK from `android-actions/setup-android`.

### `Cannot create symbolic link : A required privilege is not held by the client` (local Windows build)
electron-builder's `winCodeSign` archive contains macOS symlinks that Windows
can't create without Developer Mode or admin rights. Either enable Developer
Mode, or extract it once without the `darwin/` folder:

```bash
C="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
electron-app/node_modules/7zip-bin/win/x64/7za.exe x -bd "$C/<id>.7z" "-o$C/winCodeSign-2.6.0" '-xr!darwin' -y
```

CI runners are unaffected.

### `Unsupported class file major version 69` (Android)
Gradle is running on Java 25 (Android Studio's bundled JBR), which Gradle 8.x
can't read. The project's wrapper is Gradle 9.1 (supports Java 25); CI uses
Temurin 21. If you downgrade the wrapper, also set `JAVA_HOME` to a JDK 21.

### `dial tcp: lookup github.com ... no such host` (Linux build in Docker)
A transient DNS failure inside Docker Desktop while electron-builder downloads
`fpm`. Re-run the build; nothing in the project needs changing.

### electron-builder ignores `electron-builder.yml`
It reads the `build` key from `package.json` first when one exists.
`electron-app/package.json` must not have a `build` field — all config lives in
the yml. The log line `loaded configuration file=...electron-builder.yml`
confirms the right file is used.

### `configuration.mac has an unknown property 'afterSign'`
`afterSign` is a top-level key, not a `mac:` key.

### NSIS: `Usage: StrCpy $(user_var: output) ...` in `customInstallMode`
The installer variable is `$isForceCurrentInstall`. Custom NSIS scripts go in
`nsis.include`, not `customNsisBinary`.

### `ghostforge jobs` / web-ui tests: `ERR_MODULE_NOT_FOUND ... lib/audit`
They load TypeScript directly and need Node **22.15+** (type stripping +
`module.registerHooks`). CI pins Node 22.

### gitleaks reports historic findings
`.gitleaksignore` lists reviewed false positives by exact fingerprint
(commit:file:rule:line). Add a line only after confirming the value is not a
real credential; rotate anything real instead of ignoring it.

### npm `ERESOLVE` peer conflicts
Resolved by the AI SDK v7 upgrade (zod 4 across the tree). If one reappears,
fix the dependency rather than committing a `--legacy-peer-deps` lockfile.
