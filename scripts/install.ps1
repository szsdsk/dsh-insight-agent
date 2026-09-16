[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PythonPath,

    [string]$DshHome = $(
        if ($env:DSH_HOME) { $env:DSH_HOME }
        else { Join-Path $env:USERPROFILE '.dsh' }
    )
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedPython = (Resolve-Path -LiteralPath $PythonPath).Path
$presetRoot = Join-Path $DshHome '.agent-presets\insight-agent'

if (-not (Test-Path -LiteralPath $resolvedPython -PathType Leaf)) {
    throw "Python interpreter does not exist: $resolvedPython"
}
if (Test-Path -LiteralPath $presetRoot) {
    throw "Preset already exists at $presetRoot. Run scripts\uninstall.ps1 first."
}

$nodeVersion = (& node --version).Trim()
$pnpmVersion = (& pnpm --version).Trim()
if ($nodeVersion -ne 'v22.20.0') {
    throw "Node.js v22.20.0 is required; detected $nodeVersion"
}
if ($pnpmVersion -ne '10.14.0') {
    throw "pnpm 10.14.0 is required; detected $pnpmVersion"
}

& $resolvedPython -c "import insight_mcp; print(insight_mcp.__version__)" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "insight_mcp is not installed for $resolvedPython"
}

Push-Location $repoRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\.bin\tsc.cmd'))) {
        throw 'Node dependencies are missing. Run pnpm install --frozen-lockfile first.'
    }
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { throw 'pnpm run build failed' }
}
finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $presetRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot 'preset.yml') -Destination $presetRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination $presetRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'THIRD_PARTY_NOTICES.md') -Destination $presetRoot
Copy-Item -LiteralPath (Join-Path $repoRoot 'dist') -Destination $presetRoot -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot 'skills') -Destination $presetRoot -Recurse

$yaml = Get-Content -Raw -Encoding UTF8 (Join-Path $repoRoot 'agent.cordis.yml')
$yamlPython = $resolvedPython.Replace("'", "''")
$yamlSkills = (Join-Path $presetRoot 'skills').Replace("'", "''")
$yamlPlugin = (Join-Path $presetRoot 'dist\host.js').Replace("'", "''")
$yaml = $yaml -replace "command: !!js process\.env\.INSIGHT_AGENT_PYTHON \?\? 'python'", "command: '$yamlPython'"
$yaml = $yaml -replace "- !!js process\.env\.INSIGHT_AGENT_SKILLS_DIR \?\? './skills'", "- '$yamlSkills'"
$yaml = $yaml.Replace("name: './dist/host.js'", "name: '$yamlPlugin'")
Set-Content -LiteralPath (Join-Path $presetRoot 'agent.cordis.yml') -Value $yaml -Encoding UTF8

Write-Host "Installed InsightAgent preset at $presetRoot"
Write-Host 'Restart DSH, then create a session using the InsightAgent preset.'
