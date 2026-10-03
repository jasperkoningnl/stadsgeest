# Lokale adresscan voor de automatische weger

De dagelijkse Codex-weger verstuurt zelf geen adressen naar PDOK. De Windows-
detectietaak draait eerst `extract-addresses.cjs`, vult daarmee de BAG-cache en
maakt daarna met `prepare-weger-address-scan.cjs` een lokaal scanbestand.

Lees in de automatische run het nieuwste bestand:

`C:\Users\Jasper Koning\.codex\automations\stadsgeest-weger\verband-scan-prepared-*.json`

Controleer vóór gebruik:

- `generated_at` hoort bij de laatste detectierun;
- `mode` is `precomputed-local`;
- `external_address_requests` is `0`;
- ieder signaal uit de werkset staat in `signals`.

Het bestand bevat per actueel signaal alle exact gekoppelde BAG-adressen,
eerdere documenten, registers, KG-organisaties, hetzelfde pand en monumenten
binnen tien meter. Gebruik daarnaast `adres_koppelingen` uit de werkset.
`onopgeloste_adressen` zijn koppelgaten en mogen niet als exacte adressen worden
behandeld.

Roep tijdens de automatische run `weger-adres.cjs` of een andere PDOK-helper
niet aan. Alleen bij expliciet handmatig onderzoek mag dat hulpmiddel worden
gebruikt. De inhoudelijke bronregels van `operations/WEGER.md` blijven gelden.
