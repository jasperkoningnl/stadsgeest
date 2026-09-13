# Roadmap Stadsgeest 2.0

**Doel:** compacte leeswijzer bij het volledige uitbreidingsplan.
**Status:** gezaghebbend voor volgorde en resterende scope.
**Lees wanneer:** bij planning, bronuitbreiding of afwijking van de fasering.

## Leidende bron

Het volledige `Stadsgeest_uitbreidingsplan_Claude.md` is leidend. Alles daarin
wordt uitgevoerd, tenzij een aantoonbare technische, juridische, redactionele
of broninhoudelijke reden afwijking noodzakelijk maakt. Leg zo'n afwijking met
reden en gevolg vast in `DECISIONS.md`; stilzwijgend schrappen mag niet.

De duurzame delen van het voormalige migratieplan zijn geïntegreerd in
`ARCHITECTURE.md`, `SOURCES.md`, `TESTING.md`, `PHASES/phase-0.md` en
`DECISIONS.md`. Bij verschil met oude details gelden actuele code, database en
de vastgelegde beslissing.

## Stand

- Fase 0 — inventarisatie en contracten: mijlpaal bereikt; slotaudit open.
- Fase 1 — entiteitenfundament: productiepad aanwezig; slotaudit open.
- Fase 2 — eerste eventbronnen en graph matching: productiepad actief;
  slotaudit open.
- Fase 3 — sectorregisters en statistiek: afgerond en productieactief; zie
  `PHASES/phase-3.md`.
- Fase 4 — periodieke en experimentele bronnen: afgerond en productieactief;
  Samen Meten blijft bewust achter een experimentele feature flag.
- Fase 5 — redactionele leerloop: eerstvolgende productfase, met vroege feedbackmeting
  waar dat al zinvol is.

Zie `PHASES/README.md` voor de status en afsluitvoorwaarde per fase.

## Werkwijze

`CURRENT.md` bevat alleen de actuele momentopname. Dit bestand geeft de compacte
route. Het volledige uitbreidingsplan bewaart alle eisen, bronkaarten,
detectieregels, testgevallen, acceptatiecriteria en Definition of Done per bron.

Nieuwe bronnen worden niet willekeurig toegevoegd: volg prioriteit en fasering
uit het uitbreidingsplan. Een bron mag alleen worden overgeslagen of geparkeerd
na een expliciet vastgelegde afwijkingsreden.
