# Documentlezer — grote stukken volledig lezen

**Doel:** van elk groot document een uittreksel met letterlijke citaten maken,
zodat de weger meer ziet dan de eerste 4.000 tekens.
**Status:** proef van 5 oktober 2026 (Claude); structureel werk is voor Codex.
Er is nog geen tabel en niets schrijft naar de database. Het opslagvoorstel
hieronder wacht op akkoord van Jasper.
**Lees wanneer:** bij werk aan de documentlezer of aan wat de weger van een
document te zien krijgt.

## Waarom

`weger-workset.cjs` geeft per document `full_text || content || summary`,
afgekapt op 4.000 tekens. Van een begroting, een Woo-bijlage of een raadsstuk
met bijlagen ziet de weger dus de kop. Bij B&W-stukken (bron 131) is het erger:
`full_text` bevat daar de paginatekst van de besluitenlijst en het stuk zelf
staat in `content`, dus de weger ziet het stuk helemaal niet.

## Begrippen

- **Leeseenheid:** de tekst die één lezer in één keer leest, hoogstens 200.000
  tekens. Sleutel `item-<raw_item_id>` of `bijlage-<attachment_id>`; een langere
  tekst wordt geknipt in `-d1`, `-d2`, enzovoort. Een deelitem
  (`raw_item_parts`) is een eigen `item-<id>`.
- **Leestekst:** bij een item de langste van `full_text` en `content`; bij een
  bijlage `raw_item_attachments.tekst`.
- **Leesversie:** dezelfde tekst met regels van hoogstens 1.000 tekens, zodat
  een lezer met regelnummers kan werken. De controle vergelijkt met de tekst uit
  de database, niet met de leesversie.
- **Uittreksel:** één JSON-bestand per leeseenheid, volgens
  `operations/documentlezer-leesinstructie.md`.

## Draaien

Alles leest de lokale kopie (`node scraper/src/lokale-kopie.cjs`, zie
`docs/DATABASE-LEZEN.md`). Geen van de scripts kan Turso bereiken of schrijven.
Werkmap: `scraper/tmp/documentlezer/` (buiten Git).

```powershell
# 1. Wat ligt er? Omvang, of de lijst met nog niet gelezen stukken.
node scraper/src/documentlezer-selectie.cjs --tel
node scraper/src/documentlezer-selectie.cjs --kandidaten --sinds 2026-10-05 --zonder-uittreksel scraper/tmp/documentlezer/uittreksels

# 2. Leesversies en manifest klaarzetten (sleutels met komma's, of @bestand).
node scraper/src/documentlezer-selectie.cjs --exporteer item-11943,bijlage-184

# 3. Lezen: per regel van teksten/manifest.json één lezer met een eigen, lege
#    context. Die krijgt de leesinstructie, het bestand, de sleutel, het aantal
#    regels en de titel, en schrijft uittreksels/<sleutel>.json.

# 4. Controleren. Code 1 bij een citaat dat niet letterlijk in de bron staat.
node scraper/src/documentlezer-controle.cjs
```

Regels voor stap 3:

- Eén leeseenheid per lezer. Een groot stuk in dezelfde context als andere
  stukken verdringt de rest.
- De lezer krijgt alleen leesgereedschap en mag zijn citaten niet zelf met een
  zoekopdracht of script nalopen; anders meet de controle niets meer.
- Faalt de controle, laat dan hetzelfde stuk één keer opnieuw lezen. Herstel
  een citaat nooit met de hand. Blijft het fout, dan vervalt dat feit.
- De leesinstructie is vast. Een gewijzigde tekst krijgt een nieuw
  versienummer; uittreksels van verschillende versies zijn niet vergelijkbaar.

De controle rapporteert per stuk: citaatfouten, vormfouten, hoeveel feiten niet
staan in wat de weger nu krijgt, en hoeveel voorbij teken 4.000 van het document
beginnen. Details per feit staan in `controle-rapport.json` in de werkmap.

## Wat niet in de repo komt

Uittreksels, leesversies en het controlerapport zijn verhaalvondsten of
brontekst. Ze blijven in `scraper/tmp/` of buiten de repo. Hier staan alleen
scripts, de leesinstructie en dit document.

## Voorstel voor opslag (niet uitgevoerd)

Eén nieuwe tabel, één rij per leeseenheid:

```sql
CREATE TABLE document_uittreksels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sleutel TEXT NOT NULL,              -- item-123, bijlage-45-d2
  raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),  -- het hoofditem
  bijlage_id INTEGER REFERENCES raw_item_attachments(id),
  deel_item_id INTEGER REFERENCES raw_items(id),          -- bij een deelitem
  begin_in_document INTEGER NOT NULL DEFAULT 0,
  tekens INTEGER NOT NULL,
  tekst_sha TEXT NOT NULL,            -- van de gelezen tekst
  instructie_versie TEXT NOT NULL,
  model TEXT NOT NULL,
  kern TEXT NOT NULL,
  oordeel TEXT NOT NULL CHECK (oordeel IN ('aanleiding','geen_aanleiding','twijfel')),
  waarom TEXT NOT NULL,
  feiten TEXT NOT NULL,               -- JSON: soort, zin, citaat, plek, positie
  feiten_buiten_weger INTEGER NOT NULL,
  gecontroleerd_at TEXT NOT NULL,     -- alleen rijen zonder citaatfout
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (sleutel, tekst_sha, instructie_versie)
);
CREATE INDEX idx_document_uittreksels_item ON document_uittreksels(raw_item_id);
```

Keuzes die Jasper moet zien:

1. **Feiten als JSON in de rij, geen aparte feitentabel.** De weger leest per
   signaal en heeft de feiten bij elkaar nodig. Een aparte tabel
   `document_feiten` is pas nodig als partijen uit uittreksels aan de
   kennisgraaf gekoppeld moeten worden; dat kan later uit de JSON worden gevuld.
2. **`raw_item_id` is altijd het hoofditem.** De weger komt via `signal_items`
   bij het hoofditem; bijlagen en deelitems hangen daar niet aan. Zo vindt één
   geïndexeerde zoekvraag alle uittreksels van een signaal.
3. **`tekst_sha` bepaalt of een stuk opnieuw gelezen wordt.** Krijgt een stuk
   later meer tekst (OCR, herkansing), dan verandert de hash en volgt een nieuwe
   rij; de oude blijft staan.
4. **Alleen gecontroleerde uittreksels worden geschreven.** Het schrijfscript
   draait de controle zelf en weigert bij een citaatfout.

Hoe de weger het te lezen krijgt:

- `weger-workset.cjs` zet per item een veld `uittreksel` in de werkset: kern,
  oordeel met reden, en de acht zwaarste feiten met citaat en plek. Dat is
  hooguit 3.000 tekens per groot stuk, naast de bestaande 4.000 tekens.
- Bovenaan de werkset een lijst `lees_kandidaten`: uittreksels met oordeel
  `aanleiding` van stukken zonder signaal, zoals `woo_kandidaten` nu.
- Een nieuw uittreksel bij een al gewogen signaal biedt het signaal opnieuw aan
  via `heraanbieden.mjs`, alleen bij oordeel `aanleiding` of `twijfel`.
- In `operations/WEGER.md` komt de regel dat een uittreksel een aanwijzing is:
  de weger opent de bron op de genoemde plek voordat hij iets claimt, en toetst
  zelf of het feit afwijkt van wat pers en raad al hadden.

Verbruik: per signaalitem één `SEARCH ... USING INDEX`, per leesbeurt één rij
schrijven. Het aanmaken van tabel en index leest geen bestaande tabel.

## Bekende grenzen

- 'Volledig' betekent: alles wat in de database staat. Gesplitste B&W-stukken
  zijn afgekapt op 50.000 tekens, Notubiz-stukken van bron 168 op 200.000, en
  sommige pdf's op een paginagrens.
- De controle bewijst dat een citaat in de bron staat, niet dat de zin erbij het
  citaat goed weergeeft en niet dat de lezer niets heeft gemist.
- De vergelijking met de weger gaat op het citaat. Een feit kan in andere
  woorden ook in de eerste 4.000 tekens staan.
- De lezer kent de eerdere berichtgeving niet. De soort `afwijking` legt alleen
  vast wat het document zelf als afwijking laat zien.
