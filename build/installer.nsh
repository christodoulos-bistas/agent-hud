; Agent HUD: NSIS customisations (wired through build.nsis.include in package.json).

; Uninstall takes the HUD's hooks out of ~/.claude/settings.json before the files are removed, so
; Claude Code isn't left posting to a port nothing listens on. Skipped when the uninstaller runs as
; part of an update: the new version keeps using the same hooks.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DetailPrint "Removing the Agent HUD hooks from the Claude Code settings"
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --remove-hooks'
  ${endIf}
!macroend
