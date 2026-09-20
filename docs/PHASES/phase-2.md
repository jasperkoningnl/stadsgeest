# Fase 2 — eerste eventbronnen en graph matching

**Status:** graph-exitbewijs geslaagd op 20 september 2026; formele sluiting
wacht op de vergunning-naar-BAG-koppeling uit fase 1.

Alle genoemde eventbronnen zijn aanwezig en hebben een geslaagde productierun.
De vaste regels R1–R4 en R6–R9 bestaan ongewijzigd. Signalen bewaren bron,
event, bewijs en relatiepad in provenance; dit wordt ook in de bevroren
redactionele context en de tipuitleg meegenomen.

`audit-phase2.cjs` replayde 258 productie-events en vond 39 regelsignalen.
Daarvan zijn 37 uniek en graph-afhankelijk: ieder event heeft een gekoppelde
entiteit met een vestiging in Amersfoort of Leusden. De expliciete contraproef
met dezelfde events maar zonder graphcontext leverde nul R3-matches. Vijf
concrete voorbeelden met officiële identifier, bron-URL en relatiepad worden
door de audit afgedrukt; twee daarvan bevatten zelfs geen plaatsnaam in titel of
samenvatting.

Het graphcriterium is behaald met 37 historisch gereplayde graph-afhankelijke
signalen, ruim boven het minimum van vijf. Het leidende plan vereist daarnaast
dat bestaande vergunningevents via BAG aan lokale entiteiten worden gekoppeld.
Omdat de BAG-backfill nog niet is uitgevoerd, blijft dat laatste onderdeel en
daarmee de formele fasesluiting open.
