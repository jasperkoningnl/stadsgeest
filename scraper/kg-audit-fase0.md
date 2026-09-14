# KG fase 0 — audit en baseline

**Meetmoment:** 14 september 2026, 14.13 uur Europe/Amsterdam

**Database:** actieve Turso-productiedatabase, alleen-lezen gemeten

**Script:** `meting-fase0.cjs` v2

## Status

De ANBI-, GLEIF- en OSM-adapters en hun offline schrijftests zijn technisch
geverifieerd, maar nog niet tegen productie gebaselined. De formele fase-0-audit
blijft open zolang de BAG-dekking van vergunningrecords niet betrouwbaar
meetbaar is. Onderstaande cijfers zijn een momentopname en geen live teller.

## Volumes

| Tabel | Rijen |
|---|---:|
| `kg_entities` | 582 |
| `entity_identifiers` | 757 |
| `kg_aliases` | 943 |
| `locations` | 84 |
| `entity_locations` | 194 |
| `kg_relations` | 146 |
| `kg_events` | 95 |
| `event_entities` | 78 |
| `source_records` | 75.680 |
| `fetch_runs` | 181 |
| `entity_merge_candidates` | 0 |

De 757 identifiers bestaan uit 505 websites en 252 KVK-nummers.

## BAG-dekking

Van de 84 KG-locaties hebben er 0 een `bag_id`: 0,0%. De specifiek gevraagde
BAG-dekking van vergunningrecords is nog niet meetbaar. Vergunningbronnen zijn
niet via `kg_events → event_entities → entity_locations → locations` aan deze
locaties gekoppeld. Het meetscript gebruikt daarom nadrukkelijk geen fallback op
ongerelateerde KG-locaties.

## Duplicaten

- Raw items met een URL: 8.835
- Unieke URL's: 8.629
- URL's die meer dan eenmaal voorkomen: 109
- Duplicate-URL-groepratio: 109 / 8.629 = 1,26%

Deze ratio telt dubbele URL-groepen ten opzichte van alle unieke URL's. Zij is
niet hetzelfde als het aandeel overtollige rijen of inhoudelijke duplicaten.

## Uitvoeringsfouten

Van de 181 geregistreerde `fetch_runs` hebben er 180 status `ok` en 1 status
`error`: 0,6% niet-succesvol. Dit is een operationele proxy; het huidige schema
onderscheidt parserfouten niet van andere adapter- of fetchfouten. Een zuivere
parser-failure-rate is daardoor nog niet afzonderlijk meetbaar.

## Nieuwe adapters

De productiedatabase bevat op het meetmoment nog geen bronregistratie of
`source_records` voor:

- ANBI-register — Belastingdienst open data;
- GLEIF — LEI-register;
- OpenStreetMap — Overpass contextlaag.

Er is dus nog geen productiebaseline voor deze drie bronnen vastgelegd. De code
registreert ANBI en GLEIF als `AUTHORITATIVE_REGISTER` en OSM als
`STRUCTURED_CONTEXT`.

## Geverifieerde codecontracten

- ANBI bevestigt een verdwijning pas na twee opeenvolgende afwezigheden en
  verwijdert de pending status daarna uit het volgende snapshot.
- De drie adapters schrijven volgens het actuele schema van `kg_events`,
  `entity_identifiers` en `kg_relations`.
- De schrijftests staan in `__tests__/integration/kg-writes.test.cjs` en zijn
  opgenomen in `npm run test:integration`.
- De gewone adaptersuites dekken parsing, lokale filtering, semantische diff en
  herhaalgedrag offline.

## Openstaand voor formele afsluiting

- Leg gecontroleerde productiebaselines voor ANBI, GLEIF en OSM vast, met nul
  historische events op de eerste run en een ongewijzigde tweede run.
- Bouw een betrouwbaar relatiepad voor vergunningrecords en meet daarna hun
  werkelijke BAG-dekking.
- Splits parserfouten van netwerk-, health- en overige uitvoeringsfouten als een
  afzonderlijke parser-failure-rate vereist blijft.
