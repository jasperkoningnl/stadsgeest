# stilte-alarm.ps1 — wrapper om stilte-alarm.mjs
#
# Draait elk uur via de Windows-taak "Stadsgeest stilte-alarm". Logt altijd,
# en toont een Windows-melding zodra er alarm is. Om te voorkomen dat er bij een
# langere storing elk uur een melding verschijnt, wordt er hooguit één keer per
# zes uur getoond; het logbestand loopt wel gewoon door.
#
# Let op wat dit NIET is: een melding komt alleen aan als deze laptop aan staat.
# Staat de machine uit, dan verschijnt het alarm zodra hij weer aan gaat. Een
# kanaal dat Jasper ook elders bereikt (mail, telefoon) vraagt om inloggegevens
# en is een aparte beslissing — zie STATUS.md 2026-08-09.

$ErrorActionPreference = 'Stop'

# Onder een geplande taak is er geen console om fouten in te zien. Alles wat
# misgaat moet dus in het logbestand belanden, ook als PowerShell zelf struikelt.
trap {
    try {
        $t = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
        Add-Content -Path (Join-Path $PSScriptRoot 'stilte-alarm.log') -Value "$t  FOUT onafgevangen: $($_.Exception.Message)" -Encoding UTF8
    } catch { }
    exit 2
}

$LogPad     = Join-Path $PSScriptRoot 'stilte-alarm.log'
$StempelPad = Join-Path $PSScriptRoot '.stilte-alarm-laatste-melding'
$Script     = Join-Path $PSScriptRoot 'stilte-alarm.mjs'
$StilUren   = 6

function Schrijf-Log([string]$Regel) {
    $tijd = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $LogPad -Value "$tijd  $Regel" -Encoding UTF8
}

function Toon-Melding([string]$Tekst) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $icoon = New-Object System.Windows.Forms.NotifyIcon
        $icoon.Icon = [System.Drawing.SystemIcons]::Warning
        $icoon.BalloonTipTitle = 'Stadsgeest: pijplijn stil'
        $icoon.BalloonTipText = $Tekst
        $icoon.Visible = $true
        $icoon.ShowBalloonTip(20000)
        Start-Sleep -Seconds 12
        $icoon.Dispose()
    } catch {
        Schrijf-Log "kon geen melding tonen: $($_.Exception.Message)"
    }
}

# node staat niet altijd in het PATH van een geplande taak. Eerst het gewone
# commando proberen, anders de standaardinstallatie.
function Vind-Node {
    $c = Get-Command node -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

try {
    $node = Vind-Node
    if (-not $node) { Schrijf-Log 'FOUT node.exe niet gevonden'; exit 2 }

    Push-Location $PSScriptRoot
    $uitvoer = & $node $Script 2>&1 | Out-String
    $code = $LASTEXITCODE
    Pop-Location

    $regels = ($uitvoer -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
    foreach ($r in $regels) { Schrijf-Log $r.Trim() }

    if ($code -eq 0) { exit 0 }

    # Alarm of meetfout: melden, maar niet vaker dan eens per $StilUren.
    $magMelden = $true
    if (Test-Path $StempelPad) {
        $laatste = Get-Item $StempelPad
        if ((Get-Date) - $laatste.LastWriteTime -lt [TimeSpan]::FromHours($StilUren)) {
            $magMelden = $false
        }
    }

    if ($magMelden) {
        Toon-Melding (($regels -join ' | '))
        Set-Content -Path $StempelPad -Value (Get-Date -Format 'o') -Encoding UTF8
    } else {
        Schrijf-Log "melding onderdrukt (al gemeld binnen $StilUren uur)"
    }
    exit $code
}
catch {
    Schrijf-Log "FOUT onverwachte fout: $($_.Exception.Message)"
    exit 2
}
