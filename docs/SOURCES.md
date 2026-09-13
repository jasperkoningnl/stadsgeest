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
