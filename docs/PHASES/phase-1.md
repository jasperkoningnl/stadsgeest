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

De BAG-backfill is afgerond: 79 van 82 adresseerbare locaties kregen een exacte
BAG-match. De drie resterende gevallen zijn aantoonbaar niet eenduidig — een
huisnummerbereik, een niet-bestaand nummer en een basisnummer met meerdere
toevoegingen — en staan als beoordeelde uitzondering vast. De enige resterende
sluitblokkade is de handmatig gelabelde organisatie-golden-set: 0 van 200. Er
staan 223 naamvariant-versus-organisatieparen klaar onder Beheer > Controleren.
Alleen Jasper kan daar per kandidaat dezelfde organisatie, een andere
organisatie of “weet ik niet” vastleggen. De database bewaart actor, moment en een
uniek verzoek-ID; de slotaudit leest uitsluitend de ja/nee-beoordelingen.

**Afsluitvoorwaarde:** de lokale graph is zoekbaar en herleidbaar, en organisatie-
en vestigingsmatches voldoen aantoonbaar aan de golden set. Ieder niet-uitgevoerd
onderdeel heeft een vastgelegde zwaarwegende afwijkingsreden.
