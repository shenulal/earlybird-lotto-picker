# Shared helpers for the Pickora Windows scripts.
# Kept in one place so install and start agree on how the runtime is found.

Set-StrictMode -Version Latest

$script:AppRoot = Split-Path -Parent $PSScriptRoot
$script:VendorDir = Join-Path $PSScriptRoot 'vendor'

function Write-Step   { param([string]$Message) Write-Host "  $Message" -ForegroundColor Gray }
function Write-Ok     { param([string]$Message) Write-Host "  [ok] $Message" -ForegroundColor Green }
function Write-Warn   { param([string]$Message) Write-Host "  [!]  $Message" -ForegroundColor Yellow }
function Write-Fail   { param([string]$Message) Write-Host "  [x]  $Message" -ForegroundColor Red }

function Write-Banner {
    param([string]$Subtitle)
    Write-Host ''
    Write-Host '  PICKORA' -ForegroundColor Yellow -NoNewline
    Write-Host "  $Subtitle" -ForegroundColor DarkGray
    Write-Host '  by Shenu' -ForegroundColor DarkGray
    Write-Host ''
}

function Get-AppRoot { return $script:AppRoot }

<#
Finds a usable Node.js, in order of preference:
  1. a portable build bundled under windows\vendor\node\  (works offline)
  2. node.exe already on PATH
  3. the standard Program Files install location
Returns the full path to node.exe, or $null.
#>
function Find-NodeExe {
    $portable = Join-Path $script:VendorDir 'node\node.exe'
    if (Test-Path $portable) { return (Resolve-Path $portable).Path }

    $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    foreach ($candidate in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }

    return $null
}

function Get-NodeVersion {
    param([Parameter(Mandatory)][string]$NodeExe)
    try {
        $raw = (& $NodeExe --version 2>$null)
        if ($raw -match 'v(\d+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
}

<#
Installs Node.js from an .msi bundled in windows\vendor\ — the offline path.
Returns $true when Node is available afterwards.
#>
function Install-NodeFromVendor {
    if (-not (Test-Path $script:VendorDir)) { return $false }

    $msi = Get-ChildItem -Path $script:VendorDir -Filter 'node-*.msi' -ErrorAction SilentlyContinue |
           Sort-Object Name -Descending | Select-Object -First 1
    if (-not $msi) { return $false }

    Write-Step "Installing Node.js from $($msi.Name) (no internet needed)..."
    $process = Start-Process msiexec.exe -ArgumentList @('/i', "`"$($msi.FullName)`"", '/qn', '/norestart') -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        Write-Fail "The Node.js installer exited with code $($process.ExitCode)."
        return $false
    }

    # A fresh install is not on this session's PATH yet.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
    return $null -ne (Find-NodeExe)
}

function Test-Internet {
    try {
        return (Test-NetConnection -ComputerName 'nodejs.org' -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)
    } catch {
        return $false
    }
}

function Install-NodeFromInternet {
    $url = 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi'
    $target = Join-Path $env:TEMP 'node-lts-x64.msi'

    Write-Step 'Downloading Node.js (about 30 MB)...'
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing -TimeoutSec 300
    } catch {
        Write-Fail "The download failed: $($_.Exception.Message)"
        return $false
    }

    Write-Step 'Installing Node.js...'
    $process = Start-Process msiexec.exe -ArgumentList @('/i', "`"$target`"", '/qn', '/norestart') -Wait -PassThru
    Remove-Item $target -ErrorAction SilentlyContinue

    if ($process.ExitCode -ne 0) {
        Write-Fail "The Node.js installer exited with code $($process.ExitCode)."
        return $false
    }

    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
    return $null -ne (Find-NodeExe)
}

<# Picks a free TCP port, preferring the one Pickora normally uses. #>
function Get-AvailablePort {
    param([int]$Preferred = 3000)

    foreach ($port in @($Preferred) + (3001..3020)) {
        $listener = $null
        try {
            $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
            $listener.Start()
            return $port
        } catch {
            continue
        } finally {
            if ($listener) { $listener.Stop() }
        }
    }

    return $Preferred
}

function Get-InstalledPort {
    $file = Join-Path (Get-AppRoot) 'windows\port.txt'
    if (Test-Path $file) {
        $value = (Get-Content $file -First 1).Trim()
        if ($value -match '^\d+$') { return [int]$value }
    }
    return 3000
}
