@echo off
REM page-save-launcher.bat — Chrome native messaging host wrapper.
REM
REM Chrome invokes this script with no arguments and communicates with it over
REM stdin/stdout using the 4-byte length-prefix framing protocol. The actual
REM launcher logic lives in src/native-launcher.ts; this wrapper just locates
REM Node.js and forwards stdio.
REM
REM Self-locating: %~dp0 is this script's directory, so the project paths are
REM derived without any install-time substitution. Node is preferred from
REM %LOCALAPPDATA%\..\..\.local\nodejs (Ryan's portable install — see MEMORY
REM `feedback_ps7_msix.md` for why fnm is unreliable from non-shell contexts).

setlocal

set "PROJECT_DIR=%~dp0.."
set "NODE_EXE=%USERPROFILE%\.local\nodejs\node.exe"

if not exist "%NODE_EXE%" (
  REM Fallback: try PATH. Avoid fnm shims by skipping any node in WindowsApps.
  for /f "delims=" %%I in ('where node 2^>nul') do (
    echo %%I | findstr /i /c:"WindowsApps" >nul
    if errorlevel 1 (
      set "NODE_EXE=%%I"
      goto :found_node
    )
  )
  echo {"error":"node.exe not found at %%USERPROFILE%%\.local\nodejs or on PATH"} >&2
  exit /b 1
)
:found_node

"%NODE_EXE%" --experimental-strip-types "%PROJECT_DIR%\src\native-launcher.ts"
exit /b %ERRORLEVEL%
