# PowerShell Launcher for Bluff Multiplayer Game Server
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "🃏 Starting Bluff Multiplayer Game Server..." -ForegroundColor Yellow
Write-Host "===================================================" -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    node server.js
    exit
}

$vscodePath = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe"
if (Test-Path $vscodePath) {
    $env:ELECTRON_RUN_AS_NODE = "1"
    & $vscodePath server.js
    exit
}

$vscodeProgFiles = "C:\Program Files\Microsoft VS Code\Code.exe"
if (Test-Path $vscodeProgFiles) {
    $env:ELECTRON_RUN_AS_NODE = "1"
    & $vscodeProgFiles server.js
    exit
}

Write-Error "Neither Node.js nor VS Code was found to run the server."
