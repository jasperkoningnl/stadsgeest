# Actuele toestand — Stadsgeest

**Doel:** compacte herschrijfbare momentopname.
**Status:** actueel per 13 september 2026.
**Lees wanneer:** bij iedere nieuwe taak. Historische details staan elders.

## Productie

Stadsgeest is een lokale journalistieke signalerings- en tipmachine voor
Amersfoort en Leusden. Publieke bronnen worden opgeslagen, tot signalen
geclusterd, via entiteiten en detectieregels verbonden en door de weger omgezet
in redactietips en dossierfeiten. Het redactiedashboard draait op
`stadsgeest.nl/nieuwsplein33`; de applicatie staat op Vercel en de operationele
pipeline op Jaspers Windows-notebook.

De hoofdketen is:

`bronnen → raw_items/source_records → events en entiteiten → signalen → weger → tips/dossiers → dashboard`

De dagelijkse detectierun via Windows Taakplanner blijft om 06.15 uur actief.
NDW heeft daarnaast de taak `Stadsgeest NDW`, iedere vijftien minuten. De
broncadans voorkomt onnodig dagelijks ophalen van week- en maandbronnen. Intake
en detectie hebben eigen locks.

## Afgeronde fase

Fase 4 is op 13 september 2026 technisch en operationeel afgerond. De fase-3-
keten en nummering bleven intact. Nieuw productieactief zijn:

- Jaarverantwoording Zorg: 3.503 lokale/hard gekoppelde regels en tien
  vergelijkbare financiële reeksen uit 2023–2024;
- dPi: 1.482 actuele en 1.482 historische lokale regels, met 1.170
  een-op-eenvergelijkingen;
- UITagenda 266 optredens, evenementenkalender 115 registraties,
  Rijksmonumentenregister 559 monumenten en 17 governancefeiten;
- SEVESO+: één lokale inrichting, één nalevingsvermelding en vijf openbare
  inspectiesamenvattingen;
- RIVM Samen Meten: 72 lokale meetstromen bij veertien meetpunten, experimenteel
  en standaard uitgeschakeld.

Alle nieuwe bronnen gebruiken een nulmeting zonder historische events,
semantische hashes, ruwe snapshots, stabiele bronidentiteit,
tweerunsbevestiging voor verdwijningen en adaptergewijze foutisolatie.
Identieke productieruns schreven niets nieuws.

De orkestrator registreert R1–R16. R8 is de veelgevraagde lokale spreker/maker,
R15 de zorgcijferafwijking en R16 de dPi-planverschuiving. R5, R10, R11, R12,
R13 en R14 behouden hun afgesproken betekenis.

## Laatste verificatie

- KOOP-audit: 280 officiële lokale publicaties bemonsterd; 6 al aanwezig in de
  klassieke intake (2,1%), dus de aparte SRU-adapter is uitgevoerd.
- Politiebacktest `2024MM08`–`2026MM07`: 62.144 buurt-maandpunten, 15 triggers
  en 62.129 onderdrukkingen (0,024%).
- R10-backtest over 24 maanden: 2.069 signalen, 185 multibronkandidaten, 133
  binnen negentig dagen en 83 niet verworpen.
- Fase-4-productienulmeting: alle acht adapters `ok`, nul events; ruwe snapshots
  en baselines zijn in productie vastgelegd.
- R15-backtest 2023–2024: 10 vergelijkingen, 6 signalen, 4 onderdrukt. R16-
  backtest 2024–2025: 1.170 vergelijkingen, 200 signalen, 970 onderdrukt.
- De identieke productieherhaalrun is op verzoek afgebroken en geldt niet als
  bewijs; de eerstvolgende geplande run moet het live herhaalbewijs leveren.
- Offline suite 92/92 en database-integratie 39/39 geslaagd; documentatiecontrole,
  lint en productiebuild groen. Lint meldt alleen de al bestaande ongebruikte
  `bronFouten`-variabele in het beheerscherm.

Deze cijfers zijn een momentopname, geen vervanging voor een nieuwe controle na
codewijzigingen.

## Open risico's en eerstvolgende stappen

1. Fase 5 is de volgende productfase; begin met de redactionele leerloop.
2. Bevestig bij de eerstvolgende geplande detectierun dat fase-4-records
   ongewijzigd blijven en niets dupliceert.
3. Herkalibreer de conservatieve politieformule alleen met nieuwe redactioneel
   gelabelde uitkomsten en verhoog dan de detectorversie.
4. RVO-graphmatches en NDW-bufferrecords dragen een onzekerheidswaarschuwing en
   blijven redactioneel te beoordelen.
5. Onbekende niet-gevolgde bestanden blijven buiten deze wijziging.

De actuele uitwerking staat in `PHASES/phase-4.md`.
