# Continue the current Claude Code session on free/cheap models through a local
# OmniRoute gateway (OpenRouter free tier etc.) when your Claude Pro limit is hit.
#
#   .\scripts\claude-free.ps1            # resume the last session via OmniRoute
#   .\scripts\claude-free.ps1 -Model deepseek/deepseek-chat-v3:free
#
# Back on Claude Pro after the limit resets: open a NEW terminal and run
#   claude --continue
# (the gateway variables below exist only inside this script's process, so a
# fresh terminal talks to Anthropic again). Sessions are stored locally, so the
# same conversation continues either way.
#
# Needs: `npm i -g omniroute` and, in the OmniRoute dashboard
# (http://127.0.0.1:20128), an OpenRouter key added as a provider plus an
# OmniRoute API key exported as OMNIROUTE_API_KEY. Free models may log prompts
# on the provider side - don't use this for secrets you can't share.
param([string]$Model = "auto", [int]$Port = 20128)

$base = "http://127.0.0.1:$Port"
function Test-Gateway { try { Invoke-WebRequest "$base/v1/models" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null; $true } catch { [bool]$_.Exception.Response } }

if (-not (Test-Gateway)) {
  Write-Host "Starting OmniRoute on $base ..."
  Start-Process -FilePath "omniroute" -WindowStyle Hidden
  foreach ($i in 1..30) { if (Test-Gateway) { break }; Start-Sleep -Seconds 2 }
  if (-not (Test-Gateway)) { Write-Error "OmniRoute did not come up on $base"; exit 1 }
}
if (-not $env:OMNIROUTE_API_KEY) { Write-Warning "OMNIROUTE_API_KEY is not set - the gateway will reject requests until you create one in its dashboard." }

$env:ANTHROPIC_BASE_URL = $base
$env:ANTHROPIC_AUTH_TOKEN = $env:OMNIROUTE_API_KEY
if ($Model -ne "auto") { $env:ANTHROPIC_MODEL = $Model }
Write-Host "Claude Code -> OmniRoute ($Model). Run 'claude --continue' in a new terminal to go back to Claude Pro."
claude --continue
