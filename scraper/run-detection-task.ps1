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

# De oorspronkelijke taak schreef het eerste deel als UTF-16 en latere regels
# als UTF-8. Zo'n gemengd bestand is niet betrouwbaar te herstellen. Bewaar het
# eenmalig als legacy-log en begin daarna expliciet in UTF-8 zonder BOM.
if (Test-Path -LiteralPath $logFile) {
  $eersteBytes = [System.IO.File]::ReadAllBytes($logFile) | Select-Object -First 2
  if ($eersteBytes.Count -eq 2 -and $eersteBytes[0] -eq 0xFF -and $eersteBytes[1] -eq 0xFE) {
    $legacyLog = Join-Path $logDir ('detection-run-legacy-mixed-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Move-Item -LiteralPath $logFile -Destination $legacyLog
  }
}

# Windows PowerShell 5 maakt van elke stderr-regel van een native proces een
# foutrecord. Met 'Stop' brak een enkele waarschuwing de hele taak af (23-9:
# detectierun gestopt tijdens Asbest, evaluatie en retentie overgeslagen,
# resultaatcode 1). Daarom draait elke stap met 'Continue' en telt alleen de
# exitcode van het proces.
function Invoke-NodeStep {
  param([string[]]$Arguments)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $writer = New-Object System.IO.StreamWriter($logFile, $true, $utf8)
  try {
    & $nodeExe @Arguments 2>&1 | ForEach-Object {
      $writer.WriteLine([string]$_)
      $writer.Flush()
    }
    $exitCode = $LASTEXITCODE
    return $exitCode
  } finally {
    $writer.Dispose()
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

# Organisatiekoppeling (docs/KOPPELING.md): organisaties uit registers, geld- en
# toezichtbronnen over bronnen heen koppelen (Splink, scraper\.koppel-venv).
# Schrijft alleen naar org_link_records, org_clusters en org_link_runs; slaat
# het rekenen over als de invoer niet is veranderd.
$koppelExit = Invoke-NodeStep @('src\koppel-organisaties.cjs')

if ($detectionExit -ne 0 -or $evaluationExit -ne 0 -or $retentionExit -ne 0 -or $nerExit -ne 0 -or $adresExit -ne 0 -or $registerExit -ne 0 -or $pandExit -ne 0 -or $koppelExit -ne 0) { exit 1 }
exit 0
