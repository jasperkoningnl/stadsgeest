# Fase 2 — eerste eventbronnen en graph matching

**Status:** afgerond; formele productie-audit geslaagd op 21 september 2026.

Alle genoemde eventbronnen zijn aanwezig en hebben een geslaagde productierun.
De vaste regels R1–R4 en R6–R9 bestaan ongewijzigd. Signalen bewaren bron,
event, bewijs en relatiepad in provenance; dit wordt ook in de bevroren
redactionele context en de tipuitleg meegenomen.

`audit-phase2.cjs` replayde de productiehistorie en vond 39 regelsignalen.
Daarvan zijn 37 uniek en graph-afhankelijk: ieder event heeft een gekoppelde
entiteit met een vestiging in Amersfoort of Leusden. De expliciete contraproef
met dezelfde events maar zonder graphcontext leverde nul R3-matches. Vijf
concrete voorbeelden met officiële identifier, bron-URL en relatiepad worden
door de audit afgedrukt; twee daarvan bevatten zelfs geen plaatsnaam in titel of
samenvatting.

Het graphcriterium is behaald met 37 historisch gereplayde graph-afhankelijke
signalen, ruim boven het minimum van vijf. Daarnaast zijn zes bestaande
vergunningrecords op exact postcode-huisnummer gekoppeld aan een bevestigde
BAG-locatie en de daar bekende organisatie. Een identieke herhaling maakte nul
events aan; alle zes vergunningevents hebben aantoonbaar een BAG-relatiepad.

**Afsluitvoorwaarde:** behaald; `audit-phase2.cjs` controleert zowel het
graphbewijs als de volledige BAG-dekking van de gekoppelde vergunningevents.
