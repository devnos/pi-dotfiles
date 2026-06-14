# Restore pi agent config on a fresh Windows machine.
# Usage:  powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Optional env var to override the target:
#   $env:PI_AGENT_DIR = "D:\custom\pi\agent"

$ErrorActionPreference = "Stop"

$RepoDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$PiAgentDir  = if ($env:PI_AGENT_DIR) { $env:PI_AGENT_DIR } else { Join-Path $env:USERPROFILE ".pi\agent" }

Write-Host "==> Target: $PiAgentDir"
New-Item -ItemType Directory -Force -Path (Join-Path $PiAgentDir "extensions")      | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PiAgentDir "wierd-statusline") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $PiAgentDir "npm")             | Out-Null

function Install-File($RelSrc, $AbsDst) {
    $Src = Join-Path $RepoDir $RelSrc
    $DstDir = Split-Path -Parent $AbsDst
    if (-not (Test-Path $DstDir)) { New-Item -ItemType Directory -Force -Path $DstDir | Out-Null }
    Copy-Item -Path $Src -Destination $AbsDst -Force
    Write-Host "  + $AbsDst"
}

Write-Host "==> Copying config files"
Install-File "agent\settings.json"                (Join-Path $PiAgentDir "settings.json")
Install-File "agent\models.json"                  (Join-Path $PiAgentDir "models.json")
Install-File "agent\extensions\prompt-arrow.js"   (Join-Path $PiAgentDir "extensions\prompt-arrow.js")
Install-File "agent\wierd-statusline\events.json" (Join-Path $PiAgentDir "wierd-statusline\events.json")
Install-File "agent\AGENTS.md"                    (Join-Path $PiAgentDir "AGENTS.md")

# mcp.json: replace ${PI_AGENT_DIR} with the resolved path
# On Windows the JSON uses forward slashes, which is fine for node.
Write-Host "==> Rendering mcp.json from template"
$Template = Get-Content -Raw (Join-Path $RepoDir "agent\mcp.json.template")
$Rendered = $Template -replace [regex]::Escape('${PI_AGENT_DIR}'), $PiAgentDir.Replace('\', '/')
$Rendered | Set-Content -Path (Join-Path $PiAgentDir "mcp.json") -NoNewline
Write-Host "  + $(Join-Path $PiAgentDir 'mcp.json')"

# npm dependencies
Write-Host "==> Installing npm dependencies (this can take a minute)"
Install-File "agent\npm\package.json"     (Join-Path $PiAgentDir "npm\package.json")
Install-File "agent\npm\package-lock.json" (Join-Path $PiAgentDir "npm\package-lock.json")
Push-Location (Join-Path $PiAgentDir "npm")
try {
    npm install --no-audit --no-fund
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "==> Reminder: create $PiAgentDir\auth.json manually" -ForegroundColor Yellow
Write-Host "    Format:"
Write-Host '    { "minimax": { "type": "api_key", "key": "sk-cp-..." } }'
Write-Host ""
Write-Host "Done. Run 'pi' to start." -ForegroundColor Green
