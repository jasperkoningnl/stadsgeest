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

Fase 3 is op 13 september 2026 technisch en operationeel afgerond. Naast DUO
(86 vestigingen, 83 tellingen en 60 prognosereeksen) zijn actief:

- Onderwijsinspectie: 116 lokale instellingen, gekoppeld aan BRIN/vestiging;
- KOOP: eigen SRU-route voor vier niet-gemeentelijke publicatiebladen;
- AFM: volledige XML, 23.336 landelijke instellingen en 195 lokale registraties
  met KVK, vergunningen, producten en diensten;
- DNB: zes deelregisters, 45.700 landelijke regels en 15 lokale of hard
  gematchte registerrelaties;
- Politie/CBS: 160.000 meetrijen, zestien delicten, 214 geversioneerde gebieden
  en laatste maand `2026MM07`;
- NDW: DATEX II, officiële gemeentegeometrie plus één kilometer buffer en bij
  laatste controle 164 lokale records;
- RVO: 73.879 landelijke exportregels en 329 lokale projecten via geometrie,
  plaatsvermelding of lokale graph-watchlist.

Alle nieuwe bronnen gebruiken een nulmeting zonder historische events,
semantische hashes, ruwe snapshots, stabiele bronidentiteit,
tweerunsbevestiging voor verdwijningen en adaptergewijze foutisolatie.
Identieke productieruns schreven niets nieuws.

De orkestrator registreert dertien regels: R1–R7 en R9–R14. R8 blijft voor fase
4. De oorspronkelijke nummering is hersteld: R5 is politie-anomalie, R10 is
multi-sourceversterking, DUO is R11/R12, Inspectie R13 en NDW R14.

## Laatste verificatie

- KOOP-audit: 280 officiële lokale publicaties bemonsterd; 6 al aanwezig in de
  klassieke intake (2,1%), dus de aparte SRU-adapter is uitgevoerd.
- Politiebacktest `2024MM08`–`2026MM07`: 62.144 buurt-maandpunten, 15 triggers
  en 62.129 onderdrukkingen (0,024%).
- R10-backtest over 24 maanden: 2.069 signalen, 185 multibronkandidaten, 133
  binnen negentig dagen en 83 niet verworpen.
- Offline suite: 81/81 tests geslaagd. Productie-nulmetingen en herhaalruns
  leverden geen onverwachte events of duplicaten; NDW-taakresultaat is 0.

Deze cijfers zijn een momentopname, geen vervanging voor een nieuwe controle na
codewijzigingen.

## Open risico's en eerstvolgende stappen

1. Fase 4 is de volgende productfase; start met de periodieke bronnen uit het
   leidende uitbreidingsplan.
2. Herkalibreer de conservatieve politieformule alleen met nieuwe redactioneel
   gelabelde uitkomsten en verhoog dan de detectorversie.
3. RVO-graphmatches en NDW-bufferrecords dragen een onzekerheidswaarschuwing en
   blijven redactioneel te beoordelen.
4. Onbekende niet-gevolgde bestanden blijven buiten deze wijziging.

De actuele uitwerking staat in `PHASES/phase-3.md`.
