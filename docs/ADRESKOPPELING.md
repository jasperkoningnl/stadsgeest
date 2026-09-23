# Adreskoppeling via de BAG

**Doel:** documenten en registers koppelen op één sleutel: de BAG-nummeraanduiding.
**Status:** gezaghebbend; ingevoerd 2026-09-23. Draait dagelijks in `Stadsgeest Detection`.
**Lees wanneer:** bij werk aan adressen, `document_addresses`, `register_addresses` of kruisverbanden in de weger-werkset.

## Waarom

Registers en de dagelijkse stroom deelden geen sleutel. Koppelen op straatnaam
of afstand gaf valse verbanden (Darthuizerberg 98a tegenover 133, Langestraat
117 tegenover het monument op 121). De nummeraanduiding-id van de BAG
identificeert precies één adres, inclusief huisletter en toevoeging. Dezelfde
sleutel staat al in `locations.bag_id` voor de KG.

## Hoe het werkt

`scraper/src/kg/address-links.cjs` doet drie dingen:

1. **Adressen vinden** in tekst, alleen met huisnummer: `Straat 12a, 3811 AB`
   (postcode) of `Straat 12 te Amersfoort` (bekende plaatsnaam in Amersfoort of
   Leusden). Een postbus telt niet. Een straat zonder huisnummer ook niet.
2. **Exact opzoeken** bij de PDOK Locatieserver. Een treffer telt alleen als
   postcode en huisnummer (of straat, huisnummer en woonplaats) exact kloppen,
   en de letter of toevoeging ook. Staat er in de tekst geen letter en bestaan
   alleen 55A en 55B, dan is het `ambiguous`, geen gok. Bij straat plus plaats
   wint de langste straatnaam, zodat 'Korte Langestraat 143' niet op
   'Langestraat 143' landt. Adressen buiten Amersfoort en Leusden krijgen
   `outside_area`.
3. **Cachen** in `bag_lookup_cache`: één PDOK-aanvraag per unieke zoekvraag.
   Netwerkfouten worden niet gecachet; het item komt dan de volgende run terug.

`src/extract-addresses.cjs` doet dit voor `raw_items` (zelfde bronbereik als de
NER, dus geen sociale, community- of noodbronnen) en schrijft naar
`document_addresses` en `address_scans`. Een document met meer dan 50 adressen
is een lijst (de parkeerrestrictielijst telt er 2.378); die wordt alleen geteld
in `address_scans.found` en niet gekoppeld, omdat hij aan alles zou hangen.
`src/link-register-addresses.cjs` doet het voor de nieuwste versie van LRK
(kinderopvang), GLEIF (statutair adres en hoofdkantoor) en DUO
(schoolvestigingen) en schrijft naar `register_addresses`. Beide zijn
herhaalbaar zonder dubbelingen. `source_records` en de KG worden niet gewijzigd.

## In de weger-werkset

Per signaal staat onder `adres_koppelingen` elk exact adres dat elders
voorkomt: andere documenten op precies dat adres (tot vijf, met aantal), de
registers en de KG-organisaties via `locations`/`entity_locations`. Adressen
zonder treffer elders gaan niet mee. Een adres in meer dan 50 documenten
(gemeentehuis, standaardadres in bekendmakingen) krijgt geen documentlijst.

Een gedeeld adres is een aanwijzing, geen verband. Twee vergunningen op
hetzelfde adres kunnen over verschillende zaken gaan, en een bedrijfsverzamelgebouw
huisvest veel organisaties.

## Bediening

```powershell
cd scraper
node migrate-address-links.cjs                  # eenmalig, additief
node src/extract-addresses.cjs --dry-run         # alleen tellen, geen PDOK
node src/extract-addresses.cjs --limit 500       # nieuwste ongescande items
node src/link-register-addresses.cjs --only lrk  # één register
```

## Niet gedaan

- **Rijksmonumenten** hebben in `source_records` alleen coördinaten, geen adres.
  Koppelen op afstand is precies de fout die we willen vermijden. Nodig: het
  BAG-adres van het monument uit het monumentenregister van de RCE.
- **OSM, UIT-agenda, zorgverantwoording, asbest, NVWA** zijn nog niet
  gekoppeld. Asbest heeft alleen vrije tekst met landelijke adressen.
- **BAG-pand-id** ontbreekt: de gratis Locatieserver geeft verblijfsobject en
  nummeraanduiding, niet het pand. Voor 'zelfde gebouw, ander adres' is de BAG
  API (met sleutel) nodig.
- Adressen zonder postcode en zonder plaatsnaam ('Stadsring 55' los in een
  zin) worden niet gevonden.
