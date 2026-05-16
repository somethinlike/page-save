Set fs = CreateObject("Scripting.FileSystemObject")
Set app = CreateObject("Shell.Application")
scriptDir = fs.GetParentFolderName(WScript.ScriptFullName)
app.ShellExecute scriptDir & "\page-save-server-start.bat", "", scriptDir, "open", 0
