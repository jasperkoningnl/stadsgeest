Set-Location "C:\Users\Jasper Koning\projects\amersfoort-lokaal"
Write-Host "Huidige map: $(Get-Location)"
Write-Host "npm install starten..."
& "C:\Program Files\nodejs\npm.cmd" install
Write-Host "DONE: exit code $LASTEXITCODE"
