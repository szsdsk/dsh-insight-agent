[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [string]$DshHome = $(
        if ($env:DSH_HOME) { $env:DSH_HOME }
        else { Join-Path $env:USERPROFILE '.dsh' }
    )
)

$ErrorActionPreference = 'Stop'
$presetRoot = Join-Path $DshHome '.agent-presets\insight-agent'
$resolvedDshHome = [System.IO.Path]::GetFullPath($DshHome)
$resolvedPreset = [System.IO.Path]::GetFullPath($presetRoot)

if (-not $resolvedPreset.StartsWith($resolvedDshHome, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a path outside DSH_HOME: $resolvedPreset"
}
if (-not (Test-Path -LiteralPath $resolvedPreset)) {
    Write-Host "InsightAgent is not installed at $resolvedPreset"
    return
}
if ($PSCmdlet.ShouldProcess($resolvedPreset, 'Remove the installed InsightAgent preset')) {
    Remove-Item -LiteralPath $resolvedPreset -Recurse -Force
    Write-Host "Removed $resolvedPreset. The source repository and Conda environment were not changed."
}
