<#
    Pickora - start the draw board.

    Runs the server in this window and opens the board in the default browser.
    Closing the window stops Pickora.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib.ps1')

Write-Banner 'Draw board'

$appRoot = Get-AppRoot
$nodeExe = Find-NodeExe

if (-not $nodeExe) {
    Write-Fail 'Node.js was not found. Run Install-Pickora.bat first.'
    exit 1
}

$port = Get-InstalledPort

# The saved port may have been taken by something else since setup.
$free = Get-AvailablePort -Preferred $port
if ($free -ne $port) {
    Write-Warn "Port $port is busy; using $free instead."
    $port = $free
    Set-Content -Path (Join-Path $PSScriptRoot 'port.txt') -Value $port
}

$env:PORT = $port
$url = "http://localhost:$port/"

Write-Host "  Draw board   $url" -ForegroundColor White
Write-Host "  Organiser    ${url}admin" -ForegroundColor White
Write-Host ''
Write-Host '  Close this window to stop Pickora.' -ForegroundColor DarkGray
Write-Host ''

# Give the server a moment to bind before the browser asks for the page.
Start-Job -ScriptBlock {
    param($target)
    Start-Sleep -Seconds 2
    Start-Process $target
} -ArgumentList $url | Out-Null

Push-Location $appRoot
try {
    & $nodeExe 'server.js'
} finally {
    Pop-Location
}
