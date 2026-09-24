# Organisatiekoppeling over bronnen heen

**Doel:** uitleg van de dagelijkse koppeling van organisaties tussen registers,
geld- en toezichtbronnen.
**Status:** gezaghebbend; in gebruik sinds 2026-09-24.
**Lees wanneer:** bij werk aan `koppel-organisaties.cjs`, de werkset-velden
`organisatie_verbanden` en `kruisbron_kandidaten`, of bij twijfel over een
gemeld verband.

## Wat het doet

`scraper/src/koppel-organisaties.cjs` zoekt welke organisatie in meer dan één
bron voorkomt. Dezelfde stichting die subsidie krijgt en een zwak
inspectieoordeel heeft, of een aannemer die een aanbesteding won en een
asbestovertreding op zijn naam heeft: dat zijn verbanden die een redacteur met
één bron niet ziet. De job schrijft niets in `entities`, `kg_*` of `signals`.

Keten, dagelijks na de adreskoppeling in `run-detection-task.ps1`:

1. `koppel/bronnen.cjs` laadt organisaties uit 18 bronnen (tabel hieronder).
2. `koppel/normaliseer.cjs` normaliseert naam (rechtsvorm, accenten en
   leestekens weg), KvK, postcode, huisnummer en plaats, en voegt per bron
   records met dezelfde naam samen.
3. `koppel/splink_worker.py` (Splink 4.0.17 met DuckDB, geen database of
   netwerk) geeft paren met een kans en de vergelijkingsniveaus per veld.
4. Node clustert: gelijke KvK, RSIN of LEI koppelt altijd; een Splink-paar
   alleen als de kans ≥ 0,6 is én de naam lijkt (zie regels). Twee
   verschillende KvK-nummers komen nooit in één cluster.
5. Wegschrijven: `org_link_records` (alle records van de laatste run, met
   `cluster_key`), `org_clusters` (clusters met ≥ 2 bronnen, met
   `first_seen_at`) en `org_link_runs` (logboek per run met invoerhash).

Dezelfde invoer levert dezelfde uitvoer. Bij een ongewijzigde invoerhash slaat
de run het rekenen over. Rekentijd ongeveer 2 seconden voor 6.900 records;
het laden uit Turso duurt het langst.

## Bronnen en rol

| Bron | Rol | Sleutels |
|---|---|---|
| subsidieregister (geen particulieren), RVO-projecten, TenderNed-winnaars | geld | KvK bij RVO en TenderNed |
| asbestovertredingen, CIR-insolventies | toezicht | KvK bij CIR |
| Arbeidsinspectie, NVWA, Onderwijsinspectie | toezicht bij overtreding, "voldoet niet" of oordeel onvoldoende/zeer zwak; anders register | — |
| ANBI, GLEIF, LRK (zonder gastouders), AFM, DNB, zorgverantwoording, governance, Seveso, OpenKvK (zonder eenmanszaken en vof's), KG-organisaties | register | RSIN, LEI, KvK |

Een KG-organisatie telt niet mee als bron in `n_bronnen`: de KG is grotendeels
afgeleid uit dezelfde registers.

## Regels boven de Splink-kans

Vastgesteld in de proef van 24-9 (`scraper/tmp/koppel-inspect.cjs`):

- De gewichten staan vast (naam exact m = 0,6; postcode 0,7; huisnummer 0,8;
  plaats 0,9). De EM-training van Splink leerde op deze dunne data onzinnige
  gewichten.
- Naam exact of Jaro-Winkler ≥ 0,97: koppelen, tenzij beide plaatsen bekend
  en verschillend zijn.
- Naam Jaro-Winkler ≥ 0,9: alleen met hetzelfde postcode en huisnummer.
- Anders nooit. Alleen een gedeeld adres gaf valse clusters van bedrijven in
  hetzelfde verzamelgebouw (Hoge Boom Beheer met Mobiliteitsfabriek).
- Ook de plaatsen van twee clusters moeten passen. Anders slaat een
  KG-entiteit zonder plaats een brug tussen De Baander in Amersfoort en De
  Baander in Elim.
- Woonkernen tellen als hun gemeente (Hoogland, Vathorst → Amersfoort;
  Achterveld, Stoutenburg → Leusden).

## Uitkomst eerste run (24-9)

9.903 ruwe records, 6.901 na samenvoegen, 2.839 paren, 6.238 clusters, 199
kruisclusters. Meest voorkomend: ANBI+GLEIF (52), ANBI+subsidie (41),
GLEIF+TenderNed (20). Een steekproef van 23 kruisclusters was geheel juist.
Maar 2 clusters combineren geld en toezicht, beide niet lokaal (Fletcher
Hotel, Wageningen Research). Van 297 signalen uit de laatste tien dagen kregen
er 7 een `organisatie_verbanden`-blok, 1 via een exact KvK-nummer.

## Werkset

`weger-workset.cjs` zoekt per signaal op KvK-nummer (uit de tekst en, bij
TenderNed, uit `tender_parties`) en op exacte genormaliseerde naam uit
`entities` en `document_mentions` (ook onopgeloste NER-organisaties: een
exacte registernaam filtert hun ruis). Namen korter dan 5 tekens en
overheidsnamen tellen niet. De eigen bron van het signaal telt niet als
verband. Zie `operations/WEGER.md` voor hoe de weger het leest.

## Beperkingen

- Een naamtreffer zonder sleutel is een aanwijzing, geen vaststelling.
- Moeder- en zustermaatschappijen met een eigen KvK-nummer worden niet
  samengevoegd. Een verband via een concern (Huisartsen Eemland HAP en Zorg)
  ziet de job dus niet.
- Personen zitten er niet in. Verrassende verbanden lopen vaak via
  bestuurders; die laag bestaat nog nauwelijks.
- De asbest- en TenderNed-bronnen bevatten veel niet-lokale bedrijven.

## Beheer

- Python: `scraper\.koppel-venv` (genegeerd door git), aangemaakt met
  `C:\Python314\python.exe -m venv scraper\.koppel-venv` en
  `scraper\.koppel-venv\Scripts\python.exe -m pip install -r scraper\src\koppel\requirements.txt`.
  Andere Python via `KOPPEL_PYTHON`.
- Handmatig: `node src/koppel-organisaties.cjs [--dry-run] [--force]` vanuit
  `scraper`.
- Tests: `__tests__/koppel/normaliseer.test.cjs` (zonder Python).
