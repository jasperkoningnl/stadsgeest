# Technische beslissingen

**Doel:** zwaarwegende afwijkingen van het leidende uitbreidingsplan verklaren.
**Status:** gezaghebbend.
**Lees wanneer:** bij roadmapafwijkingen of wanneer een eerdere ontwerpkeuze ter discussie staat.

## 2026-09-13 — Migratieplan geïntegreerd, niet langer zelfstandig leidend

De blijvende contracten uit het migratieplan zijn opgenomen in
`ARCHITECTURE.md`, `SOURCES.md`, `TESTING.md` en `PHASES/phase-0.md`. Actuele
migratiecode en de productiedatabase zijn leidend voor het schema; het oude plan
blijft alleen historische implementatienaslag. Reden: delen zijn uitgevoerd en
andere details zijn door productie-ervaring geëvolueerd.

## 2026-09-13 — Geen ongebruikte KG-featureflags toevoegen

De vijf voorgestelde `STADSGEEST_*`-flags zijn niet geïmplementeerd. KG-detectie
draait als afzonderlijke taak en wordt niet impliciet vanuit de klassieke intake
geactiveerd. Ongebruikte flags zouden schijnveiligheid en extra configuratie
toevoegen. Herbeoordeel dit wanneer beide paden worden geïntegreerd of een
onderdeel afzonderlijk teruggeschakeld moet kunnen worden.

## 2026-09-13 — Oorspronkelijke R5/R10 behouden; DUO wordt R11/R12

Het uitbreidingsplan is leidend voor de publieke regelidentiteit: R5 blijft de
anomaliedetector voor geregistreerde misdrijven en R10 blijft multi-source-
versterking. De tussentijds als R10 en R11 gebouwde DUO-regels worden daarom
R11 (leerlingaantallen) en R12 (prognoses). Inspectiekwaliteit krijgt R13 en
NDW-impact R14. De productie-audit vond geen bestaande DUO-signalen met de oude
R10/R11-provenance, zodat deze correctie geen historische signalen herschrijft.
R8 blijft gereserveerd voor de fase-4-regel uit het uitbreidingsplan.

## 2026-09-13 — Aparte KOOP-SRU-adapter na dekkingsaudit

De bestaande intake bevatte 6 van 280 bemonsterde officiële lokale publicaties
uit Staatscourant, Provinciaal blad, Waterschapsblad en Blad gemeenschappelijke
regeling (2,1%). Dat is ver onder de beslisgrens van 95%. Daarom is de bestaande
adapter niet alleen van classifiers voorzien, maar is een aparte SRU 2.0-route
gebouwd met twee dagen overlap en de officiële publicatie-ID als deduplicatie-
sleutel.

## 2026-09-13 — Bestaande database-enums blijven compatibel

De productievelden `category` en `scrape_frequency` accepteren bewust een kleine
vaste waardenset. Nieuwe fase-3-bronnen gebruiken daarom `registry` of `data` en
`hourly`, `daily` of `weekly`. Dit is geen verlies van betekenis: het bronmanifest
legt het precieze domein en de feitelijke cadans vast, en de taakplanner voert
NDW werkelijk iedere vijftien minuten uit. Zo blijft de migratie additief en
hoeven bestaande tabellen niet risicovol te worden herbouwd.

## 2026-09-13 — Fase-4-regels krijgen R8, R15 en R16

R8 krijgt conform het uitbreidingsplan de identiteit “veelgevraagde lokale
spreker/maker”. R15 wordt de materiële jaar-op-jaarverandering in openbare
zorgverantwoording en R16 de materiële verschuiving in lokale dPi-plannen. R3
wordt inhoudelijk uitgebreid met SEVESO-inspecties en -overtredingen, maar krijgt
geen nieuw nummer. Hiermee blijven R5, R10, R11, R12, R13 en R14 exact behouden.

## 2026-09-13 — Rijksmonumenten via officiële PDOK OGC-route

Het uitbreidingsplan noemt de dagelijkse `Extract_MRS`-ZIP. De actuele download
bevat echter uitsluitend een circa 336 MB groot Microsoft Access-bestand en is
zonder platformspecifieke driver niet veilig reproduceerbaar in de Node-keten.
Daarom gebruikt de adapter de officiële, dagelijks bijgewerkte RCE-collectie in
de PDOK OGC API Features, onder CC-BY 4.0. Monumentnummer/INSPIRE-ID en officiële
gemeentepolygonen blijven de identiteit en lokale bewijsroute bepalen.

## 2026-09-13 — Geen verzonnen Leusdense evenementenkalenderdekking

Amersfoort publiceert een jaarkalender met de expliciete waarschuwing dat
registratie geen vergunning is. Voor Leusden is geen vergelijkbare actuele,
officiële openbare jaarkalender gevonden. De gemeentekalenderadapter dekt daarom
alleen Amersfoort; Leusdense evenementen komen uitsluitend uit de op locatie
gevalideerde regionale UITagenda. Dit wordt als bekende dekkingsgrens getoond.

## 2026-09-13 — Samen Meten blijft experimenteel en standaard uit

De publieke RIVM SensorThings-API is technisch bruikbaar na lokale geoquery,
punt-in-polygooncontrole en gemeentecodecontrole. Goedkope sensoren hebben echter
geen zelfstandig journalistiek gezag. De adapter staat daarom achter
`STADSGEEST_ENABLE_SAMEN_METEN=1`, bewaart alleen meetcontext en emitteert nog
geen harde events. Activering van signalering vereist latere kalibratie op ten
minste drie sensoren, twee uur continuïteit en voldoende dekking, plus review.

## 2026-09-13 — Zorgcijfers krijgen een begrensde streamparser

De vijf definitieve ODS-bestanden over 2023 en 2024 bevatten samen honderdduizenden
rijen en pakken zeer groot uit. Volledig in geheugen uitpakken bedreigt de
dagelijkse keten. De adapter leest daarom alleen `content.xml` als stream, houdt
uitsluitend schemahoofden en exact lokale/hard-KVK-gematchte rijen vast en draait
operationeel met een begrensde Node-heap. Een fout raakt alleen deze adapter.

## 2026-09-13 — Live herhaalrun op gebruikersverzoek afgebroken

De volledige fase-4-productienulmeting is geslaagd voor alle acht adapters en
maakte nul events. De aansluitend gestarte identieke herhaalrun is op
uitdrukkelijk verzoek afgebroken om direct af te ronden. Dit geldt niet als
technisch bewijs van live idempotentie; de eerstvolgende geplande detectierun
moet aantonen dat productie uitsluitend ongewijzigde records ziet en niets
dupliceert.

## 2026-09-13 — Fase-5-uitkomsten en historische herkomst zijn aparte eenheden

Een redactioneel tipbesluit, zijn bevroren herkomst en een gepubliceerd artikel
worden afzonderlijk opgeslagen. Eén canonieke Nieuwsplein33-URL is één uitkomst,
ook bij meerdere tips; de vraag of het artikel zonder Stadsgeest was ontstaan is
verplicht ja/nee. Dit voorkomt dat ontbrekende antwoorden als negatief gelden of
een artikel dubbel wordt geteld. Historische feedback is additief verrijkt; één
exacte bestaande dubbele handeling is gemarkeerd en niet verwijderd.

## 2026-09-13 — Geen zelfoptimalisatie vóór harde bewijs- en reviewgrenzen

De leerloop rapporteert vanaf tien beoordelingen alleen beschrijvend. Handmatige
kalibratie wordt pas vanaf dertig onderzocht. Een bron- of regelwijziging vereist
minstens vijftig relevante beoordelingen en twee afgeronde maandreviews; een
geleerd rangmodel minstens tweehonderd voorbeelden met vijftig positieve en
vijftig negatieve. Geen productiescript past drempels, gewichten of regels toe.
Reden: de huidige 23 unieke beoordelingen en één artikeluitkomst zijn nuttig als
beginmeting, maar onvoldoende voor causale of betrouwbare optimalisatie.

## 2026-09-13 — Feedbackretentie beperkt vrije tekst tot 24 maanden

Feedbackcategorieën, provenancehashes en uitkomsten blijven beschikbaar voor
langetermijnmeting. Vrije notities worden na 24 maanden verwijderd en de actor
wordt geanonimiseerd; iedere retentierun is controleerbaar. Feedback blijft voor
ingelogde redacteuren, terwijl geaggregeerde leer- en reviewinformatie Jasper-only
is. Dit beperkt privacyrisico zonder de telbare kwaliteitsgeschiedenis te wissen.

## 2026-09-13 — Fase-4-herhaalbewijs alsnog voltooid

De eerstvolgende volledige run zag bij zeven adapters uitsluitend ongewijzigde
records en nul events. Governance faalde geïsoleerd op een timeout en zag bij de
directe gerichte herhaling 17 ongewijzigde records en nul events. De fase-4-audit
bleek zelf `records_found` niet te selecteren terwijl zij dit veld controleerde;
alleen die auditquery is gerepareerd. Er is geen fase-4-functionaliteit uitgebreid.

## 2026-09-14 — ANBI-adapter: geen bestuurswijzigingsdetectie

De ANBI-adapter detecteert registratiewijzigingen (ANBI_ADDED, ANBI_REMOVED,
ANBI_NAME_CHANGED, ANBI_WEBSITE_CHANGED) op basis van het gecomprimeerde
Excelbestand van de Belastingdienst open data. Bestuurswijzigingen
(BOARD_MEMBER_ADDED/REMOVED) vereisen een aparte websitescraper die organisatie-
pagina's en -documenten crawlt voor bestuur/RvT-informatie. Die scraper ontbreekt
nog. Het uitbreidingsplan noemt dit expliciet in fase 4 ("Bestuur/RvT-extractie
uit openbare organisatiepagina's en documenten"). De ANBI-adapter is zonder deze
functionaliteit volledig bruikbaar voor registerdiff; de websitescraper is een
apart bouwblok dat onafhankelijk kan worden ingepland.

## 2026-09-14 — GLEIF: verdwenen LEI's als statuswijziging, niet als verwijdering

Het uitbreidingsplan specificeert: "verlopen of verdwenen LEI's worden als
statuswijziging behandeld, niet als verwijdering." De adapter implementeert dit
door bij een diff een verdwenen LEI te controleren op de laatst bekende status.
Was die al INACTIVE of RETIRED, dan wordt het record stilzwijgend verwijderd uit
het snapshot zonder event. Was de status actief (ACTIVE, PENDING_VALIDATION,
e.d.), dan emitteert de adapter een ENTITY_STATUS_CHANGED-event met
`newStatus: 'DISAPPEARED'`. Dit voorkomt vals-positieve verwijderevents bij
regulier aflopende registraties, terwijl onverwachte verdwijningen wél worden
gesignaleerd.

## 2026-09-14 — GLEIF: dubbele adresquery en watchlist

De GLEIF JSON:API ondersteunt geen OR-filter op stad. De adapter voert daarom
twee afzonderlijke query's uit: één op `legalAddress.city` en één op
`headquartersAddress.city`, elk voor Amersfoort en Leusden (vier query's totaal).
Resultaten worden samengevoegd en ontdubbeld op LEI. Daarnaast onderhoudt de
adapter een watchlist van bekende lokale LEI's uit `entity_identifiers`, die bij
iedere run apart worden opgehaald — ook als ze niet meer via adresfilter worden
gevonden. Dit vangt verhuizingen op: een bedrijf dat verhuist maar eerder lokaal
was geïdentificeerd blijft in beeld.

## 2026-09-14 — OSM Overpass: geen harde events, alleen contextlaag

De OSM-adapter gebruikt bronklasse STRUCTURED_CONTEXT en emitteert standaard
geen harde events. Dit is een bewuste keuze: OpenStreetMap is door vrijwilligers
onderhouden en heeft geen officieel gezag. De adapter legt fysieke objecten vast
(winkels, kantoren, voorzieningen) als contextlaag voor entiteitsverrijking en
graph matching. Optioneel kunnen zachte events (OSM_ENTITY_CANDIDATE,
OSM_LOCATION_CHANGED) worden ingeschakeld via `emitSoftEvents: true` of de
CLI-vlag `--emit-soft`, maar deze hebben standaard lage confidence en genereren
geen signalen. Coördinaten worden afgerond op 4 decimalen (~11 meter) om
GPS-driftruis in de semantische hash te voorkomen.

## 2026-09-14 — OSM: Overpass area-ID's in plaats van bounding box

Het uitbreidingsplan specificeert "gebiedsquery's op de bestuurlijke grenzen."
De adapter gebruikt Overpass area-ID's afgeleid van OSM-relatie-ID's
(relatie + 3600000000): Amersfoort = 3600419556, Leusden = 3600161446. Dit
volgt exact de bestuurlijke grenzen in plaats van een bounding box, wat
nauwkeuriger is en geen handmatige coördinaten vereist. Rate limiting: 10
seconden pauze tussen gemeentequery's om de Overpass-API niet te overbelasten.

## 2026-09-14 — Geen PostGIS; geofilters via code met officiële polygonen

Het uitbreidingsplan noemt "BAG-adresnormalisatie en PostGIS-geofilter" in
fase 1. De database is Turso (libsql/SQLite) en heeft geen PostGIS-extensie.
Geofilters worden in code uitgevoerd met officiële CBS/PDOK-gemeentepolygonen
en punt-in-polygoonberekeningen (NDW, Samen Meten, Rijksmonumenten). Dit is
functioneel equivalent: de exacte officiële gemeentegrenzen worden gebruikt,
alleen de uitvoering is in JavaScript in plaats van in de database. Geen actie
nodig tenzij schaal of complexiteit een database-geïntegreerde oplossing vereist.

## 2026-09-14 — Tuchtrechtbron: status opgehelderd

De tuchtrechtadapter (`tuchtrecht-sru.cjs`) is functioneel maar heeft drie
structurele beperkingen die samen verklaren waarom SOURCES.md het "geparkeerd of
beperkt" noemt:

1. **Eventtypes niet aangesloten op detectieregels.** De adapter emitteert
   `DISCIPLINARY_RULING_PUBLISHED` en `DISCIPLINARY_MEASURE_IMPOSED`, maar R3
   (`R3_NATIONAL_SANCTION`) vangt uitsluitend ACM-, AP-, asbest- en SEVESO-events
   op. Tuchtrechtevents in de database genereren dus nooit signalen. Dit is te
   repareren door de twee eventtypes aan R3 toe te voegen.

2. **Geen schedule in de orkestrator.** De adapter draait zonder
   `{ sourceName, minimumHours }` in de ADAPTERS-array, waardoor `adapterIsDue()`
   altijd `true` retourneert en de adapter bij elke detectierun draait. De
   SRU-tuchtrechtcollectie wordt niet dagelijks bijgewerkt; een `minimumHours`
   van 144 (wekelijks) is passend.

3. **Anonimisering beperkt entity-resolutie structureel.** Tuchtuitspraken worden
   in Nederland vaak geanonimiseerd gepubliceerd: geen namen, geen exacte
   adressen. Dit maakt entiteitsmatching onmogelijk voor het merendeel van de
   uitspraken. De adapter filtert op plaatsnaam als fallback, maar het gros van
   de uitspraken bevat ook geen plaatsnaam in de metadata. Dit is een eigenschap
   van de bron, niet van de adapter.

4. **Volgt niet het base-adapter contract.** De adapter erft niet van
   `BaseAdapter`, heeft geen snapshot-diff, geen `health()` en geen provenance
   volgens het standaardcontract. Dit is een oudere adapter die vóór het
   fase-1-entiteitencontract is geschreven.

**Aanbeveling:** de tuchtrechtbron is functioneel laag-rendement vanwege de
anonimisering (punt 3). De quickwins zijn: (a) eventtypes toevoegen aan R3,
(b) schedule toevoegen aan de ADAPTERS-array. Een volledige herschrijving naar
het base-adapter contract is pas nuttig als de bron aantoonbaar lokale matches
oplevert. Tot die tijd is "beperkt" de juiste kwalificatie.

## 2026-09-14 — ANBI-websitescraper: ontbrekend fase-4-bouwblok

Het uitbreidingsplan noemt in fase 4 "Bestuur/RvT-extractie uit openbare
organisatiepagina's en documenten." De ANBI-adapter detecteert register-
wijzigingen (naam, website, toevoeging, verwijdering) maar kan geen bestuurders
identificeren — dat vereist een aparte websitescraper die per ANBI de openbare
organisatiepagina crawlt en bestuursnamen extraheert. De Governance-adapter
(`phase4-context-sources.cjs`) doet dit voor een handmatig gekozen set
ankerorganisaties, maar niet systematisch voor alle ~500 lokale ANBI's. De
websitescraper is een apart bouwblok dat onafhankelijk kan worden ingepland;
de ANBI-registeradapter is zonder deze functionaliteit volledig bruikbaar.
