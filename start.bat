@echo off
title Bluff Game Server
setlocal

echo ===================================================
echo 🃏 Starting Bluff Multiplayer Game Server...
echo ===================================================

:: Check for node in PATH first
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node server.js
    goto :eof
)

:: If not in PATH, use VS Code embedded Node runtime
if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" (
    set ELECTRON_RUN_AS_NODE=1
    "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" server.js
    goto :eof
)

if exist "C:\Program Files\Microsoft VS Code\Code.exe" (
    set ELECTRON_RUN_AS_NODE=1
    "C:\Program Files\Microsoft VS Code\Code.exe" server.js
    goto :eof
)

echo [ERROR] Neither Node.js nor VS Code runtime was found on this system.
pause
