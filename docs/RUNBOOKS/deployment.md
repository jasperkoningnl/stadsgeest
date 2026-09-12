# Deployment en herstel

**Doel:** controles rond een wijziging die naar productie gaat.
**Status:** actief.
**Lees wanneer:** bij frontenddeployment of wijziging van productieplanning.

## Frontend

1. Voer `npm run check` uit.
2. Controleer de bedoelde Git-diff en bevestig dat geen geheim of onbekend
   bestand is opgenomen.
3. Push alleen de bedoelde commit naar `main`; Vercel deployt vanaf `main`.
4. Controleer de gewijzigde route live en leg afwijkingen vast.

## Operationele taken

Wijzig PM2 of Windows Taakplanner alleen met expliciete taakscope. Noteer vóór
de wijziging naam, trigger, actie, werkmap en herstelpad. Controleer na afloop
status, laatste resultaat, volgende run en relevante loguitvoer.

## Herstel

Gebruik Gitgeschiedenis en gerichte reversals. Gooi geen onbekende lokale
wijzigingen weg met reset, checkout of clean. Databaseherstel vereist een
afgebakende selectie en telling vóór en na; een brede delete of terugrol is geen
standaard herstelstap.
