[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PythonPath,

    [string]$Workspace = (Get-Location).Path,

    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedPython = (Resolve-Path -LiteralPath $PythonPath).Path
$resolvedWorkspace = (Resolve-Path -LiteralPath $Workspace).Path
if (-not $OutputPath) {
    $OutputPath = Join-Path $repoRoot '.generated\headless.cordis.patch.yml'
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

& pnpm --dir $repoRoot run build
if ($LASTEXITCODE -ne 0) { throw 'pnpm run build failed' }

function ConvertTo-YamlLiteral([string]$Value) {
    return $Value.Replace("'", "''")
}

$template = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot 'evals\headless\cordis.patch.template.yml')
$template = $template.Replace('__INSIGHT_PYTHON__', (ConvertTo-YamlLiteral $resolvedPython))
$template = $template.Replace('__INSIGHT_WORKSPACE__', (ConvertTo-YamlLiteral $resolvedWorkspace))
$template = $template.Replace('__INSIGHT_SKILLS_DIR__', (ConvertTo-YamlLiteral (Join-Path $repoRoot 'skills')))
$template = $template.Replace('__INSIGHT_PLUGIN_PATH__', (ConvertTo-YamlLiteral (Join-Path $repoRoot 'dist\host.js')))
Set-Content -LiteralPath $resolvedOutput -Value $template -Encoding UTF8
Write-Output $resolvedOutput
