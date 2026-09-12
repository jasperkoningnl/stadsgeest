# Storingsonderzoek

**Doel:** van symptoom naar bewijs zonder overhaaste herstelactie.
**Status:** actief.
**Lees wanneer:** bij stilte, foutpieken, dataruis of dashboardproblemen.

## Geen nieuwe bronitems

1. Stel vast of de notebook en de geplande taak daadwerkelijk hebben gedraaid.
2. Controleer PM2- en taakresultaten en vervolgens de meest recente runlogs.
3. Vergelijk bronnen binnen dezelfde uitgevoerde run.
4. Herstel pas daarna het specifieke proces; schrijf niet blind een nieuwe
   PM2-dump.

## Wel bronitems, geen signalen of tips

1. Controleer `intake_runs`, `intake_decisions` en recente `signal_events`.
2. Controleer locks en of detectie na de benodigde bronstap liep.
3. Controleer bewijslinks (`raw_items`, `signal_items`, provenance).
4. Maak onderscheid tussen een geldige baseline, normale filtering en storing.

## Plotseling zeer veel signalen

Behandel dit als mogelijke backfill, parserwijziging, registerruis of
clusterfout. Stop automatische vervolgverwerking indien verdere writes schade
kunnen vergroten. Trek een steekproef met bron, semantische sleutel en
diffreden; verwijder niets zonder afgebakend herstelplan.

## Dashboard stuk

Controleer build, Vercel-deployment, ontbrekende omgevingsvariabelen en de
databaseverbinding. Voor het redactionele logboek moet `LOGBOEK.md` in de
Vercel-output zijn opgenomen via `next.config.ts`.

Leg resultaat, verificatie, open risico en volgende stap vast in de taakuitvoer.
Werk `CURRENT.md` alleen bij als de actuele toestand duurzaam is veranderd.
