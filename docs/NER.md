# NER-documentvermeldingen (spoor 1)

**Doel:** vastleggen hoe de spaCy-extractie werkt, wat ze wel en niet mag, en hoe goed ze is.
**Status:** gezaghebbend; ingevoerd 2026-09-23. Draait dagelijks in `Stadsgeest Detection`.
**Lees wanneer:** bij werk aan `extract-ner.cjs`, `document_mentions`, de weger-werkset of entiteitskwaliteit.

## Wat het doet

`scraper/src/extract-ner.cjs` stuurt de analysetekst van `raw_items`
(title + summary + content + full_text, dezelfde samenstelling als
`extract-entities.cjs`) naar `scraper/src/ner/spacy_worker.py`. De worker draait
spaCy `nl_core_news_lg`, filtert ruis en geeft per document één regel per
(type, genormaliseerde naam) terug. De runner zoekt die naam exact op in
`kg_entities.canonical_name` en `kg_aliases` (na `merged_into_id`) en schrijft
naar `document_mentions` en `ner_scans`.

De worker heeft geen databasetoegang en geen netwerk. Alle I/O zit in de runner.

## Harde grenzen

- Maakt geen `kg_entities`, schrijft niet naar `entity_identifiers` of
  `kg_aliases` en voert geen merges uit.
- Een KG-koppeling is een **kandidaat** (`candidate`) op exacte naam of alias,
  nooit een bevestiging. `ambiguous` betekent meerdere KG-treffers; de ids staan
  in `resolution_detail`. Alleen een mens zet `confirmed` of `rejected`.
- **Personen** worden alleen opgeslagen als de naam al in de KG staat. Onbekende
  personen (burgers, ambtenaren, advocaten, partijen in een zaak) worden geteld
  in `ner_scans.dropped_json` onder `persoon_niet_in_kg`, maar niet bewaard.
- **Bronbereik:** alleen bronnen met categorie `government`, `registry`, `data`
  en `local_news`. Geen `social`, `community`, `emergency` of `national_news`:
  daar staan namen van burgers in en de ruis is hoog (dry-run 23-9: Nextdoor
  leverde o.a. 'Donald Duck' en 'Alvast bedankt!' als persoon).
- De weger krijgt alleen KG-kandidaten, niet de onopgeloste vermeldingen.

## Tabellen

`migrate-document-mentions.cjs` is additief (`CREATE ... IF NOT EXISTS`).

`document_mentions`: één rij per item × extractor × modelversie × type ×
genormaliseerde naam (`UNIQUE`). Velden: `mention_text`, `normalized_text`,
`model_label` (ruwe spaCy-label), eerste `span_start`/`span_end`,
`occurrences`, `context_snippet`, `extractor`, `model_version`,
`confidence` (NULL: spaCy's NER geeft geen score), `alias_overlap` (1 als
`entities` voor hetzelfde item dezelfde type+naam al heeft),
`resolution_status`, `resolved_entity_id`, `resolution_method`,
`resolution_detail`, `reviewed_by`, `reviewed_at`, `review_note`.

`ner_scans`: één rij per gescand item × extractor × modelversie met teksthash,
lengte, afkapping (worker kapt op 50.000 tekens), ruwe en bewaarde aantallen en
de filterredenen als JSON. Items met nul vermeldingen staan hier ook, zodat ze
niet opnieuw worden gescand.

## Idempotentie en herverwerking

Een item dat ooit door extractor `spacy` is gescand, wordt niet opnieuw
geselecteerd. `INSERT OR IGNORE` op beide tabellen: een tweede run op dezelfde
items schrijft 0 rijen (gecontroleerd 23-9 op 50 items). Menselijke
reviewvelden worden daardoor nooit overschreven.

Een nieuwe filter- of modelversie wordt **niet** automatisch op oude items
toegepast. Herverwerken gaat expliciet met `--ids`. Oude en nieuwe versies
kunnen dan naast elkaar bestaan; filter bij gebruik op `model_version`.

## Bediening

```powershell
cd scraper
node migrate-document-mentions.cjs                    # eenmalig, additief
node src/extract-ner.cjs --dry-run --limit 300        # alleen lezen, rapport in tmp/
node src/extract-ner.cjs --limit 500                  # nieuwste ongescande items
node src/extract-ner.cjs --limit 3000 --before-id N   # backfill ouder dan id N
node src/extract-ner.cjs --ids 9550,9551              # expliciet (ook buiten bronbereik)
```

Python staat in een aparte venv `scraper\.ner-venv` (genegeerd door git;
Python 3.14, spaCy 3.8.16, `nl_core_news_lg` 3.8.0, ca. 600 MB). Overschrijven
kan met `NER_PYTHON`. `scraper/node_modules` is niet aangeraakt.

Zet de venv niet in `%LOCALAPPDATA%`. Vanuit de Claude-desktopapp belandt die
map in de gevirtualiseerde pakketmap `AppData\Local\Packages\Claude_...\LocalCache`,
die de Taakplanner niet ziet (23-9: ENOENT in de geplande taak). Opnieuw
opbouwen:

```powershell
py -3.14 -m venv scraper\.ner-venv
scraper\.ner-venv\Scripts\python.exe -m pip install spacy==3.8.16
scraper\.ner-venv\Scripts\python.exe -m spacy download nl_core_news_lg
```

## Planning

De stap draait in de dagelijkse taak `Stadsgeest Detection` (06.15 uur), na
detectie, evaluatie en retentie: `extract-ner.cjs --limit 500`, nieuwste
ongescande items eerst. Daarna gaat hij vanzelf verder met oudere items tot het
bronbereik helemaal is gescand. Een NER-fout maakt de taakuitkomst 1, maar
houdt de andere stappen niet tegen.

Snelheid op de notebook: 3.000 items in 372 s NER (Python-proces ca. 1 GB
geheugen) plus ca. 7 minuten wegschrijven, één databasebatch per item.

## Stand na eerste backfill (23-9)

3.050 items gescand (ids 5187-9627, alleen bronbereik), 10.912 vermeldingen
over 2.069 items: 5.293 locaties en 4.604 organisaties zonder KG-koppeling,
261 organisaties en 753 personen als KG-kandidaat, 1 ambigu. 1.349 onbekende
persoonsvermeldingen zijn geteld en niet opgeslagen. `kg_entities` (589),
`entity_identifiers` (767) en `kg_aliases` (968) zijn ongewijzigd. Nul dubbelen,
nul vermeldingen zonder scanregel. Oudere items (id < 5187) zijn niet gescand.

In de weger-werkset: 130 open signalen hebben een KG-kandidaat; na aftrek van
wat de aliasextractie al vond houden 83 van de 156 meest recente
kandidaatsignalen iets over. Veel daarvan zijn bedrijven uit de KVK-laag in
bekendmakingen ('Simon Loos Transport B.V.', 'Carlo Food V.O.F.') en 'VRU' →
Veiligheidsregio Utrecht. Bij NS-storingen komt steeds 'NS' mee; dat is ruis.

## Gemeten kwaliteit (23-9, door Claude beoordeeld, niet door de redactie)

Het filter is afgesteld op drie steekproeven uit de 400 nieuwste items en daarna
gevalideerd op een aparte set van 300 oudere items (id < 8000, veel
B&W-besluitenlijsten). Precisie = aandeel bewaarde vermeldingen dat een echte
entiteit van het juiste type is.

| Type | Afstelset (filter-5, n=50) | Validatieset (filter-6, n=40) |
|---|---:|---:|
| Persoon (alleen KG-kandidaten) | 15/16 juist gekoppeld | 40/40 |
| Organisatie | 29/50 (58%) | 10/40 (25%) |
| Locatie | 42/50 (84%) | 26/40 (65%) |

Lees dit zo:

- **Personen zijn de winst.** Vooral afgekorte portefeuillehouders in
  B&W-besluitenlijsten ('Portefeuillehouder T. Bijlholt', 'J. van Lammeren')
  die de aliasextractie mist. In de validatieset waren 93 van de 140
  KG-kandidaten niet al door de aliasextractie gevonden.
- **Homoniemen blijven een risico.** 'M. de Jong' (gemachtigde in een
  rechtszaak) werd aan een KG-persoon gekoppeld; waarschijnlijk onjuist.
- **Organisaties zijn zwak** op B&W-tekst: programma's, regelingen, afkortingen
  en kopjes ('GROP', 'POET', 'Raad Commissie'). Filter-7 vangt een deel daarvan
  (zie de hermeting hieronder).
- **Locaties** zijn bruikbaar maar vaak triviaal (straatnamen uit
  vergunningen, lijsten uit bijlagen).
- Verkeerd gelabelde persoonsnamen kunnen als organisatie of locatie
  doorlekken ('Yokuş', 'Aboyaakoub'). Dat is een reden om onopgeloste
  vermeldingen niet aan de weger of het dashboard te tonen zonder review.

Hermeting filter-7 (24-9, 250 willekeurige items uit het hele bronbereik, n=40
per type): organisaties 19/40 (48%), locaties 27/40 (68%). Het filter helpt
nauwelijks meer; de ruis zit in afkortingen van wetten en programma's
('UAVG', 'WPO', 'BBV') en in kopjes. Onopgeloste organisaties blijven daarom
buiten de weger. Verder filteren levert weinig op; een bruikbare
organisatielaag komt eerder uit registers (zie de Splink-proef) dan uit NER.

## Handmatige controle

In het dashboard: **Beheer > Controleren > Namen in documenten** (alleen
Jasper, zelfde opzet als de fase-1-controle). Per kaart staan de naam zoals in
het document, de gekoppelde KG-entiteit, het tekstfragment met de naam
gemarkeerd en een link naar de bron. Ja zet de vermelding op `confirmed`, nee op
`rejected`; weet-ik-niet wordt alleen vastgelegd. Elk oordeel komt in
`document_mention_reviews` (idempotent via `request_id`). De wachtrij toont één
vermelding per (KG-entiteit, vorm) in een vaste, gespreide volgorde; een vorm
die al beoordeeld is komt niet terug. Het oordeel geldt alleen voor die
vermelding, niet voor alle vermeldingen met dezelfde naam (naamgenoten). Doel
voor een eerste precisiecijfer: 60 oordelen.

Alternatief zonder dashboard: `src/ner-review.cjs export --n 60 --out pad.csv` maakt een steekproef van
KG-kandidaten (half personen, half organisaties, één per vorm) voor Excel.
Vul `oordeel` met ja of nee. `src/ner-review.cjs import pad.csv` telt en geeft
de precisie; met `--apply` worden ja/nee `confirmed`/`rejected` (alleen rijen
die nog niet beoordeeld zijn). Afgewezen vermeldingen gaan niet meer naar de
weger. De eerste steekproef staat in
`Stadsgeest-documentatie\ner-steekproef-2026-09-24.csv`.

## Bewaking

`stilte-alarm.mjs` meldt als `ner_scans` of `address_scans` langer dan 48 uur
geen nieuwe scan heeft (`ALARM_UREN_SCANS`).

## Open

1. `ambiguous`-vermeldingen staan nog niet in de controle; die vragen een
   keuze tussen meerdere KG-entiteiten.
2. Geen koppeling aan `entity_signals`; de weger leest via `signal_items`.
3. Een kandidaat die de bron zelf is ('NS' bij NS-storingen) wordt in de
   werkset weggelaten; in `document_mentions` blijft hij staan.
