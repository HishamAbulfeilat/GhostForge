; GhostForge JARVIS — Custom NSIS Installer Behavior
; Additional installer customizations beyond electron-builder defaults

!macro preInit
  ; Set installer language
  !define MUI_LANGDLL_WINDOWTITLE "GhostForge JARVIS Installer"
!macroend

!macro customInit
  ; Check for existing installation
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq GhostForge JARVIS.exe" /NH'
  Pop $0
  ${If} $0 == "0"
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "GhostForge JARVIS is currently running.$\n$\nClick OK to close it and continue installation, or Cancel to exit." \
      IDOK killProcess
    Abort
    killProcess:
      nsExec::ExecToStack 'taskkill /F /IM "GhostForge JARVIS.exe"'
      Sleep 1000
  ${EndIf}
!macroend

!macro customInstallMode
  ; Default to per-user install
  StrCpy $isForceCurrentInstallMode "1"
!macroend

!macro customHeader
  ; Add version info to installer header
  !define MUI_WELCOMEPAGE_TITLE "Welcome to GhostForge JARVIS"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of GhostForge JARVIS.$\n$\nGhostForge JARVIS is an AI-powered desktop assistant with screen vision, voice control, and more.$\n$\nClick Next to continue."
!macroend

!macro customUnInit
  ; Ensure app is closed before uninstall
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq GhostForge JARVIS.exe" /NH'
  Pop $0
  ${If} $0 == "0"
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "GhostForge JARVIS is running.$\n$\nClick OK to close it and uninstall, or Cancel to abort." \
      IDOK killUninstall
    Abort
    killUninstall:
      nsExec::ExecToStack 'taskkill /F /IM "GhostForge JARVIS.exe"'
      Sleep 1000
  ${EndIf}
!macroend
