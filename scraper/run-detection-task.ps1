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

# Windows PowerShell 5 maakt van elke stderr-regel van een native proces een
# foutrecord. Met 'Stop' brak een enkele waarschuwing de hele taak af (23-9:
# detectierun gestopt tijdens Asbest, evaluatie en retentie overgeslagen,
# resultaatcode 1). Daarom draait elke stap met 'Continue' en telt alleen de
# exitcode van het proces.
function Invoke-NodeStep {
  param([string[]]$Arguments)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $nodeExe @Arguments 2>&1 | ForEach-Object { "$_" } | Out-File -LiteralPath $logFile -Encoding utf8 -Append
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

# De gecombineerde run houdt meerdere datasets en adaptermodules tegelijk vast;
# 768 MB bleek na activering van ANBI/GLEIF/OSM onvoldoende.
$detectionExit = Invoke-NodeStep @('--max-old-space-size=1536', 'src\kg\detection-run.cjs')

# De leerloop draait in dezelfde dagelijkse taak, maar is transactioneel en
# foutgeisoleerd. De evaluatie maakt hoogstens een open maandreview; de
# bewaarroutine anonimiseert pas na 24 maanden. Geen van beide past regels aan.
$evaluationExit = Invoke-NodeStep @('run-phase5-evaluation.cjs', '--scheduled')
$retentionExit = Invoke-NodeStep @('retain-phase5-feedback.cjs', '--apply')

# NER spoor 1 (docs/NER.md): nieuwe items uit het bronbereik, na de detectie en
# voor de weger. Schrijft alleen naar document_mentions en ner_scans. Python
# komt uit scraper\.ner-venv (zie extract-ner.cjs).
$nerExit = Invoke-NodeStep @('src\extract-ner.cjs', '--limit', '500')

# Adreskoppeling (docs/ADRESKOPPELING.md): adressen uit nieuwe items en uit de
# registers LRK, GLEIF en DUO exact aan de BAG koppelen. PDOK-antwoorden komen
# grotendeels uit bag_lookup_cache.
$adresExit = Invoke-NodeStep @('src\extract-addresses.cjs', '--limit', '500')
$registerExit = Invoke-NodeStep @('src\link-register-addresses.cjs')
# Pand bij nieuwe verblijfsobjecten (zelfde gebouw, ander adres).
$pandExit = Invoke-NodeStep @('src\link-bag-panden.cjs', '--limit', '2000')

if ($detectionExit -ne 0 -or $evaluationExit -ne 0 -or $retentionExit -ne 0 -or $nerExit -ne 0 -or $adresExit -ne 0 -or $registerExit -ne 0 -or $pandExit -ne 0) { exit 1 }
exit 0
