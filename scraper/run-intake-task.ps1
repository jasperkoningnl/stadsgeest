$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = 'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Node.js is niet gevonden op $nodeExe"
}

Set-Location -LiteralPath $scriptDir
$logDir = Join-Path $scriptDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog = Join-Path $logDir "intake-$stamp.log"
$errLog = Join-Path $logDir "intake-$stamp.err.log"
$intakeProcess = Start-Process -FilePath $nodeExe -ArgumentList @('intake-run.mjs', 'taakplanner') -WorkingDirectory $scriptDir -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
Add-Content -LiteralPath (Join-Path $logDir 'intake-task.log') -Value "$(Get-Date -Format o) exit=$($intakeProcess.ExitCode) stdout=$outLog stderr=$errLog" -Encoding UTF8
exit $intakeProcess.ExitCode
