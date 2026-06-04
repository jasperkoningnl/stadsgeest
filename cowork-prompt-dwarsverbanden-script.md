# Cowork-opdracht: Dwarsverbanden-script bouwen

## Wat dit script doet

Een Node.js script dat na de intake-routine en vóór de analist/speurder draait. Het doorzoekt de entiteitentabel op co-occurrences: dezelfde persoon, organisatie of locatie die opduikt in signalen uit verschillende bronklassen. Het schrijft een korte briefing naar het `crossref_briefing` veld van relevante signalen, zodat de analist die informatie direct beschikbaar heeft zonder zelf queries te doen.

Dit kost **nul tokens** — het is pure database-logica. De analist krijgt het kant-en-klaar.

## Vereisten vooraf

Dit script heeft nodig:
- De `entity_signals` koppeltabel (aangemaakt in de bronladder-opdracht)
- De `entity_type` kolom in de `entities` tabel
- De `tier` kolom in de `sources` tabel
- De `category` kolom in de `sources` tabel (als die er niet is: voeg toe en vul)

Check of de sources tabel een `category` kolom heeft. Zo niet:

```sql
ALTER TABLE sources ADD COLUMN category TEXT DEFAULT 'other';
```

Vul de categorieën:

```sql
UPDATE sources SET category = 'emergency' WHERE source_id IN ('112nu-amersfoort', 'politie-amersfoort', 'vru');
UPDATE sources SET category = 'local_news' WHERE source_id IN ('de-stad-amersfoort', 'nieuwsplein33', 'rtvutrecht', 'nos-amersfoort', 'eemland1', 'amersfoort-nieuws', 'ftm-amersfoort');
UPDATE sources SET category = 'government' WHERE source_id IN ('gemeente-amersfoort', 'officielebekendmakingen', 'raadsinformatie', 'bw-besluiten', 'ibabs-woo', 'rijksoverheid');
UPDATE sources SET category = 'registry' WHERE source_id IN ('rechtspraak', 'tenderned', 'subsidieregister', 'bedrijven-amersfoort', 'igj-nvwa', 'odu', 'pdok-bag');
UPDATE sources SET category = 'data' WHERE source_id IN ('cbs-statline', 'amersfoort-cijfers', 'financien-amersfoort', 'uwv-amersfoort', 'waterschap');
UPDATE sources SET category = 'social' WHERE source_id IN ('reddit-amersfoort', 'nextdoor', 'bluesky');
UPDATE sources SET category = 'institutional' WHERE source_id IN ('meander', 'alliantie', 'omthuis', 'prorail', 'ns-verstoringen', 'regio-amersfoort', 'archiefeemland', 'erfgoed-natuur', 'onderwijs-cultuur', 'org-rss');
```

Pas de source_ids aan als ze in de database net iets anders heten. Nieuwe bronnen uit de bronladder-opdracht krijgen dezelfde categorisering bij registratie.

## Het script

Maak het bestand aan als `~/stadsgeest/scripts/dwarsverbanden.js` (of een pad dat past bij de bestaande scriptsstructuur).

### Logica

```
VOOR ELK signaal met status 'new' OF 'watching' dat nog geen dwarsverband-check heeft gehad:

  1. Haal alle entiteiten op die aan dit signaal gekoppeld zijn (via entity_signals)
  
  2. Voor elke entiteit:
     a. Zoek andere signalen waar dezelfde entiteit in voorkomt
     b. Filter: alleen signalen van de afgelopen 90 dagen
     c. Filter: alleen signalen uit een ANDERE bronklasse (category) dan het huidige signaal
     d. Filter: sluit het huidige signaal zelf uit
  
  3. Als er matches zijn:
     a. Groepeer de matches per entiteit
     b. Bouw een dwarsverband-briefing tekst
     c. Bereken een dwarsverband-score
     d. Schrijf de briefing naar het crossref_briefing-veld (overschrijven, niet appenden)
     e. Markeer het signaal als gecheckt (zodat het niet elke run opnieuw wordt geanalyseerd)
```

### SQL-queries

**Query 1 — Signalen die gecheckt moeten worden:**

```sql
SELECT s.id, s.title, s.status, s.summary, s.source_id, src.category as source_category
FROM signals s
LEFT JOIN sources src ON s.source_id = src.source_id
WHERE s.status IN ('new', 'watching')
AND (s.crossref_checked IS NULL OR s.crossref_checked = 0)
ORDER BY s.created_at DESC
LIMIT 100;
```

Hiervoor zijn nieuwe kolommen nodig:

```sql
ALTER TABLE signals ADD COLUMN crossref_checked INTEGER DEFAULT 0;
ALTER TABLE signals ADD COLUMN crossref_score INTEGER DEFAULT 0;
ALTER TABLE signals ADD COLUMN crossref_briefing TEXT;
```

**Query 2 — Entiteiten van een signaal:**

```sql
SELECT e.id, e.name, e.entity_type
FROM entity_signals es
JOIN entities e ON es.entity_id = e.id
WHERE es.signal_id = ?;
```

**Query 3 — Dwarsverbanden zoeken per entiteit:**

```sql
SELECT 
  s.id as signal_id,
  s.title as signal_title,
  s.status,
  s.created_at,
  src.source_id,
  src.category,
  src.tier,
  es.role
FROM entity_signals es
JOIN signals s ON es.signal_id = s.id
JOIN sources src ON s.source_id = src.source_id
WHERE es.entity_id = ?
AND es.signal_id != ?
AND s.created_at > datetime('now', '-90 days')
AND src.category != ?
ORDER BY s.created_at DESC
LIMIT 10;
```

De drie parameters zijn: entity_id, het huidige signal_id (uitsluiten), en de category van het huidige signaal (alleen andere categorieën).

### Scoring

Per signaal, bereken de dwarsverband-score:

| Conditie | Score |
|---|---|
| Entiteit komt voor in signaal uit andere categorie | +2 per uniek signaal |
| Match is uit tier 1 bron | +1 extra per match |
| Entiteit is van type 'organization' of 'person' (sterker dan 'location') | +1 extra |
| Meer dan 3 categorieën betrokken | +3 bonus |
| Match bevat financieel bedrag (entity_type = 'amount') in hetzelfde signaal | +2 |

> **Let op:** de `entity_type = 'amount'` regel scoort alleen als de entity extraction ook daadwerkelijk dit type produceert. Controleer of de huidige extraction dat doet. Als dat nog niet het geval is, is dit een dode letter totdat de extraction wordt uitgebreid.

Maximumscore: onbegrensd, maar in de praktijk zal 5-15 gebruikelijk zijn.

### Briefing-formaat

Schrijf de dwarsverband-briefing naar het `crossref_briefing` veld. Formaat:

```
DWARSVERBANDEN (automatisch gegenereerd):

• [Organisatie X] komt ook voor in:
  - "[Titel signaal Y]" (bron: TenderNed, government, 3 weken geleden)
  - "[Titel signaal Z]" (bron: Rechtspraak, registry, 2 maanden geleden)

• [Locatie Schothorst] komt ook voor in:
  - "[Titel signaal W]" (bron: CBS, data, 1 maand geleden)

Dwarsverband-score: 8
```

De analist-prompt leest zowel `summary` als `crossref_briefing` — ze staan los van elkaar.

### Update naar de database

```sql
UPDATE signals 
SET crossref_briefing = ?,
    crossref_checked = 1,
    crossref_score = ?
WHERE id = ?;
```

De eerste parameter is de briefing-tekst, de tweede de score, de derde het signal_id.

Door het `crossref_briefing` veld te overschrijven (niet te appenden) is het script **idempotent**: je kunt het altijd veilig opnieuw draaien na een handmatige reset van `crossref_checked`, zonder dat er dubbele briefings ontstaan.

### Geen matches

Als een signaal geen dwarsverbanden heeft: zet `crossref_checked = 1` en `crossref_score = 0`. Schrijf niets naar het `crossref_briefing` veld (laat NULL staan).

### Error handling

- Als de entity_signals tabel leeg is (nog geen entiteiten gekoppeld): log een waarschuwing en stop gracefully.
- Als een signaal geen entiteiten heeft: sla over, markeer als gecheckt.
- Gebruik try/catch rond elke signaal-verwerking zodat een fout bij één signaal de rest niet blokkeert.

## PM2-inscheduling

Voeg het script toe als **twee losse PM2-entries** — consistent met hoe de andere jobs zijn opgezet:

```javascript
{
  name: 'dwarsverbanden-nacht',
  script: './scripts/dwarsverbanden.js',
  cron_restart: '45 0 * * *',   // 00:45 — na intake (00:10), vóór speurder (01:01)
  autorestart: false,
  watch: false
},
{
  name: 'dwarsverbanden-middag',
  script: './scripts/dwarsverbanden.js',
  cron_restart: '50 11 * * 1-5', // 11:50 — na intake (11:36), vóór analist (12:02)
  autorestart: false,
  watch: false
}
```

Voeg beide entries toe aan `ecosystem.config.cjs`, daarna `pm2 save`.

> **Timing nacht:** 00:45 in plaats van 00:40 — geeft intake wat meer marge als er veel items zijn.

## Toekomstbestendigheid

Dit script is bewust simpel: SQL queries en string-formatting. Maar de datastructuur is voorbereid op uitbreiding:

**Voor embeddings (over ~1 maand):**
- Voeg een `embedding` kolom toe aan de entities tabel (BLOB of TEXT met JSON-array)
- Het dwarsverbanden-script kan dan naast exacte naam-matching ook cosine similarity berekenen
- Drempel: similarity > 0.85 telt als match

**Voor een graph (optioneel):**
- De entity_signals tabel IS al een edge list (entiteit → signaal)
- Voeg een `entity_relations` tabel toe voor directe entiteit-entiteit relaties:

```sql
CREATE TABLE entity_relations (
  entity_a INTEGER,
  entity_b INTEGER,
  relation_type TEXT, -- 'same_signal', 'same_address', 'subsidiary', 'board_member'
  strength REAL DEFAULT 1.0,
  first_seen DATETIME,
  last_seen DATETIME,
  UNIQUE(entity_a, entity_b, relation_type)
);
```

- Het dwarsverbanden-script kan deze tabel vullen als bijproduct: twee entiteiten die in hetzelfde signaal voorkomen, krijgen een 'same_signal' relatie met oplopende strength.

**Bouw die uitbreidingen nu nog niet.** Maar houd er rekening mee bij de keuze van variabelenamen en datastructuren, zodat het later een incrementele toevoeging is.

## Test na oplevering

1. Draai het script handmatig: `node scripts/dwarsverbanden.js`
2. Check of signalen met dwarsverbanden een briefing hebben: `SELECT id, title, crossref_score, crossref_briefing FROM signals WHERE crossref_score > 0 LIMIT 5;`
3. Check dat signalen zonder matches wel gecheckt zijn: `SELECT COUNT(*) FROM signals WHERE crossref_checked = 1 AND crossref_score = 0;`
4. Draai het een tweede keer: het zou geen signalen opnieuw moeten verwerken (allemaal al `crossref_checked = 1`).
5. Reset handmatig één signaal (`UPDATE signals SET crossref_checked = 0 WHERE id = X`) en draai opnieuw — verifieer dat de briefing wordt overschreven, niet gedupliceerd.
6. Als alles werkt: verifieer de PM2-scheduling voor nacht en middag.

Update STATUS.md met de toevoeging van het dwarsverbanden-script.
