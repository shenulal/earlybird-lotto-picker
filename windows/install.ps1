<#
    Pickora - Windows installer.

    Verifies a runtime, checks the application files, writes shortcuts and
    starts the board. Designed to succeed with no internet connection.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib.ps1')

Write-Banner 'Setup'

$appRoot = Get-AppRoot
Write-Step "Installing from: $appRoot"

# ---------------------------------------------------------------- runtime --

Write-Host ''
Write-Host '  1. Runtime' -ForegroundColor White

$nodeExe = Find-NodeExe

if (-not $nodeExe) {
    Write-Warn 'Node.js was not found on this PC.'

    if (Install-NodeFromVendor) {
        $nodeExe = Find-NodeExe
        Write-Ok 'Node.js installed from the bundled copy.'
    }
    elseif (Test-Internet) {
        Write-Step 'No bundled copy found; this PC is online, so fetching it.'
        if (Install-NodeFromInternet) {
            $nodeExe = Find-NodeExe
            Write-Ok 'Node.js installed.'
        }
    }
}

if (-not $nodeExe) {
    Write-Host ''
    Write-Fail 'Pickora needs Node.js and it could not be installed automatically.'
    Write-Host ''
    Write-Host '  To install with no internet on this PC:' -ForegroundColor White
    Write-Host '    1. On any PC with internet, download the Windows .msi from' -ForegroundColor Gray
    Write-Host '       https://nodejs.org/en/download  (LTS, 64-bit)' -ForegroundColor Gray
    Write-Host "    2. Copy it into:  $(Join-Path $PSScriptRoot 'vendor')" -ForegroundColor Gray
    Write-Host '    3. Run this installer again.' -ForegroundColor Gray
    Write-Host ''
    exit 1
}

$major = Get-NodeVersion -NodeExe $nodeExe
if ($major -lt 14) {
    Write-Fail "Node.js 14 or newer is required; this PC has major version $major."
    exit 1
}
Write-Ok "Node.js found: $nodeExe (v$major)"

# ------------------------------------------------------- application files --

Write-Host ''
Write-Host '  2. Application files' -ForegroundColor White

$required = @('server.js', 'index.html', 'admin.html', 'appsettings.json', 'server\micro.js')
$missing = @($required | Where-Object { -not (Test-Path (Join-Path $appRoot $_)) })

if ($missing.Count -gt 0) {
    Write-Fail "These files are missing: $($missing -join ', ')"
    Write-Host '  Copy the whole Pickora folder, not just the windows folder.' -ForegroundColor Gray
    exit 1
}
Write-Ok 'All application files present.'

# Pickora ships with no npm dependencies, so there is nothing to download.
if (Test-Path (Join-Path $appRoot 'package.json')) {
    $package = Get-Content (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json
    $dependencyCount = 0
    if ($package.PSObject.Properties.Name -contains 'dependencies' -and $package.dependencies) {
        $dependencyCount = @($package.dependencies.PSObject.Properties).Count
    }
    if ($dependencyCount -eq 0) {
        Write-Ok 'No packages to install - Pickora runs on Node.js alone.'
    } else {
        Write-Step "Installing $dependencyCount package(s)..."
        Push-Location $appRoot
        try { & npm install --omit=dev --no-audit --no-fund } finally { Pop-Location }
    }
}

# Data files must be writable; the draw state is saved as winners are picked.
try {
    $probe = Join-Path $appRoot '.write-test'
    Set-Content -Path $probe -Value 'x' -ErrorAction Stop
    Remove-Item $probe -ErrorAction SilentlyContinue
    Write-Ok 'The folder is writable.'
} catch {
    Write-Fail 'This folder is read-only. Move Pickora somewhere like C:\Pickora and run setup again.'
    exit 1
}

# ------------------------------------------------------------------- port --

Write-Host ''
Write-Host '  3. Network port' -ForegroundColor White

$port = Get-AvailablePort -Preferred 3000
Set-Content -Path (Join-Path $PSScriptRoot 'port.txt') -Value $port
Write-Ok "Pickora will use port $port."

# -------------------------------------------------------------- shortcuts --

Write-Host ''
Write-Host '  4. Shortcuts' -ForegroundColor White

$startScript = Join-Path $PSScriptRoot 'Start-Pickora.bat'

function New-Shortcut {
    param([string]$Path, [string]$Target, [string]$WorkDir, [string]$Description)
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $Target
    $link.WorkingDirectory = $WorkDir
    $link.Description = $Description
    $link.Save()
}

try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    New-Shortcut -Path (Join-Path $desktop 'Pickora.lnk') -Target $startScript `
                 -WorkDir $PSScriptRoot -Description 'Pickora prize draw board'
    Write-Ok 'Desktop shortcut created.'

    $startMenu = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs'
    New-Shortcut -Path (Join-Path $startMenu 'Pickora.lnk') -Target $startScript `
                 -WorkDir $PSScriptRoot -Description 'Pickora prize draw board'
    Write-Ok 'Start Menu shortcut created.'
} catch {
    Write-Warn "Shortcuts could not be created: $($_.Exception.Message)"
    Write-Warn "You can still start Pickora from $startScript"
}

# ------------------------------------------------------------------- done --

Write-Host ''
Write-Host '  Setup complete.' -ForegroundColor Green
Write-Host ''
Write-Host "    Draw board       http://localhost:$port/" -ForegroundColor White
Write-Host "    Organiser        http://localhost:$port/admin" -ForegroundColor White
Write-Host '    Sign in          admin / pickora   (change this in the console)' -ForegroundColor White
Write-Host ''
Write-Host '  Starting Pickora now. Close its window to stop it.' -ForegroundColor Gray
Write-Host ''

Start-Sleep -Seconds 2
Start-Process -FilePath $startScript -WorkingDirectory $PSScriptRoot
exit 0
