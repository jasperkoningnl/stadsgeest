# pm2-healthcheck.ps1 — bewaakt de PM2-daemon voor Stadsgeest
#
# Achtergrond: de PM2-daemon is meermaals stilletjes uitgevallen (5-24 juli:
# 19 dagen zonder scrapedata; 5 augustus; 7 augustus). De oude taak
# "PM2 Resurrect" draaide alleen bij inloggen en riep bovendien pm2.ps1 aan
# via cmd.exe, wat niet uitvoerbaar is — die heeft dus nooit gewerkt.
#
# Dit script draait periodiek. Het telt de processen in de daemon en herstelt
# uit dump.pm2 zodra dat er minder zijn dan verwacht.
#
# BELANGRIJK: dit script roept nooit `pm2 save` aan. Een `pm2 save` op een lege
# daemon overschrijft dump.pm2 met een lege lijst en wist alle 11 jobdefinities.

$ErrorActionPreference = 'Stop'

# Let op: het aantal verwachte jobs staat hier NIET vast. Het wordt gelezen uit
# dump.pm2 (zie Lees-Jobnamen), zodat een nieuwe job vanzelf meetelt. Sinds
# 2026-08-09 zijn het er twaalf: extract-entities is erbij gekomen.
$Pm2       = Join-Path $env:APPDATA 'npm\pm2.cmd'
$Dump      = Join-Path $env:USERPROFILE '.pm2\dump.pm2'
$LogPad    = Join-Path $PSScriptRoot 'pm2-healthcheck.log'

function Schrijf-Log([string]$Regel) {
    $tijd = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $LogPad -Value "$tijd  $Regel" -Encoding UTF8
}

# ── Stiltealarm, meeliftend (2026-08-09) ─────────────────────────────────────
# Deze healthcheck kijkt of de PM2-jobs bestaan. Dat zegt niets over de vraag of
# er nog data binnenkomt: de laptop kan uit staan, het netwerk kan weg zijn, of de
# scrapers kunnen draaien en niets vinden. stilte-alarm.mjs kijkt daarom naar de
# database zelf.
#
# Waarom het hier hangt en niet in een eigen taak: een tweede geplande taak
# aanmaken lukt niet zonder beheerdersrechten. `Register-ScheduledTask` en
# `schtasks /XML` geven allebei "Toegang geweigerd", en een taak die met
# `schtasks /SC HOURLY` wél werd aangemaakt bleef op status "Queued" staan zonder
# ooit te draaien. Deze taak ("PM2 Resurrect") draait aantoonbaar elk uur — zie de
# regels hieronder in dit logbestand — dus liften we mee.
#
# Dit staat bewust vóór alle exit-paden hieronder, zodat het altijd draait, ook
# als de PM2-controle zelf afbreekt. En in een eigen try, zodat het de
# healthcheck nooit kan tegenhouden.
try {
    $alarm = Join-Path $PSScriptRoot 'stilte-alarm.cmd'
    if (Test-Path $alarm) { & $alarm 2>&1 | Out-Null }
} catch {
    Schrijf-Log "stiltealarm kon niet draaien: $($_.Exception.Message)"
}

# Namen van de verwachte jobs, gelezen uit dump.pm2.
function Lees-Jobnamen([string]$DumpPad) {
    if (-not (Test-Path $DumpPad)) { return @() }
    $tekst = Get-Content $DumpPad -Raw
    # In dump.pm2 staat "name" zowel op procesniveau als in het env-blok;
    # alleen de procesnaam staat op inspringniveau 4 (twee spaties + quote).
    return @([regex]::Matches($tekst, '(?m)^    "name":\s*"([^"]+)"') |
             ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
}

# Telt hoeveel van de verwachte jobs de daemon daadwerkelijk kent.
# ConvertFrom-Json is hier onbruikbaar: de env-blokken bevatten sleutels die
# alleen in hoofdlettergebruik verschillen (username/USERNAME), waar
# Windows PowerShell op afbreekt. Vandaar tellen op naam.
function Tel-Actieve-Jobs([string]$Pm2Pad, [string[]]$Namen) {
    $ruw = & $Pm2Pad jlist 2>$null | Out-String
    if ([string]::IsNullOrWhiteSpace($ruw)) { return 0 }
    $n = 0
    foreach ($naam in $Namen) {
        if ($ruw -match ('"name":\s*"' + [regex]::Escape($naam) + '"')) { $n++ }
    }
    return $n
}

try {
    if (-not (Test-Path $Pm2)) {
        Schrijf-Log "FOUT pm2.cmd niet gevonden op $Pm2"
        exit 1
    }

    # Alleen herstellen als dump.pm2 daadwerkelijk jobs bevat. Zonder deze
    # controle zou een lege dump een lege daemon "herstellen" en de storing
    # verbergen.
    $namen = Lees-Jobnamen $Dump
    if ($namen.Count -lt 1) {
        Schrijf-Log "FOUT dump.pm2 ontbreekt of bevat geen jobs - niets om op terug te vallen"
        exit 1
    }

    $aantal = Tel-Actieve-Jobs $Pm2 $namen

    if ($aantal -ge $namen.Count) {
        Schrijf-Log "ok $aantal van $($namen.Count) jobs actief"
        exit 0
    }

    $ontbreekt = @($namen | Where-Object {
        $r = & $Pm2 jlist 2>$null | Out-String
        $r -notmatch ('"name":\s*"' + [regex]::Escape($_) + '"')
    })
    Schrijf-Log "HERSTEL $aantal van $($namen.Count) jobs actief, ontbreekt: $($ontbreekt -join ', ') - resurrect gestart"

    & $Pm2 resurrect 2>&1 | Out-Null
    Start-Sleep -Seconds 5

    $na = Tel-Actieve-Jobs $Pm2 $namen
    Schrijf-Log "HERSTEL afgerond, nu $na van $($namen.Count) jobs actief"
    if ($na -lt $namen.Count) { exit 1 }
    exit 0
}
catch {
    Schrijf-Log "FOUT onverwachte fout: $($_.Exception.Message)"
    exit 1
}
