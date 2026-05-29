param(
  [string]$TaskKey
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Test-Path ".\\node_modules\\playwright")) {
  throw "Missing dependency: playwright. Run 'npm install' in $projectRoot first."
}

if ($TaskKey) {
  node ".\\scripts\\run-checkin.js" --task $TaskKey
} else {
  node ".\\scripts\\run-checkin.js"
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
