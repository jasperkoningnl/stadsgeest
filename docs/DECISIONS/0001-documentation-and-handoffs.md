# 0001 — Actuele context scheiden van geschiedenis

**Status:** geaccepteerd op 12 september 2026.

## Besluit

De Git-repository bevat de gezaghebbende actieve documentatie. `AGENTS.md`,
`docs/INDEX.md` en `docs/CURRENT.md` vormen het standaard startpakket.
Technische overdrachten worden per maand opgeslagen; de oude monolithische
`STATUS.md` is een onveranderde historische momentopname. Claude-specifieke
instructies zijn niet meer actief.

## Reden

De oude status telde 88.594 woorden en mengde actuele toestand, oude plannen,
dagelijkse runs en instructies. Dat maakte nieuwe taken duur, foutgevoelig en
strijdig met latere documentatie.

## Gevolgen

- Actuele status wordt herschreven, niet aangevuld.
- Geschiedenis wordt alleen gericht gelezen.
- Dagelijkse operationele resultaten worden niet standaard in Git gedupliceerd.
- Elke duurzame waarheid heeft één gezaghebbende locatie.
- Een overdracht bevat uitsluitend resultaat, verificatie, risico's en volgende
  stap.
