@echo off
REM page-save-server-start.bat - detached server starter used by the
REM native-messaging launcher.
REM
REM The native host itself must exit after writing its native-message response.
REM This helper uses Windows START to create the actual long-lived server
REM process outside the native host wrapper.

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

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%NODE_EXE%' -ArgumentList '--experimental-strip-types','%PROJECT_DIR%\src\cli.ts','serve' -WorkingDirectory '%PROJECT_DIR%' -WindowStyle Hidden"
