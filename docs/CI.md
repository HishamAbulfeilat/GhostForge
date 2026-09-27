# CI workflows and known failure modes

| Workflow | Runs on | What it checks |
|---|---|---|
| **PR Quality Check** (`pr-check.yml`) | pull requests | ESLint (web-ui), tests, env-check, unused code, RTL classes, React Doctor, npm audit — posts one summary comment |
| **Security** (`security.yml`) | PRs, pushes to `main`, weekly | CodeQL → code scanning (SARIF), dependency review, npm audit gate (high/critical), gitleaks secret scan, security regression tests, CycloneDX SBOMs |
| **Build Apps** (`build-apps.yml`) | pushes to `main`, `v*` tags | Windows, Linux, macOS, Android, iOS builds; tags publish a Release (signing: [SIGNING.md](SIGNING.md)) |

## Troubleshooting

Every entry below was hit for real while setting these builds up.

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
