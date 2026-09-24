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
(kinderopvang), GLEIF (statutair adres en hoofdkantoor), DUO
(schoolvestigingen), jaarverantwoording zorg (één adres per KvK), OSM
(objecten met naam, huisnummer en postcode), UIT-agenda (één rij per locatie,
niet per evenement) en asbestovertredingen (overtredingslocatie). Voor
**rijksmonumenten** haalt het script het BAG-adres live op bij de RCE
(SPARQL-endpoint van het monumentenregister, `heeftBAGRelatie`), omdat
`source_records` alleen coördinaten heeft. Alles gaat naar `register_addresses`.
Beide scripts zijn herhaalbaar zonder dubbelingen; de dagelijkse registerrun
laadt cache en bestaande rijen vooraf en schrijft alleen wat verandert.
`source_records` en de KG worden niet gewijzigd.

`src/link-bag-panden.cjs` zoekt voor elk exact gekoppeld verblijfsobject het
pand op via de PDOK BAG OGC API (geen sleutel nodig): verblijfsobject →
pand-link → pand-id, bouwjaar en aantal verblijfsobjecten. Resultaat in
`bag_vbo_pand` en `bag_pand_scan`.

## In de weger-werkset

Per signaal staat onder `adres_koppelingen` elk exact adres dat elders
voorkomt: andere documenten op precies dat adres (tot vijf, met aantal), de
registers en de KG-organisaties via `locations`/`entity_locations`. Adressen
zonder treffer elders gaan niet mee. Een adres in meer dan 50 documenten
(gemeentehuis, standaardadres in bekendmakingen) krijgt geen documentlijst.

Per adres staan ook het pand (bouwjaar, aantal verblijfsobjecten) en onder
`zelfde_pand_ander_adres` documenten en registers op een ánder adres in
hetzelfde pand, bijvoorbeeld een vergunning op 181A en het monument op 181B.
Dat gebeurt alleen bij panden met hoogstens 20 verblijfsobjecten; bij een flat
of kantoorverzamelgebouw zegt hetzelfde pand niets.

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
node src/link-bag-panden.cjs --limit 2000        # panden bij nieuwe verblijfsobjecten
```

## Niet gedaan

- **Monumenten zonder BAG-relatie** in het RCE-register (muren, bruggen,
  grenspalen) worden niet gekoppeld.
- Adressen zonder postcode en zonder plaatsnaam ('Stadsring 55' los in een
  zin) worden niet gevonden.
- Asbestovertredingen zijn vrijwel allemaal buiten Amersfoort en Leusden; ze
  krijgen `outside_area` en koppelen dan niet.
