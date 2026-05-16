@echo off
REM page-save-server-start.bat - server starter used by the PageSaveLocalServer
REM scheduled task.
REM
REM The browser activates page-save://start, the registered VBS launcher asks
REM Task Scheduler to run this script, and the long-lived Node server is then
REM outside the browser/service-worker/protocol-handler process tree.

setlocal

set "PROJECT_DIR=%~dp0.."
set "NODE_EXE=%USERPROFILE%\.local\nodejs\node.exe"
set "OUT_LOG=%PROJECT_DIR%\.page-save-launched-server.out.log"
set "ERR_LOG=%PROJECT_DIR%\.page-save-launched-server.err.log"

if not exist "%NODE_EXE%" (
  for /f "delims=" %%I in ('where node 2^>nul') do (
    echo %%I | findstr /i /c:"WindowsApps" >nul
    if errorlevel 1 (
      set "NODE_EXE=%%I"
      goto :found_node
    )
  )
  echo node.exe not found at %%USERPROFILE%%\.local\nodejs or on PATH>>"%ERR_LOG%"
  exit /b 1
)
:found_node

"%NODE_EXE%" --experimental-strip-types "%PROJECT_DIR%\src\cli.ts" serve >>"%OUT_LOG%" 2>>"%ERR_LOG%"
exit /b %ERRORLEVEL%
