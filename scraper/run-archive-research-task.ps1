$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$logDir = Join-Path $scriptDir 'logs'
$logFile = Join-Path $logDir 'archive-research.log'
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $nodeExe)) {
  throw "Node.js is niet gevonden op $nodeExe"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
Set-Location -LiteralPath $scriptDir

# Windows PowerShell 5 behandelt stderr van native processen als foutrecords.
# Schrijf beide stromen daarom expliciet als UTF-8 en baseer succes uitsluitend
# op de resultaatcode van Node.
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$writer = New-Object System.IO.StreamWriter($logFile, $true, $utf8)
try {
  & $nodeExe 'src\run-archive-research.cjs' 2>&1 | ForEach-Object {
    $writer.WriteLine([string]$_)
    $writer.Flush()
  }
  $exitCode = $LASTEXITCODE
} finally {
  $writer.Dispose()
  $ErrorActionPreference = $previous
}
exit $exitCode
