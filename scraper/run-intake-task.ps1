$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = 'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Node.js is niet gevonden op $nodeExe"
}

Set-Location -LiteralPath $scriptDir
& $nodeExe 'intake-run.mjs' 'taakplanner'
exit $LASTEXITCODE
