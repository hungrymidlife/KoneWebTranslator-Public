Option Explicit
Dim sh, fs, home, bat, exitCode
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
home = fs.GetParentFolderName(WScript.ScriptFullName)
bat = fs.BuildPath(home, "RUN_STUDIO.bat")
If Not fs.FileExists(bat) Then
  MsgBox "RUN_STUDIO.bat not found: " & bat, vbCritical, "KoneWebTranslator Studio"
  WScript.Quit 1
End If
exitCode = sh.Run("cmd.exe /d /s /c """ & Chr(34) & bat & Chr(34) & """", 0, True)
If exitCode <> 0 Then
  MsgBox "Studio exited with code " & CStr(exitCode) & "." & vbCrLf & "Run RUN_STUDIO.bat once for detailed errors.", vbExclamation, "KoneWebTranslator Studio"
End If
