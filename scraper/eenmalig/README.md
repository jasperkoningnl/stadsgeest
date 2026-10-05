# Eenmalige scripts

Inhaalslagen, migraties met een datum in de naam, opruimacties en losse
controlescripts die hun werk hebben gedaan. Ze staan hier als naslag: wat er is
gedraaid en hoe. Niets in de keten, de tests of de geplande taken roept ze aan.

- Draai een script hier niet opnieuw zonder het eerst te lezen. De meeste zijn
  op de database van hun datum geschreven en schrijven bij `--apply` echt weg.
- De paden zijn aangepast aan deze map (`../src/`, `../.env`, `../tmp/`). De
  syntax en de imports zijn op 5 oktober 2026 gecontroleerd; de scripts zelf zijn
  na de verhuizing niet opnieuw uitgevoerd.
- Een nieuw eenmalig script komt direct in deze map, met de datum in de naam.
- Herhaalbare migraties (`migrate-phase*.cjs`, `migrate-login-pogingen.mjs` en
  dergelijke), audits en taakscripts blijven in `scraper/`; `docs/TESTING.md` en
  de runbooks verwijzen ernaar.

`check-notubiz-browser-wortel.mjs` is de versie die in de repowortel stond; hij
wijkt af van `check-notubiz-browser.mjs` en is daarom apart bewaard.
