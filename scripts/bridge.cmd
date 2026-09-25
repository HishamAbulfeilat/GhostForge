@echo off
setlocal EnableDelayedExpansion

REM ====================================================================
REM  GhostForge Bridge - Windows launcher
REM  Mirrors scripts/bridge.sh: start | stop | status | token | help
REM  The bridge server is scripts/bridge-server.js (shared with
REM  macOS/Linux), so behavior and token files stay identical.
REM ====================================================================

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT=%%~fI"
set "BRIDGE_DIR=%USERPROFILE%\.ghostforge\bridge"
set "PID_FILE=%BRIDGE_DIR%\bridge.pid"
set "TOKEN_FILE=%BRIDGE_DIR%\token"
set "LOG_FILE=%BRIDGE_DIR%\bridge.log"
set "READY_FILE=%BRIDGE_DIR%\server.ready"
set "PORT=4747"
set "SERVER_JS=%BRIDGE_DIR%\bridge-server.js"

if not exist "%BRIDGE_DIR%" mkdir "%BRIDGE_DIR%"

set "ACTION=help"
if not "%~1"=="" set "ACTION=%~1"

if /i "%ACTION%"=="start" goto :start
if /i "%ACTION%"=="stop" goto :stop
if /i "%ACTION%"=="status" goto :status
if /i "%ACTION%"=="token" goto :token
goto :help

:generate_token
powershell -NoProfile -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')" > "%TOKEN_FILE%"
goto :eof

:is_running
set "RV=0"
if exist "%PID_FILE%" (
  for /f "usebackq delims=" %%P in ("%PID_FILE%") do (
    tasklist /FI "PID eq %%P" 2>NUL | findstr /i "node.exe" >NUL && set "RV=1"
  )
)
goto :eof

:start
call :is_running
if "!RV!"=="1" (
  echo Bridge already running.
  goto :eof
)

del /q "%PID_FILE%" 2>NUL
del /q "%READY_FILE%" 2>NUL
type NUL > "%LOG_FILE%"

if not exist "%TOKEN_FILE%" call :generate_token

REM Keep a copy of the server script next to the logs
copy /y "%SCRIPT_DIR%bridge-server.js" "%SERVER_JS%" >NUL

set "BRIDGE_TOKEN_FILE=%TOKEN_FILE%"
set "BRIDGE_ROOT=%ROOT%"
set "BRIDGE_READY_FILE=%READY_FILE%"
set "BRIDGE_PORT=%PORT%"

powershell -NoProfile -Command "$p = Start-Process -FilePath 'node.exe' -ArgumentList '\"%SERVER_JS%\"' -WorkingDirectory '%ROOT%' -WindowStyle Hidden -PassThru; Write-Output ([int]$p.Id)" > "%PID_FILE%"

echo Bridge starting on port %PORT%...
echo Token: stored in %TOKEN_FILE%
echo Logs:  %LOG_FILE%
goto :eof

:stop
call :is_running
if "!RV!"=="1" (
  for /f "usebackq delims=" %%P in ("%PID_FILE%") do taskkill /PID %%P /F >NUL 2>&1
  del /q "%PID_FILE%" 2>NUL
  del /q "%READY_FILE%" 2>NUL
  echo Bridge stopped.
) else (
  echo Bridge not running.
)
goto :eof

:status
call :is_running
if "!RV!"=="1" (
  echo Bridge is RUNNING
  for /f "usebackq delims=" %%P in ("%PID_FILE%") do echo   PID: %%P
) else (
  echo Bridge is NOT running
  echo   Start: scripts\bridge.cmd start
)
goto :eof

:token
if exist "%TOKEN_FILE%" (
  type "%TOKEN_FILE%"
) else (
  echo No token found - run: scripts\bridge.cmd start
)
goto :eof

:help
echo Usage: scripts\bridge.cmd ^<start^|stop^|status^|token^|help^>
goto :eof
