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
& $nodeExe '--max-old-space-size=768' 'src\kg\detection-run.cjs' 2>&1 | Out-File -LiteralPath $logFile -Encoding utf8 -Append
$detectionExit = $LASTEXITCODE

# De leerloop draait in dezelfde dagelijkse taak, maar is transactioneel en
# foutgeïsoleerd. De evaluatie maakt hoogstens één open maandreview; de
# bewaarroutine anonimiseert pas na 24 maanden. Geen van beide past regels aan.
& $nodeExe 'run-phase5-evaluation.cjs' '--scheduled' 2>&1 | Out-File -LiteralPath $logFile -Encoding utf8 -Append
$evaluationExit = $LASTEXITCODE
& $nodeExe 'retain-phase5-feedback.cjs' '--apply' 2>&1 | Out-File -LiteralPath $logFile -Encoding utf8 -Append
$retentionExit = $LASTEXITCODE

if ($detectionExit -ne 0 -or $evaluationExit -ne 0 -or $retentionExit -ne 0) { exit 1 }
exit 0
