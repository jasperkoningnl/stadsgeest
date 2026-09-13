# Fase 3 — sectorregisters en statistiek

**Doel:** actieve scope en acceptatiecriteria.
**Status:** afgerond en productieactief per 13 september 2026.
**Lees wanneer:** bij planning of werk aan fase 3.

## Auditbesluit

De status vóór uitvoering is opnieuw vastgesteld tegen code, productie-database
en officiële bronnen; oude vinkjes golden niet als bewijs. DUO was actief, maar
de overige fase-3-KG-bronnen, R5/R10, gebiedsversies en fase-3-backtests
ontbraken in productie.

De KOOP-audit vergeleek de recent beschikbare lokale steekproef per blad met
`raw_items`: Staatscourant 0/35, Provinciaal blad 0/74, Waterschapsblad 1/94 en
Blad gemeenschappelijke regeling 5/77. Totaal 6/280 (2,1%), ruim onder de
95%-grens. Daarom is een eigen SRU 2.0-adapter gebouwd met twee dagen overlap
en deduplicatie op officiële identifier.

## Productiebronnen

| Bron | Productiecontract | Bewijs op 13-09-2026 |
|---|---|---|
| DUO | vestigingscode; semantische schooldiff | 86 vestigingen, 83 tellingen, 60 prognosereeksen |
| Onderwijsinspectie | element-id; BRIN+locatie; leeg oordeel is geen verslechtering | 116 instellingen; herhaalrun 116 ongewijzigd |
| KOOP | vier bladen; officiële identifier; twee dagen overlap | live SRU valide; laatste venster 3 lokale records |
| AFM | ZIP/XML 3.0; KVK, vergunning, product en dienst | 23.336 landelijk; 195 lokaal; herhaalrun 195 ongewijzigd |
| DNB | zes CSV-deelregisters; register+relatienummer | 45.700 regels; 15 lokaal/watchlist; herhaalrun 15 ongewijzigd |
| Politie/CBS | 47022NED; regiocodes; kaartjaar; revisies | 160.000 rijen, 214 gebieden, kaartjaar 2025, 16 delicten |
| NDW | situation+record-id; geometrie+1 km buffer; 90 dagen | 164 lokale records; iedere 15 minuten; taakresultaat 0 |
| RVO | actuele downloadlink; projectnummer; geometrie/tekst/graph | 73.879 landelijk; 329 lokaal; herhaalrun 329 ongewijzigd |

Iedere bronkaart bevat eigenaar, URL, bronklasse, adapterversie, controledatum,
cadans, sleutel, lokaal filter en semantische velden. Ruwe responses worden
gehasht en gecomprimeerd gearchiveerd. Een kapotte adapter faalt afzonderlijk
en wordt als mislukte `fetch_run` zichtbaar.

## Journalistieke drempels

- Inspectie: alleen een nieuw ernstig oordeel, een echte ernstwisseling of een
  nieuw rapport bij `onvoldoende`/`zeer zwak`. Een lege oordeelrespons en
  tijdelijk verdwijnen zijn geen automatische tip.
- AFM/DNB/RVO: alleen semantische registerwijzigingen; metadata, volgorde en
  whitespace tellen niet. Verwijdering vereist twee succesvolle snapshots.
  RVO vraagt voor automatische nieuwswaarde minimaal €100.000 of een materiële
  statuswijziging.
- Politie/CBS (R5): minimaal vijf registraties; kalendermaand, rollend twaalf
  maanden en gemeentetrend; `observed >= max(2×expected, expected+5)`, robuuste
  z-score ≥3,5 én een tweede patroon. De waarschuwing over registraties en kleine
  aantallen is verplicht.
- NDW (R14): alleen volledige afsluiting, hoge ernst, minstens 24 uur of een
  kritieke locatie/route; kleine werkzaamheden blijven context.
- R10: minstens twee onafhankelijke bronnen bij dezelfde entiteit binnen
  30/60/90 dagen. Doorplaatsingen van hetzelfde officiële stuk tellen niet mee.

## Regelnummering

De oorspronkelijke specificatie behoudt voorrang: R5 is politie-anomalie en R10
multi-sourceversterking. De eerder gebouwde DUO-regels zijn zonder bestaand
productiesignaal hernummerd naar R11/R12. R13 is Inspectiekwaliteit en R14
NDW-impact. Zie `../DECISIONS.md`.

## Backtesting en exitbewijs

- Politie R5: 24 maanden (`2024MM08`–`2026MM07`), 62.144 evaluaties, 15
  triggers en 62.129 onderdrukt (0,024%).
- Eventdata R10: 24 maanden vanaf 1 september 2024, 2.069 signalen, 185 met
  minstens twee bronnen, 133 binnen negentig dagen en 83 niet verworpen.
- Alle bronfamilies begonnen met nul historische nieuws-events; expliciete
  herhaalruns gaven alleen `unchanged` en nul events.
- Officiële URL/id, tijden, adapterversie, raw hash/opslag, semantische hash,
  huidige/vorige waarden, bewijs en onzekerheid worden bewaard.
- Tests dekken schemafouten, lokale filters, afgeschermde waarden,
  tweerunsverwijdering, herstel na tijdelijke afwezigheid, foutisolatie,
  kleine aantallen en de twee 24-maandsbacktests.

De resultaten en detectorversies `crime-robust-1.0` en `multi-source-1.0` staan
in `phase3_backtests`. Een nieuwe datamaand of bestandsversie alleen maakt geen
tip. Er zijn geen inhoudelijke afwijkingen van de fase-3-scope. Voor
compatibiliteit blijven de bestaande database-enums `registry`/`data` en
`hourly`/`daily`/`weekly`; de precieze domeinen en feitelijke cadans staan in
het bronmanifest en de taakplanning.
