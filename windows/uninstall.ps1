<#
    Removes the Pickora shortcuts.

    Event data (tickets.json, appsettings.json, winners.json, assets) is left
    untouched — delete the Pickora folder yourself if you want it gone.
#>

Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'lib.ps1')

Write-Banner 'Uninstall'

$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pickora.lnk'),
    (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\Windows\Start Menu\Programs\Pickora.lnk')
)

foreach ($target in $targets) {
    if (Test-Path $target) {
        Remove-Item $target -Force
        Write-Ok "Removed $target"
    }
}

Write-Host ''
Write-Host '  Shortcuts removed. Your event data is still in:' -ForegroundColor White
Write-Host "    $(Get-AppRoot)" -ForegroundColor Gray
Write-Host '  Delete that folder to remove Pickora completely.' -ForegroundColor Gray
Write-Host ''
