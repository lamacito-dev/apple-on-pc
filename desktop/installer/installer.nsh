; OpenFS installer customisation (electron-builder « nsis.include »).
; Finish page: keeps the default « Lancer OpenFS » checkbox and adds « Installer aussi Appareils
; Apple », which opens Apple's free app in the Microsoft Store. Appareils Apple provides the iPhone
; USB service (usbmuxd) OpenFS uses for full access and instant previews; it is Store-only and cannot
; be bundled. The checkbox is hidden when Appareils Apple is already installed. Silent installs
; (/S) skip the finish page entirely.

!ifndef BUILD_UNINSTALLER
  !macro customFinishPage
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    Function openfsOpenAppleDevicesStore
      ExecShell "open" "ms-windows-store://pdp/?ProductId=9NP83LWLPZ9K"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !define MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "Installer aussi Appareils Apple (gratuit, recommandé)"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION openfsOpenAppleDevicesStore
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW openfsFinishPageShow
    !insertmacro MUI_PAGE_FINISH

    ; Defined after MUI_PAGE_FINISH, which declares $mui.FinishPage.ShowReadme
    Function openfsFinishPageShow
      nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if (Get-AppxPackage -Name AppleInc.AppleDevices) { exit 0 } else { exit 1 }"'
      Pop $0
      Pop $1
      ${if} $0 == 0
        ; Already installed: untick (BM_SETCHECK = 0x00F1) and hide the checkbox
        SendMessage $mui.FinishPage.ShowReadme 0x00F1 0 0
        ShowWindow $mui.FinishPage.ShowReadme 0
      ${endif}
    FunctionEnd
  !macroend
!endif
