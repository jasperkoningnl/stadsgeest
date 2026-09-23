# Bronnen en bronbeleid

**Doel:** routekaart voor bronwerk; geen handmatig bijgehouden live teller.
**Status:** gezaghebbend voor principes, indicatief voor adapterstatus.
**Lees wanneer:** bij scrapers, adapters, brongezondheid of redactionele dekking.

## Rollen

- **Tier 1 — publicatiebron:** officiële stukken, registers, rechtspraak,
  aanbestedingen, inspecties en officiële statistiek. Kan een tip dragen.
- **Tier 2 — corroboratiebron:** gemeente, veiligheidsregio, corporaties,
  waterschap en vergelijkbare organisaties. Kan dragen als het feit voldoende
  onderscheidend is.
- **Tier 3 — detectiebron:** 112, buurtplatforms en sociale media. Alleen
  signaalfunctie.
- **Spiegel:** Nieuwsplein33 en mediapartners. Alleen ontdubbeling, context en
  bevestiging.

Brongezondheid wordt gemeten per uitgevoerde run, niet per kalenderdag. Een
bewust uitgeschakelde taak of een stille publicatieperiode is geen bronstoring.

Redactionele feedback wordt per bron uitsluitend via de bevroren tipcontext
geëvalueerd. `te_zwak`, `niet_relevant`, timing, clustervorming en een technisch
bronprobleem zijn verschillende oorzaken en mogen niet op één hoop worden
geteld. Onder tien beoordelingen wordt geen broncijfer gerapporteerd; een
bron- of regelwijziging vereist minstens vijftig relevante beoordelingen, twee
maandcycli en menselijke goedkeuring. Productie past geen brongewicht automatisch
aan.

## Actieve KG-adapters

De code onder `scraper/src/kg/adapters/` is gezaghebbend voor URL, parsing en
semantische diff. De orkestrator registreert momenteel onder meer:

- Nederlandse Arbeidsinspectie — Eerlijk werk;
- ernstige asbestovertredingen;
- Liander-storingen;
- Autoriteit Persoonsgegevens en ACM-publicaties;
- LRK-kinderopvang;
- DUO-schoolvestigingen, leerlingaantallen en BO-prognoses;
- Onderwijsinspectie-kwaliteitsoordelen, gekoppeld aan DUO-vestigingen;
- KOOP niet-gemeentelijke officiële publicaties;
- AFM volledig vergunningenregister en zes DNB-deelregisters;
- Politie/CBS-buurtmaanden, NDW-planning en RVO-projecten;
- ANBI-register — Belastingdienst open data (wekelijks, RSIN-diff);
- GLEIF — LEI-register (wekelijks, LEI-diff op adres en watchlist);
- OpenStreetMap — Overpass contextlaag (wekelijks, fysieke objecten);
- OpenKvK via overheid.io — dagelijkse registerupdates (betaald, zie onder);
- een geparkeerde of beperkte tuchtrechtbron.

De klassieke bronlaag bevat daarnaast gemeentelijke bekendmakingen,
raadsinformatie, TenderNed, rechtspraak, subsidies, overheidsorganisaties,
regionale bronnen en detectiebronnen. De Onderwijsinspectiebron volgt actuele
toezichtresultaten exact voor Amersfoort en Leusden en gebruikt rapportnummer en
detail-URL als stabiele identiteit. Gebruik databasequeries of de
bronnenwacht voor de actuele lijst en opbrengst; kopieer aantallen niet naar dit
document.

## Fase-3-broncontracten

AFM gebruikt de volledige `WfdExternRegister`-ZIP/XML en niet de beperkte
zoekresultaat-CSV. DNB haalt de actuele codes `WFTKF`, `WFTBI`, `WFTVE`,
`WTTTK`, `WFTEG` en `PWPNF` afzonderlijk op. RVO ontdekt de huidige CSV-link op
de zoekpagina. KOOP gebruikt collectie `officielepublicaties` en ontdubbelt op
de officiële identifier.

ANBI downloadt het gecomprimeerde Excelbestand van de Belastingdienst open data,
filtert op `vestigingsplaats` Amersfoort/Leusden, diff op RSIN/dossiernummer en
detecteert `ANBI_ADDED`, `ANBI_REMOVED`, `ANBI_NAME_CHANGED` en
`ANBI_WEBSITE_CHANGED`. Baseline slaat het snapshot op zonder events. Een
afzonderlijke bestuurdersmonitor kan `BOARD_MEMBER_ADDED/REMOVED` uit HTML van
expliciet toegestane organisatiepagina's halen. Deze pilot heeft nog een lege
allowlist, draait standaard dry-run en is niet operationeel ingepland; PDF-
documenten worden nog niet verwerkt.

GLEIF bevraagt de JSON:API op `api.gleif.org/api/v1/lei-records` met de
ondersteunde fulltextzoekopdracht voor Amersfoort en Leusden en controleert de
gevonden records daarna exact op legal-, hoofd- of ander adres in een van beide
plaatsen. Dit vervangt de niet langer geaccepteerde city-fieldfilters. Een
watchlist van bekende lokale LEI's uit `entity_identifiers` vult dit aan. Diff
op LEI met snapshot; verlopen of verdwenen
LEI's worden als statuswijziging behandeld, niet als verwijdering. Parent-
relaties worden alleen apart opgehaald wanneer het LEI-record daarvoor een
expliciete GLEIF-relatielink bevat, en naar `kg_relations` geschreven.

OpenStreetMap bevraagt de Overpass API met gebiedsquery's op de gemeentelijke
grenzen van Amersfoort (relation 419152) en Leusden (relation 310005). Haalt
nodes, ways en relations op met tags `office`, `shop`, `amenity`, `tourism`,
`leisure` en `healthcare`. Bronklasse `STRUCTURED_CONTEXT`: standaard geen
harde events; optioneel `OSM_ENTITY_CANDIDATE` en `OSM_LOCATION_CHANGED` met
lage confidence. Coördinaten worden op 4 decimalen afgerond (~11m) voor de
hash. Rate limit: 10 seconden pauze tussen gemeentequery's.

BAG-normalisatie gebruikt de openbare PDOK Locatieserver `v3_1/free`. Alleen
een exacte combinatie van BAG-bron, adrestype, postcode, volledig huisnummer en
gemeente Amersfoort/Leusden wordt geaccepteerd. De nummeraanduiding-ID is de
stabiele BAG-sleutel; een fuzzy resultaat wordt niet opgeslagen.

Politie/CBS bouwt de lokale codeset uit de dimensietabel, bewaart het kaartjaar
en haalt 60 maanden op voor de detector. NDW gebruikt de officiële CBS/PDOK-
gemeentegeometrie met een buffer van één kilometer; een straatnaam is nooit een
lokaal bewijs. Onderwijsinspectie behandelt een lege vigerend-oordeelrespons als
ontbrekende data, niet als een negatief oordeel.

De productie-enums blijven grof (`registry`/`data` en
`hourly`/`daily`/`weekly`). Het manifest bewaart de echte domeinen en cadans.
De dagelijkse orkestrator respecteert minimumintervallen; `Stadsgeest NDW`
draait daarnaast werkelijk iedere vijftien minuten.

## Fase-4-broncontracten

Jaarverantwoording Zorg ontdekt steeds de twee nieuwste definitieve boekjaren,
filtert exact op vestigingsplaats of hard KVK en vergelijkt uitsluitend
jaarneutraal gemapte financiële velden. dPi vergelijkt de officiële 2024- en
2025-XLSX voor hetzelfde KVK, DAEB-type, doeljaar, gegevenstype en dezelfde
gemeente. Beide bronnen benoemen dat aangeleverde cijfers of plannen geen
gevalideerde realisaties zijn.

Tijd voor Amersfoort gebruikt detail-JSON-LD en exacte `addressLocality`.
Agenda-items en de gemeentelijke evenementenkalender zijn context; opname op de
kalender is geen vergunning. Governancefeiten komen alleen van vooraf gekozen
openbare organisatiepagina's en personen krijgen een brongebonden identiteit.

Rijksmonumenten komen uit de officiële RCE-collectie in de PDOK OGC API en
worden met GM0307/GM0327 begrensd. SEVESO volgt de maandelijkse inrichtingen- en
nalevingslijst plus lokale inspectiesamenvattingen. Samen Meten combineert de
SensorThings-geoquery met dezelfde officiële polygonen en een gemeentecodecheck;
de adapter staat standaard uit en emitteert geen harde events.

## RaadKijker — moties en amendementen Amersfoort

Scraper `scraper/src/scrapers/raadkijker-moties.js`, hulpfuncties in
`scraper/src/raadkijker.mjs`, dagelijks via `run-all.js`. Eigenaar van de lijst
is RaadKijker (raadkijker.nl/open-data, gebruik vrij met bronvermelding); het
stuk zelf is de Notubiz-PDF van de griffie en dat is de `external_url`. Sleutel
`RAADKIJKER_API_KEY` in `scraper/.env`; 60 verzoeken per minuut, 5.000 per dag.
Cloudflare weigert datacenter-IP's, dus alleen vanaf de notebook.

- Schrijft onder de bestaande rijen 116 (Moties) en 117 (Amendementen).
- Nieuw item alleen voor moties van de laatste 60 dagen (`RAADKIJKER_DAGEN`).
  Tot 180 dagen terug (`RAADKIJKER_DAGEN_AANVUL`) vult hij bij bestaande items
  alleen fulltext en uitslag aan; dat maakt geen nieuwe signalen.
- Tekst: Notubiz-PDF via pdfjs. Notubiz geeft voor een deel van de nieuwste
  stukken HTTP 400; dan `document_tekst` van RaadKijker, die bij oudere records
  vaak alleen het dictum bevat.
- Identiteit: Notubiz-document-id, anders motienummer (jaar-nummer, zonder
  letter) plus gedeelde titelwoorden. De griffie hergebruikt nummers
  (2026-057M bestaat twee keer).
- Uitslag alleen uit het griffiestempel in de titel ("VERWORPEN Motie ..."). Het
  veld `uitslag` van RaadKijker is niet betrouwbaar: 2026-054M staat daar als
  aangenomen terwijl het stempel verworpen zegt. Een definitief stempel wordt
  nooit overschreven; VERDAAGD en AANGEHOUDEN wel.
- Een uitslag die later binnenkomt past alleen de titel aan en maakt geen nieuw
  signaal.
- Verzamelpunten zonder motienummer en oude stukken met een verkeerde datum
  worden overgeslagen.
- Stemgedrag per raadslid en onderwerptags zijn voor Amersfoort leeg bij
  RaadKijker.
- `RAADKIJKER_DRYRUN=1` toont wat hij zou doen zonder te schrijven.

## OpenKvK via overheid.io — registerupdates

Adapter `scraper/src/kg/adapters/openkvk-register.cjs`, bron "OpenKvK —
overheid.io registerupdates", in de dagelijkse detectierun (`openkvk`). Betaald
abonnement Small: 2.500 API-calls, 1.000 suggestions, 1.000 geo lookups,
paginering tot 10 pagina's, geen data-export. overheid.io vermeldt niet per
welke periode de calls gelden. Sleutel `OVERHEID_IO_KEY` in `scraper/.env`,
meegestuurd als header `ovio-api-key`.

- Endpoint `api.overheid.io/v3/openkvk` met `filters[bezoeklocatie.plaats]`
  (Amersfoort, Leusden) en `filters[updated_at]=<dag>`, `size=100`. Normaal
  één call per plaats per dag; op 22 september waren dat 36 + 4 records.
- Een volledige lokale baseline kan niet: Amersfoort heeft ruim 70.000 records
  en een zoekopdracht geeft hooguit 10 pagina's. Daarom een incrementele feed
  per `updated_at`-dag met een dagcursor, geen `runVersionedDataset`. Een gat
  wordt tot 7 dagen terug ingehaald; hooguit `OPENKVK_MAX_CALLS_PER_RUN` (12)
  calls per run.
- Sorteren werkt niet en er is geen inschrijfdatum. "Nieuw" betekent dus
  "voor het eerst gezien in de wijzigingen" en draagt die onzekerheid mee.
- Sleutel `openkvk:<kvk>:<vestigingsnummer|rp>`. Events: `KVK_REGISTRATION_ADDED`,
  `_CHANGED` (naam, adres, rechtsvorm) en `_DISSOLVED` (`actief` naar false).
  R9 maakt er alleen een signaal van bij een al elders bekende organisatie of
  een stichting, vereniging, coöperatie, NV of kerkgenootschap (geen VvE).
  Een nieuwe BV of eenmanszaak blijft graafcontext.
- Eenmanszaken, vof's, maatschappen en cv's krijgen geen entiteit tenzij het
  KVK-nummer al bekend is, omdat de naam vaak een persoonsnaam is.
- De eerste 14 dagen (vanaf 23 september 2026) alleen opslaan: dan is elk
  nummer nog onbekend. Een opheffing van een elders bekende organisatie telt
  wel direct.

## Contract voor nieuwe bronnen

Leg minimaal vast: eigenaar, officiële URL, bereik, lokale filter,
verversingsritme, stabiele sleutel, semantische velden, provenance,
baselinegedrag, verwijderingsbetekenis, foutisolatie, tests en bekende
beperkingen. Een parserwijziging mag zonder betekenisvolle bronwijziging geen
events veroorzaken.

Gebruik voor KG-bronnen waar passend de bronklassen
`AUTHORITATIVE_REGISTER`, `AUTHORITATIVE_EVENT`, `DECLARED_BY_ENTITY`,
`STRUCTURED_CONTEXT`, `MEASUREMENT` en `DISCOVERY_ONLY`. Een adapter doorloopt
conceptueel `discover → fetch → parse → normalize → diff → emit`; de actuele
implementatie staat in `scraper/src/kg/base-adapter.cjs`.

Provenance van een event of signaal bevat minimaal bron en bronklasse, bron- of
document-URL, stabiele bronidentifier, publicatie-/gebeurtenis-/ophaaltijd,
parser- of adapterversie, bewijsvelden of fragmenten en de methode en zekerheid
van een eventuele entiteitsmatch. Bewaar bij een relevant relatiepad ook hoe de
lokale relevantie tot stand kwam.

Grote exports en brononderzoek horen bij fixtures, rapporten of geschiedenis en
zijn nooit verplichte startcontext.

## Centraal Insolventieregister

Scraper `scraper/src/scrapers/insolventies.js`, filterregels in
`scraper/src/insolventies-lib.js`, dagelijks via `run-all.js`, bron 48. Leest
de openbare dagoverzichten (`/Services/BekendmakingenService/getAll/` en
`haalOp/{dag}`), dus ongeveer een maand terug. Alleen publicaties zonder
geboortedatum en woonadres, buiten de schuldsaneringsclusters en met een
vestigings- of correspondentieadres in Amersfoort, Leusden, Hoogland,
Hooglanderveen, Achterveld of Stoutenburg (of postcode 3810-3833). Eenmanszaken
vallen daarmee bewust af. De zoekservices van het CIR zijn beveiligd met
anti-CSRF; die gebruiken we niet.

## TenderNed-partijen

`scraper/src/tenderned-partijen.js` leest hoofdstuk 8 (Organisaties) van de
eForms-publicatie-PDF naar `tender_parties`: naam, registratienummer (meestal
KvK), adres, rollen, winnaar/koper en de waarde van de winnende inschrijving
(soms symbolisch, bijvoorbeeld 1 euro). `tenderned.js` doet dit dagelijks voor
gunningen. `scraper/src/backfill-tenderned-partijen.js` haalt gegunde opdrachten
(AGO) op via de API-parameter `search=` en is idempotent. De partijen komen niet
in `raw_items` en maken dus geen signalen.

## iBabs-bijlagen

`scraper/src/scrapers/ibabs-bijlagen.js` (wekelijks, maximaal 25 documenten per
run) haalt de categorielijsten op via `POST /Reports/GetReportData/{rapport}`
(Woo-verzoeken, Convenanten). De PDF's komen via `/Document/View/{documentId}`
binnen en worden in `raw_item_attachments` gezet en samengevoegd in
`raw_items.full_text`. Klachten (278 rijen) blijven bewust buiten beschouwing.
Scans zonder tekstlaag krijgen `geen_tekst`.
