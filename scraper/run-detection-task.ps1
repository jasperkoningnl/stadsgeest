$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$logDir = Join-Path $scriptDir 'logs'
$logFile = Join-Path $logDir 'detection-run.log'
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Node.js is niet gevonden op $nodeExe"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
Set-Location -LiteralPath $scriptDir
& $nodeExe 'src\kg\detection-run.cjs' 2>&1 | Out-File -LiteralPath $logFile -Encoding utf8 -Append
exit $LASTEXITCODE
