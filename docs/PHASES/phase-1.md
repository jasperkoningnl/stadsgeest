# Fase 1 — entiteitenfundament

**Status:** het productiepad bestaat; formele slotaudit blijft open.

De entiteiten-, identifier-, alias-, locatie- en relatielaag, resolver en
provenance zijn operationeel. Toets nog expliciet ieder fase-1-onderdeel uit het
leidende uitbreidingsplan, waaronder BAG/geofiltering, ANBI, GLEIF, OSM,
handmatige lokale seeds, merge/review/unmerge en de golden set.

ANBI, GLEIF en OSM hebben op 20 september een geslaagde productienulmeting en
identieke herhaalrun doorlopen. Dit sluit die bronadapters operationeel af, maar
is nog geen vervanging voor de resterende golden-set- en graphaudit.

De handmatige kernseed bevat nu onder meer DierenPark Amersfoort, Flint, FLUOR,
De Lieve Vrouw, Spoffin en Dias Latinos. Iedere seed heeft een echte bron-URL,
reden, seeddatum en herzieningsdatum. Mergebesluiten zijn transactioneel,
geaudit en via `manage-entity-merge.cjs` terug te draaien; de offline proef
herstelt aliassen, identifiers, locaties, relaties en eventkoppelingen.

`audit-phase1.cjs` noemt nog precies twee sluitblokkades: geen van de 82
adresseerbare locaties heeft al een BAG-nummer en de handmatig gelabelde
organisatie-golden-set bevat nog 0 van de vereiste 200 gevallen. Er staan 250
brononderbouwde kandidaten klaar via `export-phase1-golden-candidates.cjs`.
De BAG-backfill is gebouwd en weigert niet-exacte postcode-, huisnummer- of
gemeentematches, maar mag pas na expliciete toestemming de adressen bij PDOK
opvragen.

**Afsluitvoorwaarde:** de lokale graph is zoekbaar en herleidbaar, en organisatie-
en vestigingsmatches voldoen aantoonbaar aan de golden set. Ieder niet-uitgevoerd
onderdeel heeft een vastgelegde zwaarwegende afwijkingsreden.
