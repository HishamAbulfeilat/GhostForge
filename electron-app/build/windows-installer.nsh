; GhostForge JARVIS — Custom NSIS Installer Behavior
; Additional installer customizations beyond electron-builder defaults

!macro preInit
  ; Set installer language
  !define MUI_LANGDLL_WINDOWTITLE "GhostForge JARVIS Installer"
!macroend

; Running-app detection is handled by electron-builder's built-in check
; (the old tasklist exit-code test was always true and prompted on every run).

!macro customInstallMode
  ; Default to per-user install
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customHeader
  ; Add version info to installer header
  !define MUI_WELCOMEPAGE_TITLE "Welcome to GhostForge JARVIS"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of GhostForge JARVIS.$\n$\nGhostForge JARVIS is an AI-powered desktop assistant with screen vision, voice control, and more.$\n$\nClick Next to continue."
!macroend
