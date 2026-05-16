Option Explicit

Const TASK_NAME = "PageSaveLocalServer"

Dim shell
Dim fs
Dim scriptDir
Dim projectDir
Dim logPath
Dim command
Dim exitCode

Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")

scriptDir = fs.GetParentFolderName(WScript.ScriptFullName)
projectDir = fs.GetParentFolderName(scriptDir)
logPath = fs.BuildPath(projectDir, ".page-save-url-handler.log")
command = "schtasks /Run /TN " & Chr(34) & TASK_NAME & Chr(34)

AppendLog "INFO: invoked with " & WScript.Arguments.Count & " arg(s)"
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
