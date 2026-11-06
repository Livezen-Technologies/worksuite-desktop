; WorkSuite Desktop's NSIS additions (electron-builder includes build/installer.nsh by default).
;
; The installer is branded "WorkSuite Desktop" while the product name stays "WorkSuite": the product name decides the
; install folder (%LOCALAPPDATA%\Programs\WorkSuite), the app data folder (%APPDATA%\WorkSuite), the exe name and the
; registry keys, and existing installs must keep updating in place. So only what the person reads changes here.

!macro customHeader
  !ifdef BUILD_UNINSTALLER
    Caption "WorkSuite Desktop Uninstall"
  !else
    Caption "WorkSuite Desktop Setup"
  !endif
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to WorkSuite Desktop Setup"
  !define MUI_WELCOMEPAGE_TEXT "Setup will guide you through the installation of WorkSuite Desktop: mail, chat, tasks, files and every WorkSuite app on your desktop.$\r$\n$\r$\nClick Next to continue."
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_WELCOME
!macroend

; The finish page as electron-builder's own (run the app after finishing), with WorkSuite Desktop's title and text.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  !define MUI_FINISHPAGE_TITLE "WorkSuite Desktop is installed"
  !define MUI_FINISHPAGE_TEXT "WorkSuite Desktop has been installed on your computer.$\r$\n$\r$\nClick Finish to close Setup."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Open WorkSuite Desktop"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

; Shortcuts were called "WorkSuite" before 0.2.291 and are "WorkSuite Desktop" now. electron-builder renames them on an
; in-app update (it reads the old name from the registry and re-applies the AppUserModelId, lk.worksuite.desktop). A
; setup run by hand over an existing install creates the new ones instead, so the old ones are removed here, and only
; once the new one exists, so a person is never left without a shortcut.
!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
  ${andIf} ${FileExists} "$SMPROGRAMS\WorkSuite.lnk"
    WinShell::UninstShortcut "$SMPROGRAMS\WorkSuite.lnk"
    Delete "$SMPROGRAMS\WorkSuite.lnk"
  ${endIf}
  ${if} ${FileExists} "$newDesktopLink"
  ${andIf} ${FileExists} "$DESKTOP\WorkSuite.lnk"
    WinShell::UninstShortcut "$DESKTOP\WorkSuite.lnk"
    Delete "$DESKTOP\WorkSuite.lnk"
  ${endIf}
!macroend
