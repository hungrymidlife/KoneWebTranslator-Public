Option Explicit
' KoneWebTranslator Studio: hidden console + animated startup splash.
Dim sh, fs, home, bat, splash, marker, markerFile, splashCmd, exitCode
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
home = fs.GetParentFolderName(WScript.ScriptFullName)
bat = fs.BuildPath(home, "RUN_STUDIO.bat")
splash = fs.BuildPath(fs.BuildPath(fs.BuildPath(home, "studio"), "splash"), "StudioLoading.ps1")

If Not fs.FileExists(bat) Then
  MsgBox "RUN_STUDIO.bat not found: " & bat, vbCritical, "KoneWebTranslator Studio"
  WScript.Quit 1
End If

' Unique marker: the splash closes when the Studio window appears or the launcher exits.
marker = fs.BuildPath(sh.ExpandEnvironmentStrings("%TEMP%"), "KWT_Studio_" & fs.GetTempName() & ".flag")
If fs.FileExists(splash) Then
  On Error Resume Next
  Set markerFile = fs.CreateTextFile(marker, True, False)
  If Err.Number = 0 Then
    markerFile.WriteLine "RUNNING"
    markerFile.Close
    splashCmd = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & splash & Chr(34) & " -Marker " & Chr(34) & marker & Chr(34)
    sh.Run splashCmd, 0, False
  End If
  Err.Clear
  On Error GoTo 0
End If

' Keep the original hidden RUN_STUDIO.bat launch behavior unchanged.
exitCode = sh.Run("cmd.exe /d /s /c """ & Chr(34) & bat & Chr(34) & """", 0, True)

On Error Resume Next
If fs.FileExists(marker) Then fs.DeleteFile marker, True
On Error GoTo 0

If exitCode <> 0 Then
  MsgBox "Studio exited with code " & CStr(exitCode) & "." & vbCrLf & "Run RUN_STUDIO.bat once for detailed errors.", vbExclamation, "KoneWebTranslator Studio"
End If
