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

## Actieve KG-adapters

De code onder `scraper/src/kg/adapters/` is gezaghebbend voor URL, parsing en
semantische diff. De orkestrator registreert momenteel onder meer:

- Nederlandse Arbeidsinspectie — Eerlijk werk;
- ernstige asbestovertredingen;
- Liander-storingen;
- Autoriteit Persoonsgegevens en ACM-publicaties;
- LRK-kinderopvang;
- DUO-schoolvestigingen, leerlingaantallen en BO-prognoses;
- een geparkeerde of beperkte tuchtrechtbron.

De klassieke bronlaag bevat daarnaast gemeentelijke bekendmakingen,
raadsinformatie, TenderNed, rechtspraak, subsidies, overheidsorganisaties,
regionale bronnen en detectiebronnen. De Onderwijsinspectiebron volgt actuele
toezichtresultaten exact voor Amersfoort en Leusden en gebruikt rapportnummer en
detail-URL als stabiele identiteit. Gebruik databasequeries of de
bronnenwacht voor de actuele lijst en opbrengst; kopieer aantallen niet naar dit
document.

## Contract voor nieuwe bronnen

Leg minimaal vast: eigenaar, officiële URL, bereik, lokale filter,
verversingsritme, stabiele sleutel, semantische velden, provenance,
baselinegedrag, verwijderingsbetekenis, foutisolatie, tests en bekende
beperkingen. Een parserwijziging mag zonder betekenisvolle bronwijziging geen
events veroorzaken.

Grote exports en brononderzoek horen bij fixtures, rapporten of geschiedenis en
zijn nooit verplichte startcontext.
