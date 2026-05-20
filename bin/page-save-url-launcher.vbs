Option Explicit

Const TASK_NAME = "PageSaveLocalServer"
Const SERVER_HOST = "127.0.0.1"
Const SERVER_PORT = 7224
Const LAUNCH_COOLDOWN_SECONDS = 15

Dim shell
Dim fs
Dim scriptDir
Dim projectDir
Dim logPath
Dim markerPath
Dim command
Dim exitCode

Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")

scriptDir = fs.GetParentFolderName(WScript.ScriptFullName)
projectDir = fs.GetParentFolderName(scriptDir)
logPath = fs.BuildPath(projectDir, ".page-save-url-handler.log")
markerPath = fs.BuildPath(projectDir, ".page-save-url-launch.inflight")
command = "schtasks /Run /TN " & Chr(34) & TASK_NAME & Chr(34)

AppendLog "INFO: invoked with " & WScript.Arguments.Count & " arg(s)"

If IsPortOpen(SERVER_HOST, SERVER_PORT) Then
  AppendLog "INFO: port " & SERVER_PORT & " is already listening; skipped scheduled task"
  WScript.Quit 0
End If

If LaunchRecentlyRequested(markerPath) Then
  AppendLog "INFO: launch request is already in flight; skipped duplicate scheduled task"
  WScript.Quit 0
End If

MarkLaunchRequested markerPath
exitCode = shell.Run(command, 0, True)

If exitCode = 0 Then
  AppendLog "INFO: scheduled task run requested"
Else
  AppendLog "ERROR: schtasks returned exit code " & exitCode
End If

WScript.Quit exitCode

Sub AppendLog(message)
  On Error Resume Next
  Dim stream
  Set stream = fs.OpenTextFile(logPath, 8, True)
  stream.WriteLine Timestamp() & " " & message
  stream.Close
End Sub

Function Timestamp()
  Timestamp = Year(Now) & "-" & Pad2(Month(Now)) & "-" & Pad2(Day(Now)) & _
    "T" & Pad2(Hour(Now)) & ":" & Pad2(Minute(Now)) & ":" & Pad2(Second(Now))
End Function

Function Pad2(value)
  Pad2 = Right("0" & value, 2)
End Function

Function IsPortOpen(host, port)
  On Error Resume Next
  Dim psCommand
  Dim exitCode

  psCommand = "$client = New-Object Net.Sockets.TcpClient; " & _
    "try { $client.Connect('" & host & "', " & port & "); " & _
    "if ($client.Connected) { $client.Close(); exit 0 } } catch {} exit 1"

  exitCode = shell.Run("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command " & Chr(34) & psCommand & Chr(34), 0, True)
  If Err.Number <> 0 Then
    Err.Clear
    IsPortOpen = False
  Else
    IsPortOpen = (exitCode = 0)
  End If
End Function

Function LaunchRecentlyRequested(path)
  On Error Resume Next
  LaunchRecentlyRequested = False

  If Not fs.FileExists(path) Then Exit Function

  Dim ageSeconds
  ageSeconds = DateDiff("s", fs.GetFile(path).DateLastModified, Now)
  If Err.Number <> 0 Then
    Err.Clear
    Exit Function
  End If

  LaunchRecentlyRequested = (ageSeconds >= 0 And ageSeconds < LAUNCH_COOLDOWN_SECONDS)
End Function

Sub MarkLaunchRequested(path)
  On Error Resume Next
  Dim stream
  Set stream = fs.CreateTextFile(path, True)
  stream.WriteLine Timestamp()
  stream.Close
End Sub
