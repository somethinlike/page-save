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
set "SERVER_PORT=7224"

title Page Save Local Server - ws://localhost:%SERVER_PORT%

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

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$client = New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', %SERVER_PORT%); if ($client.Connected) { $client.Close(); exit 0 } } catch {} exit 1" >nul 2>nul
if "%ERRORLEVEL%"=="0" (
  echo Page Save already appears to be running on ws://localhost:%SERVER_PORT%.
  echo No second local server was started.
  timeout /t 3 >nul
  exit /b 0
)

cls
echo ============================================================
echo Page Save Local Server
echo ============================================================
echo.
echo This window is running the local Page Save bridge that your browser
echo extension talks to when you click "Save Selected" or use Page Save's
echo structured extraction features.
echo.
echo The browser extension itself cannot save arbitrary files directly to your
echo Documents folder. Instead, the extension connects to this local Node.js
echo process over a WebSocket connection, then this server writes the captured
echo pages, reduced markdown, manifests, and logs to disk.
echo.
echo Keep this window open while you are using the Page Save extension. If you
echo close this window, the local server stops and the extension will return to
echo its offline state until you launch the server again.
echo.
echo Connection:
echo   WebSocket URL : ws://localhost:%SERVER_PORT%
echo   Port          : %SERVER_PORT%
echo.
echo Runtime:
echo   Project       : %PROJECT_DIR%
echo   Node.js       : %NODE_EXE%
echo.
echo Logs:
echo   Server output : %OUT_LOG%
echo   Server errors : %ERR_LOG%
echo.
echo The server is starting now. This window may stay mostly quiet during
echo normal use because detailed server output is written to the log files
echo above. Browser saves and extraction jobs should work as long as this
echo window remains open.
echo.
echo To stop Page Save, close this window.
echo ============================================================
echo.

"%NODE_EXE%" "%PROJECT_DIR%\dist\cli.js" serve >>"%OUT_LOG%" 2>>"%ERR_LOG%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ============================================================
echo Page Save server stopped with exit code %EXIT_CODE%.
echo If this was unexpected, check the log files listed above.
echo ============================================================
echo.
pause
exit /b %EXIT_CODE%
