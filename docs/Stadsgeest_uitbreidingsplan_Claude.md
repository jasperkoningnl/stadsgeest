# Stadsgeest 2.0 — werkdocument voor uitbreiding met een lokale entiteitenlaag

**Status:** bouwspecificatie  
**Versie:** 1.0 — 4 september 2026  
**Doelgebied:** Amersfoort en Leusden  
**Doelgroep:** Claude of een andere ontwikkelagent die zelfstandig in de bestaande Stadsgeest-codebase werkt

---

## 0. Opdracht aan Claude

Bouw Stadsgeest uit van een bron- en documentpipeline naar een lokaal nieuwsdetectiesysteem met een duurzame entiteitenlaag. De centrale architectuur wordt:

```text
SOURCES -> ENTITIES -> RELATIONS -> EVENTS -> SIGNALS
```

De huidige route `SOURCES -> EVENTS -> SIGNALS` blijft werken, maar ieder nieuw of bestaand document moet waar mogelijk ook worden gekoppeld aan lokale organisaties, personen en locaties. Daardoor kan Stadsgeest twee vragen beantwoorden:

1. Wat gebeurt er **in** Amersfoort of Leusden?
2. Wat gebeurt er **met een persoon of organisatie die bij Amersfoort of Leusden hoort**, ook als de bron de plaatsnaam niet noemt?

### Werkwijze voor Claude

1. Inspecteer eerst de bestaande repository, het huidige datamodel, de scheduler, de opslag, de bronadapters, de signalering en de tests.
2. Maak een korte `current-state.md` met wat herbruikbaar is en welke migraties nodig zijn. Bouw geen tweede parallel systeem als bestaande componenten kunnen worden uitgebreid.
3. Implementeer in de fasen uit hoofdstuk 12. Rond iedere fase volledig af voordat de volgende begint.
4. Gebruik deterministische code voor ophalen, diffen, identifiers, geofilters en harde matches. Gebruik AI alleen voor taken waarvoor taalbegrip nodig is.
5. Bewaar elk nieuwsfeit met herleidbaar bronbewijs. Een signaal zonder bron-URL, brondatum, ruwe snapshot en relevante bewijsvelden mag niet aan de redactie worden geleverd.
6. Sla twijfel niet stilzwijgend plat. Lage-confidence entity matches, persoonsmatches en conflicterende brongegevens gaan naar een reviewwachtrij.
7. Voeg bij iedere bron een fixture, parsercontract, idempotentietest, schema-drifttest en health check toe.
8. Lever per fase een migratie, tests, korte technische documentatie en een terugdraaibare feature flag op.

### Beslissing vooraf

Gebruik voor het MVP bij voorkeur de bestaande relationele database. Als Stadsgeest PostgreSQL gebruikt, voeg dan PostGIS toe voor geografie en modelleer de graph met tabellen voor `entities` en `relations`. Introduceer niet direct Neo4j of een andere graphdatabase. Een aparte graphdatabase is pas gerechtvaardigd als gemeten queries of volumes daar aanleiding toe geven.

---

## 1. Productdoel en afbakening

### 1.1 Gewenste uitkomst

Stadsgeest levert meer niet-bestuurlijke, feitelijke en lokaal relevante tips op, onder meer over:

- overtredingen, sancties, inspecties en tuchtrecht;
- bedrijven en instellingen die openen, sluiten, verhuizen, uitbreiden of van houder/eigenaar veranderen;
- landelijke besluiten met lokale gevolgen;
- bestuurders en toezichthouders die bij meerdere relevante organisaties opduiken;
- subsidies, investeringen en opvallende financiële veranderingen;
- grote storingen, afsluitingen en evenementen met lokale impact;
- statistische afwijkingen per wijk of buurt;
- publieke personen met een aantoonbare band met Amersfoort of Leusden;
- festivals, culturele instellingen, sportorganisaties, zorgorganisaties, scholen, kinderopvang, woningcorporaties en grote werkgevers.

### 1.2 Broncriteria

Een productiebron is:

- openbaar toegankelijk zonder betaalmuur of verplichte login;
- machineleesbaar of betrouwbaar periodiek te scrapen;
- lokaal te filteren via geografie, adres, postcode, gemeente, wijk/buurt of de lokale entiteitenlaag;
- feitelijk van aard: gebeurtenis, registratie, transactie, besluit, overtreding, uitspraak of meetwaarde;
- voldoende stabiel om te monitoren;
- niet al volledig afgedekt door een bestaande Stadsgeest-adapter.

### 1.3 Niet doen in het MVP

- Geen algemene webcrawler voor “alles over Amersfoort”.
- Geen betaalde KVK- of Kadasterproducten toevoegen.
- Geen persoonsprofielen op basis van privégegevens bouwen.
- Geen automatisch nieuwsfeit maken van één OSM-wijziging, agenda-item of goedkope sensor.
- Geen automatische samenvoeging van personen op alleen naamgelijkenis.
- Geen nieuwe scraper bouwen voordat is gecontroleerd of een bestaande `overheid.nl`-, vergunningen- of media-adapter dezelfde records al binnenhaalt.

---

## 2. Doelarchitectuur

```text
                          +-----------------------+
                          | bronregister + schema |
                          +-----------+-----------+
                                      |
SOURCES                               v
API / RSS / SRU / CSV / XML / HTML / PDF / ArcGIS
    |  ophalen, valideren, snapshotten, content hash, provenance
    v
RAW OBJECTS + NORMALIZED SOURCE RECORDS
    |  identifiers, namen, adressen, rollen, locaties extraheren
    v
ENTITIES
organisatie | persoon | vestiging | adres | gebouw | buurt | project | evenement
    |  harde identifiers + confidence + geldigheidsperiode + bronbewijs
    v
RELATIONS
gevestigd_op | bestuurder_van | toezicht_op | onderdeel_van | organiseert | vindt_plaats_op
    |  record-diff of documentextractie maakt feitelijke veranderingen
    v
EVENTS
inspectie | sanctie | vergunning | houderwissel | storing | uitspraak | subsidie | anomalie
    |  clusteren, dedupliceren, lokale relevantie, nieuwswaarde, novelty
    v
SIGNALS
redactionele tip met samenvatting, bewijs, onzekerheden, gekoppelde entiteiten en bronlinks
```

### 2.1 Scheiding van verantwoordelijkheden

- **Sources:** verkrijgen en bewaren wat de bron publiceerde.
- **Entities:** beantwoorden “wie of wat is dit?”.
- **Relations:** beantwoorden “hoe hangt dit samen met Amersfoort/Leusden of een andere entiteit?”.
- **Events:** beschrijven een concrete, gedateerde verandering of gebeurtenis.
- **Signals:** zijn redactionele hypotheses/tips, opgebouwd uit één of meer events.

Een `event` is een feitelijke normalisatie van brondata. Een `signal` is een redactionele interpretatie. Houd die twee strikt gescheiden.

---

## 3. Datamodel

Pas namen aan de bestaande conventies aan, maar behoud deze concepten.

### 3.1 Kernentiteiten

| Hoofdtype | Subtypen / voorbeelden | Belangrijkste velden |
|---|---|---|
| `ORGANIZATION` | bedrijf, stichting, vereniging, zorgaanbieder, schoolbestuur, kinderopvanghouder, woningcorporatie, culturele instelling, sportclub, geloofsgemeenschap, financiële instelling, overheidsorganisatie | officiële naam, handelsnamen, rechtsvorm, sector, status, website, oprichtings-/einddatum |
| `ORGANIZATIONAL_UNIT` | lokale vestiging, schoolvestiging, opvanglocatie, zorglocatie, kantoor, fabriek | naam, moederorganisatie, locatie, openings-/sluitingsdatum, type |
| `PERSON` | bestuurder, RvT/RvC-lid, directeur, artiest, topsporter, wetenschapper, festivalmaker, architect/ontwikkelaar, lokale publieke persoon | naam, aliassen, publieke rollen, lokale band, géén onnodige privégegevens |
| `PLACE` | gemeente, wijk, buurt, bedrijventerrein, station, evenemententerrein | officiële code, naam, geometrie, geldigheidsperiode |
| `ADDRESS` | BAG-adres | nummeraanduiding-ID, postcode, huisnummer, openbare-ruimtenaam, woonplaats, geometrie |
| `BUILDING` | BAG-pand/verblijfsobject, monument, loods, schoolgebouw | BAG-ID, gebruiksdoel, bouwjaar, geometrie, monument-ID |
| `PROJECT` | RVO-project, bouwproject, subsidieproject, infrastructureel werk | projectnummer, titel, status, bedragen, begin/einddatum |
| `EVENT_SERIES` | festival, jaarlijks sportevenement, lezingenreeks | canonieke naam, organisator, locaties, terugkeerpatroon |

### 3.2 Sterke identifiers

Maak identifiers afzonderlijke records; stop ze niet alleen in JSON.

| Namespace | Voorbeeld |
|---|---|
| `KVK` | KVK-nummer voor een organisatie |
| `KVK_BRANCH` | vestigingsnummer |
| `RSIN` | fiscale/rechtspersonenidentificatie, onder meer ANBI |
| `LEI` | Legal Entity Identifier |
| `BRIN` / `BRIN_BRANCH` | school / schoolvestiging |
| `LRK` | kinderopvanglocatie |
| `BAG_NUMMERAANDUIDING` | adresobject |
| `BAG_VBO` / `BAG_PAND` | verblijfsobject / pand |
| `OSM` | combinatie van objecttype en OSM-ID |
| `AFM_REGISTER` / `DNB_REGISTER` | brongebonden register-ID |
| `RVO_PROJECT` | projectnummer |
| `SEVESO_SITE` | brongebonden inrichting-ID of stabiele samengestelde sleutel |

Uniekheidsregel: `(namespace, normalized_value)` is uniek zolang de bron dat identifierbegrip uniek definieert.

### 3.3 Minimale tabellen

```text
sources
  id, name, base_url, adapter_type, authority_class, license,
  expected_cadence, active, config_json, created_at, updated_at

fetch_runs
  id, source_id, started_at, finished_at, status, http_status,
  item_count, new_count, changed_count, unchanged_count, error_count,
  cursor_in, cursor_out, etag, last_modified, content_hash, error_summary

raw_objects
  id, source_id, source_key, canonical_url, fetched_at, published_at,
  media_type, storage_uri, content_hash, http_metadata_json

source_records
  id, source_id, source_key, version, valid_from, valid_to,
  record_hash, normalized_json, raw_object_id, is_current

entities
  id, entity_type, subtype, canonical_name, status,
  first_seen_at, last_seen_at, local_affinity_score, importance_score,
  attributes_json

entity_identifiers
  id, entity_id, namespace, value, normalized_value,
  valid_from, valid_to, source_record_id, confidence

entity_aliases
  id, entity_id, alias, normalized_alias, alias_type, language,
  valid_from, valid_to, source_record_id, confidence

locations
  id, place_type, canonical_name, bag_id, cbs_code,
  address_fields_json, geometry, valid_from, valid_to

entity_locations
  id, entity_id, location_id, role, valid_from, valid_to,
  source_record_id, confidence

relations
  id, subject_entity_id, predicate, object_entity_id,
  valid_from, valid_to, status, source_record_id, confidence,
  evidence_json

events
  id, event_type, event_key, occurred_at, published_at,
  status, location_id, source_id, source_record_id,
  severity, attributes_json, evidence_json

event_entities
  event_id, entity_id, role, resolver_method, confidence,
  evidence_span

signals
  id, signal_type, status, title, summary,
  local_relevance_score, newsworthiness_score, novelty_score,
  confidence_score, created_at, updated_at, explanation_json

signal_events
  signal_id, event_id, contribution_role

review_queue
  id, review_type, candidate_json, reason, priority,
  status, created_at, resolved_at, reviewer, resolution_json

editorial_feedback
  id, signal_id, verdict, reason_codes, notes, created_at
```

### 3.4 Relatietypen

Gebruik een gecontroleerde lijst en richtingvaste namen:

- `HAS_BRANCH`, `BRANCH_OF`
- `HEADQUARTERED_AT`, `LOCATED_AT`, `OPERATES_AT`
- `DIRECTOR_OF`, `SUPERVISOR_OF`, `CHAIR_OF`, `EMPLOYED_BY`
- `PARENT_OF`, `SUBSIDIARY_OF`, `SUCCESSOR_OF`, `PREDECESSOR_OF`
- `HOLDER_OF`, `LICENSED_BY`, `SUPERVISED_BY`
- `ORGANIZES`, `HOSTS`, `TAKES_PLACE_AT`, `FUNDED_BY`
- `ASSOCIATED_WITH_PLACE`, `PUBLICLY_LINKED_TO_PLACE`
- `USES_BUILDING`, `OWNS_BUILDING` alleen wanneer de bron dat echt ondersteunt; verwar gebruik nooit met eigendom.

Elke relatie heeft een geldigheidsperiode, confidence en bronbewijs. Verwijder oude relaties niet; sluit ze af met `valid_to`.

### 3.5 Bronklassen

Geef iedere bron één klasse:

1. `AUTHORITATIVE_REGISTER` — officieel register of besluit.
2. `AUTHORITATIVE_EVENT` — officiële inspectie, sanctie, uitspraak of storing.
3. `DECLARED_BY_ENTITY` — eigen website/jaarverslag van organisatie.
4. `STRUCTURED_CONTEXT` — agenda, OSM of andere contextbron.
5. `MEASUREMENT` — sensor/statistiek met methodologische beperkingen.
6. `DISCOVERY_ONLY` — alleen kandidaat-entiteiten of zoekingang; nooit zelfstandig als nieuwsfeit.

---

## 4. Entity resolution

### 4.1 Normalisatie

Maak herbruikbare normalizers voor:

- Unicode, hoofdletters, diakritische tekens en witruimte;
- Nederlandse rechtsvormen en varianten: `B.V.`, `BV`, `N.V.`, `Stichting`, `St.`, `Vereniging`, `Coöperatie`;
- leestekens, ampersand/`en`, handelsnamen en voormalige namen;
- postcodes zonder spatie, huisnummertoevoegingen en BAG-adressen;
- domeinnamen zonder protocol, `www` en trackingparameters;
- persoonsnamen met voorvoegsels, initialen en roepnaamvarianten, zonder ongefundeerde naamconversies.

Bewaar altijd ook de originele waarde.

### 4.2 Matchvolgorde

1. **Harde identifier:** exact KVK, RSIN, LEI, LRK, BRIN, BAG of bron-ID.
2. **Harde samengestelde match:** exacte genormaliseerde organisatienaam + exact BAG-adres/postcode-huisnummer.
3. **Sterke ondersteunende match:** website-domein + naam; of naam + adres + sector.
4. **Bekende alias:** alias uit een gezaghebbende bron met passend adres/sector.
5. **Fuzzy kandidaat:** naamgelijkenis plus minimaal twee onafhankelijke ondersteunende kenmerken.
6. **Review:** onvoldoende bewijs, conflicterende identifiers of persoonsmatch.

### 4.3 Voorstel resolverscore

```text
+100 exact dezelfde sterke identifier
 +45 exact hetzelfde website-domein
 +40 exact BAG-adres of postcode-huisnummer
 +35 exacte genormaliseerde officiële naam
 +25 bekende alias
 +20 overeenkomstige plaats + sector
 +15 hoge fuzzy name score (>0,94)
 +10 moeder/dochterrelatie ondersteunt match
 -40 conflicterende plaats zonder historische verklaring
 -80 conflicterende sterke identifier
-100 incompatibel entiteitstype
```

- `>= 90`: automatisch mergen voor organisaties.
- `70–89`: kandidaat naar review.
- `< 70`: niet mergen.
- Voor personen geldt: **nooit automatisch mergen op alleen naam**. Vereis een publieke rol plus organisatie, bron of andere onafhankelijke context. Gebruik voor automatische persoonsmerge een hogere drempel van 110 of een harde, publiek verifieerbare combinatie.

### 4.4 Mergebeleid

- Kies één canonical entity; laat alle bronrecords intact.
- Leg iedere merge vast in een auditlog met methode, score en bewijs.
- Ondersteun `unmerge` zonder brondata te verliezen.
- Maak een `do_not_merge`-regel voor bekende naamgenoten.
- Historische adressen en namen blijven tijdgebonden relaties/aliassen.
- Een vestiging en haar moederorganisatie zijn twee entiteiten, verbonden met `BRANCH_OF`; merge ze niet.

### 4.5 Lokale personen

Maak `PERSON` met subtype `LOCAL_PUBLIC_PERSON` alleen wanneer de lokale band publiek en journalistiek relevant is. Mogelijke criteria:

- huidige publieke rol bij een lokale organisatie;
- meerdere onafhankelijke openbare bronnen noemen de persoon Amersfoorter/Leusdenaar of “uit Amersfoort/Leusden”;
- bekende sporter, maker, wetenschapper of bestuurder met een gedocumenteerde duurzame lokale band;
- organisator/spreker die herhaaldelijk in lokale publieke agenda's voorkomt én aanvullend lokaal bewijs heeft.

Bewaar bij personen geen woonadres. Modelleer hoogstens `PUBLICLY_LINKED_TO_PLACE` met bron, datum, confidence en eventueel wijkniveau wanneer dat noodzakelijk en verantwoord is.

### 4.6 Ontdekking van nieuwe lokale personen

Gebruik het bestaande nieuws-/mediacorpus als `DISCOVERY_ONLY`-ingang. Zoek in zinnen en koppen naar patronen als:

- `Amersfoorter <naam>` / `Amersfoortse <beroep> <naam>`;
- `<naam> uit Amersfoort` / `<naam> uit Leusden`;
- `<naam>, woonachtig in Amersfoort`;
- een publieke functie bij een al bekende lokale organisatie.

Eén vermelding maakt alleen een kandidaat. Maak pas een lokale persoonsrelatie na twee onafhankelijke betrouwbare bronnen, of één gezaghebbende openbare bron plus een publieke rol bij een lokale entiteit. Nieuwsdoorplaatsingen en persbureaukopieën tellen als één bron. Herhaald voorkomen in de UITagenda verhoogt de importance-score, maar bewijst op zichzelf geen woon- of herkomstrelatie.

### 4.7 Opbouw van het lokale organisatie-universum

Er bestaat binnen de gestelde voorwaarden geen complete gratis bedrijvenlijst met alle lokale functionarissen. Bouw daarom een transparante samengestelde universe:

1. bestaande vergunningen/BAG-adressen en reeds bekende organisaties;
2. ANBI voor stichtingen en maatschappelijke organisaties;
3. GLEIF voor grotere rechtspersonen en concernrelaties;
4. OSM voor fysieke vestigingen en instellingen als context;
5. LRK, DUO, AFM, DNB, zorgdata en dPi voor sectoren;
6. evenementen-/agendaorganisatoren en locaties;
7. een handmatig geredigeerde seedset voor grote werkgevers, podia, festivals, DierenPark Amersfoort, sportclubs en andere lokale ankerorganisaties;
8. openbare organisatiepagina's/jaarverslagen voor bestuur, directie en RvT/RvC.

Sla per entiteit op via welke dekkingsroute zij is gevonden. Rapporteer dekking per sector; presenteer de graph nooit als volledig handelsregister.

---

## 5. Lokale relevantie en nieuwsscore

### 5.1 Lokale relevantiescore (0–100)

Bereken lokale relevantie los van nieuwswaarde. Neem per categorie de hoogste passende waarde en tel de categorieën op.

**A. Geografische/entiteitsband — maximaal 55**

- 55: eventgeometrie of exact eventadres ligt in Amersfoort/Leusden.
- 50: het event gaat over een lokale vestiging/faciliteit.
- 45: primaire organisatie heeft hoofdkantoor/statutaire vestiging in het doelgebied.
- 35: organisatie heeft een actuele, betekenisvolle vestiging in het doelgebied.
- 30: persoon heeft een sterke, actuele publieke lokale band.
- 20: één hop naar een sterk lokale entiteit, bijvoorbeeld landelijke moeder -> lokale dochter.
- 10: alleen een zwakke of historische lokale relatie.

**B. Rol in het event — maximaal 25**

- 25: entiteit is onderwerp, overtreder, vergunninghouder, koper/verkoper, geïnspecteerde of rechtstreeks getroffen partij.
- 20: lokaal gebouw/project/vestiging is onderwerp.
- 15: bestuurder, organisator of concernrelatie is rechtstreeks betrokken.
- 5: alleen genoemd in tekst.

**C. Bewijskracht van de lokale koppeling — maximaal 20**

- 20: sterke identifier/BAG-geometrie/officieel register.
- 15: twee onafhankelijke bronnen of exact adres + naam.
- 10: één betrouwbare openbare bron.
- 5: zachte contextbron.

**Drempels**

- `>= 65`: lokaal relevant, mag door naar signalering.
- `50–64`: review of alleen door bij hoge nieuwswaarde.
- `< 50`: niet lokaal genoeg; bewaren als context, geen redactietip.

### 5.2 Nieuwswaardescore (0–100)

Bereken minimaal:

- impact/ernst: 0–30;
- aantal getroffenen of financieel belang: 0–20;
- nieuwheid/verandering: 0–20;
- uitzonderlijkheid ten opzichte van historie: 0–15;
- bronbetrouwbaarheid: 0–10;
- redactionele handelbaarheid: 0–5.

Voorbeeld eindscore:

```text
signal_score =
  0.45 * local_relevance_score +
  0.35 * newsworthiness_score +
  0.20 * novelty_score
```

Harde poorten:

- geen signaal zonder bronbewijs;
- geen signaal onder lokale score 50;
- geen beschuldiging/sanctie als de status of rechtsgang niet wordt weergegeven;
- een zachte bron kan nooit als enige bewijsbron een “hard” signaal dragen.

---

## 6. Bronnenbacklog op prioriteit

De prioriteit gaat over bouwvolgorde, niet over intrinsieke journalistieke waarde.

### P0 — eerste productiepad

1. Bestaande BAG/vergunningen koppelen aan entiteiten en adressen.
2. ANBI-register.
3. GLEIF.
4. OpenStreetMap/Overpass als contextlaag.
5. Nederlandse Arbeidsinspectie — Eerlijk werk.
6. LRK plus GGD-inspectierapporten.
7. Liander ArcGIS-storingen.
8. Open Data Tuchtrecht.
9. ACM-publicaties en AP-sancties, gematcht tegen de lokale graph.
10. Nederlandse Arbeidsinspectie — ernstige asbestovertredingen.

### P1 — verbreding en anomalieën

11. KOOP niet-gemeentelijke officiële publicaties; eerst de bestaande dekking auditen.
12. DUO Open Onderwijsdata.
13. AFM-registers.
14. DNB Openbaar Register.
15. Politie/CBS wijk- en buurtdata.
16. NDW wegwerkzaamheden en evenementen.
17. RVO Projectendatabase.

### P2 — periodiek, specialistisch of experimenteel

18. Jaarverantwoording Zorg.
19. Corporatiedata dPi.
20. Tijd voor Amersfoort / volledige UITagenda.
21. Gemeentelijke evenementenkalender.
22. Rijksmonumentenregister.
23. SEVESO+.
24. RIVM Samen Meten.

### Buiten scope totdat voorwaarden veranderen

25. Centraal Insolventieregister (CIR).
26. EP-Online.
27. KVK Open Dataset als lokale bedrijvenbasis.
28. ODU/ODRU en VRU individuele cases.
29. Gratis vastgoedtransacties.

---

## 7. Concrete bronkaarten

### P0.1 Bestaande vergunningen + BAG/BRK

- **URL:** bestaande Stadsgeest-bronnen; BAG is al aanwezig.
- **Wat:** vergunningaanvragen/-besluiten en adressen, panden, verblijfsobjecten en percelen.
- **Lokaal filter:** reeds lokaal; normaliseer naar BAG-ID/geometrie in plaats van alleen adrestekst.
- **Frequentie:** huidige frequentie behouden.
- **Aanpak:** verrijk elk vergunningevent met BAG-nummeraanduiding, VBO, pand en perceel waar beschikbaar. Koppel vervolgens `entity_locations` op hetzelfde adres.
- **Nieuwswaarde:** maakt detecties mogelijk zoals “bedrijf krijgt vergunning voor extra loods” zonder dat de vergunning de bekende bedrijfsnaam duidelijk noemt.
- **Taak:** voer eerst een coverage-audit uit: welk percentage van vergunningrecords heeft nu een valide BAG-match?

### P0.2 ANBI-register

- **URL:** https://www.belastingdienst.nl/wps/wcm/connect/bldcontentnl/themaoverstijgend/brochures_en_publicaties/open_data_anbi
- **Wat:** naam, fiscaal nummer/RSIN, dossiernummer, vestigingsplaats, website, ingangsdatum en alias van ANBI's.
- **Lokaal filter:** `vestigingsPlaats` exact genormaliseerd op Amersfoort of Leusden; controleer postadres/website wanneer plaats ontbreekt of historisch is.
- **Frequentie:** iedere dinsdag.
- **Aanpak:** download het door de pagina aangeboden gecomprimeerde Excelbestand; archiveer; parse; diff op RSIN/dossiernummer. Gebruik websites van lokale ANBI's in een afzonderlijke, beleefde tweede stap voor openbare bestuur-/RvT-pagina's, jaarverslagen en ANBI-publicatiepagina's.
- **Nieuwswaarde:** dekt stichtingen, cultuur, welzijn, religie en maatschappelijke organisaties die in gemeentelijke bronnen weinig zichtbaar zijn.
- **Beperking:** het register bevat niet zelf alle bestuurders. Bestuurders uit de eigen website zijn `DECLARED_BY_ENTITY` en moeten met URL, datum en bewijsfragment worden opgeslagen.
- **Eventtypes:** `ANBI_ADDED`, `ANBI_REMOVED`, `ANBI_NAME_CHANGED`, `ANBI_WEBSITE_CHANGED`, `BOARD_MEMBER_ADDED`, `BOARD_MEMBER_REMOVED`.

### P0.3 GLEIF

- **URL/documentatie:** https://www.gleif.org/en/lei-data/gleif-api
- **API:** https://api.gleif.org/api/v1/lei-records
- **Wat:** LEI, officiële en alternatieve namen, juridische en hoofdkantooradressen, registratiestatus, entity events en waar beschikbaar directe/uiteindelijke moederrelaties.
- **Lokaal filter:** adresvelden/plaats Amersfoort of Leusden; daarnaast bekende lokale organisatienamen/LEI's volgen.
- **Frequentie:** API actueel; Golden Copy/deltafiles drie keer per dag. Voor MVP is een wekelijkse lokale discovery plus dagelijkse watchlistcontrole voldoende.
- **Aanpak:** gebruik JSON:API; pagineer; bewaar LEI als hard identifier. Haal parent/child-relaties apart op. Volg redirects/successor entities en registreer verlopen LEI's als historische status, niet als verwijdering.
- **Nieuwswaarde:** concernstructuren, naamswijzigingen, fusies en landelijke gebeurtenissen bij moeder/dochterbedrijven worden lokaal vindbaar.
- **Beperking:** niet iedere onderneming heeft een LEI; dit is geen compleet bedrijvenregister.
- **Eventtypes:** `LEI_ENTITY_ADDED`, `LEGAL_NAME_CHANGED`, `HEADQUARTERS_CHANGED`, `ENTITY_STATUS_CHANGED`, `PARENT_RELATION_CHANGED`, `SUCCESSOR_RECORDED`.

### P0.4 OpenStreetMap / Overpass

- **API:** https://overpass-api.de/api/interpreter
- **Documentatie:** https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
- **Wat:** fysieke objecten met tags zoals `office`, `shop`, `amenity`, `tourism`, `leisure`, `healthcare`, `operator`, `brand`, `website` en adressen.
- **Lokaal filter:** gebiedsquery op bestuurlijke grens van Amersfoort en Leusden; valideer de gekozen relation/area-ID éénmalig en leg hem in configuratie vast.
- **Frequentie:** wekelijkse snapshot; niet vaker zonder noodzaak.
- **Aanpak:** query nodes/ways/relations met relevante tags; respecteer rate limits; cache volledige respons. Match via BAG-adres, website, operator en naam. Gebruik OSM nooit als bewijs van eigendom.
- **Nieuwswaarde:** goedkope fysieke contextlaag voor locaties die elders alleen als adres of terrein voorkomen.
- **Beperking:** communitydata kan onvolledig of fout zijn. Klasse `STRUCTURED_CONTEXT`; wijzigingen gaan hoogstens naar review.
- **Eventtypes:** standaard géén hard event. Optioneel `OSM_ENTITY_CANDIDATE` en `OSM_LOCATION_CHANGED` met lage confidence.

### P0.5 Nederlandse Arbeidsinspectie — Eerlijk werk

- **URL:** https://resultaten.nlarbeidsinspectie.nl/
- **Wat:** geïnspecteerde organisatie, vestigingsplaats, handelsregisternummer indien aanwezig, inspectielocatie, inspectiedatum, wet(ten), overtreding, sanctie en juridische status.
- **Lokaal filter:** inspectieplaats Amersfoort/Leusden; vestigingsplaats Amersfoort/Leusden; later ook KVK/naam van lokale watchlist.
- **Frequentie:** dagelijks pollen; publicatie volgt normaal tien dagen na het openbaarmakingsbesluit, tenzij een voorlopige voorziening de publicatie uitstelt. Resultaten blijven beperkt in tijd zichtbaar, dus lokaal archiveren is essentieel.
- **Aanpak:** HTML-resultatenlijst pagineren; detailpagina ophalen; stabiele detail-URL/inspectie-ID als sleutel; dagelijkse overlap van minimaal dertig dagen voor correcties. Hash alleen semantische velden, niet navigatie of opmaak.
- **Nieuwswaarde:** onderbetaling, illegale arbeid, arbeidsbemiddeling en stillegging bij lokale bedrijven.
- **Eventtypes:** `LABOUR_INSPECTION_PUBLISHED`, `LABOUR_VIOLATION_FOUND`, `LABOUR_SANCTION_CHANGED`, `LABOUR_DECISION_FINAL`.

### P0.6 Landelijk Register Kinderopvang + GGD-inspecties

- **CSV:** https://www.landelijkregisterkinderopvang.nl/opendata/export_opendata_lrk.csv
- **Register:** https://www.landelijkregisterkinderopvang.nl/
- **Wat:** LRK-ID, type opvang, naam, kindplaatsen, status, inschrijfdatum, opvangadres/BAG-ID, houder, KVK/vestigingsnummer van houder en verantwoordelijke gemeente. Publieke locatiepagina's verwijzen naar GGD-inspectierapporten.
- **Lokaal filter:** verantwoordelijke gemeente, opvangwoonplaats, postcode en/of BAG-geometrie Amersfoort/Leusden.
- **Frequentie:** CSV doorgaans maandag en vrijdag. Inspectiepagina's dagelijks of enkele malen per week voor alleen de lokale LRK-ID's.
- **Aanpak:** semikolon-CSV downloaden en snapshotten; diff op LRK-ID. Maak zelf historie: eerdere landelijke snapshots worden niet als betrouwbare openbare historische reeks aangeboden. Poll per lokale locatie de openbare detailpagina, verzamel nieuwe rapport-URL's, download PDF, extraheer tekst en bewaar origineel.
- **Nieuwswaarde:** nieuwe/verdwenen locaties, houderwissels, capaciteitswijzigingen en ernstige inspectietekorten.
- **Beperking:** geen nette landelijke bulkfeed van alle inspectierapporten; houd de crawl doelgericht. Een GGD-advies is niet hetzelfde als een gemeentelijk besluit.
- **Eventtypes:** `CHILDCARE_OPENED`, `CHILDCARE_CLOSED`, `CHILDCARE_HOLDER_CHANGED`, `CHILDCARE_CAPACITY_CHANGED`, `GGD_REPORT_PUBLISHED`, `GGD_DEFICIENCY_FOUND`.

### P0.7 Liander storingsdata

- **Catalogus:** https://data.overheid.nl/dataset/storingsdata-liander-actuele-storingen
- **ArcGIS FeatureServer:** https://services1.arcgis.com/v6W5HAVrpgSg3vts/ArcGIS/rest/services/IStoringen_Productie_V7/FeatureServer/0
- **Wat:** storingsnummer, getroffen plaats/postcodes/straten, energiebron, status, meldtijd, verwachte en werkelijke eindtijd, oorzaak, component, getroffen klanten en geometrie.
- **Lokaal filter:** server-side `where` op getroffen plaats/postcodes waar betrouwbaar; altijd geometrie of lokale postcode-4-lijst als tweede controle.
- **Frequentie:** iedere vijf minuten tijdens actieve storingen, anders iedere vijftien minuten.
- **Aanpak:** ArcGIS REST `query` met `f=json`, `outFields=*`, `returnGeometry=true`; sleutel `STORING_NUMMER`. Modelleer statusupdates als versies van één event, niet als nieuwe signalen.
- **Nieuwswaarde:** grote of langdurige uitval, kritieke locaties, herhaalde storingen.
- **Signaaldrempel eerste versie:** minimaal 250 klanten, of duur >60 minuten, of kritieke locatie geraakt, of derde storing in hetzelfde gebied binnen dertig dagen.
- **Eventtypes:** `UTILITY_OUTAGE_STARTED`, `UTILITY_OUTAGE_UPDATED`, `UTILITY_OUTAGE_RESOLVED`.

### P0.8 Open Data Tuchtrecht

- **Catalogus:** https://data.overheid.nl/dataset/open-data-tuchtrecht
- **SRU-basis:** https://repository.overheid.nl/sru
- **Handleiding:** https://data.overheid.nl/sites/default/files/dataset/d0cca537-44ea-48cf-9880-fa21e1a7058f/resources/HandleidingSRU2.0.pdf
- **Wat:** uitspraken van wettelijk niet-hiërarchisch tuchtrecht, waaronder medisch en ander professioneel tuchtrecht.
- **Lokaal filter:** fulltext en metadata op Amersfoort/Leusden, lokale instellingen/praktijken, adressen en lokale entiteiten/aliassen.
- **Frequentie:** dagelijks.
- **Aanpak:** SRU 2.0, collectie `tuchtrecht`; incrementeel op publicatie-/wijzigingsdatum met zeven dagen overlap; haal volledige tekst/document op voor kandidaten. Gebruik uitspraak-ID als sleutel.
- **Nieuwswaarde:** berisping, schorsing of andere maatregel rond lokale professionals en instellingen.
- **Beperking:** anonimiseren kan entity resolution onmogelijk maken. Forceer dan geen persoon of instelling; een niet-lokaliseerbare uitspraak is geen lokaal signaal.
- **Eventtypes:** `DISCIPLINARY_RULING_PUBLISHED`, `DISCIPLINARY_MEASURE_IMPOSED`, `DISCIPLINARY_OUTCOME_CHANGED`.

### P0.9 ACM-publicaties

- **Publicaties:** https://www.acm.nl/nl/publicaties
- **RSS-builder:** https://www.acm.nl/nl/nieuws/rss
- **Wat:** besluiten, sancties, concentratiemeldingen, beslissingen op bezwaar en gerechtelijke uitspraken; partij- en zaakgegevens zijn vaak gestructureerd op de detailpagina.
- **Lokaal filter:** niet primair op plaatsnaam. Match genoemde partijen, KVK/LEI waar aanwezig, handelsnamen, moeder/dochterrelaties en lokale vestigingen tegen de graph.
- **Frequentie:** dagelijks via RSS, met periodieke HTML-backfill.
- **Aanpak:** maak RSS-selecties voor minimaal `Besluit`, `Concentratiemelding`, `Beslissing op bezwaar` en `Gerechtelijke uitspraak`; detailpagina en PDF ophalen; zaaknummer als primaire clustersleutel.
- **Nieuwswaarde:** landelijke sanctie, vergunning of overname met gevolgen voor een lokaal bedrijf of lokale vestiging.
- **Eventtypes:** `ACM_CASE_OPENED`, `ACM_CONCENTRATION_FILED`, `ACM_DECISION_PUBLISHED`, `ACM_SANCTION_PUBLISHED`, `ACM_CASE_UPDATED`.

### P0.10 Autoriteit Persoonsgegevens

- **Sancties:** https://autoriteitpersoonsgegevens.nl/boetes-en-andere-sancties
- **Publicatieplicht:** https://autoriteitpersoonsgegevens.nl/actueel/ap-maakt-avg-sancties-voortaan-verplicht-openbaar
- **Wat:** boetes, lasten onder dwangsom, verwerkingsverboden en andere AVG-sancties. Vanaf 1 september 2026 is publicatie wettelijk verplicht.
- **Lokaal filter:** genoemde organisatie of concernpartij matchen tegen lokale entiteiten; plaatsnaam is aanvullend, niet noodzakelijk.
- **Frequentie:** dagelijks.
- **Aanpak:** scrape overzicht en detailpagina; download besluiten/PDF's; key op zaak-/besluitnummer of stabiele URL; status/rechtsmiddelen expliciet extraheren.
- **Nieuwswaarde:** privacy- of databeveiligingszaak bij een lokaal bedrijf, zorginstelling, school of landelijke organisatie met lokale vestiging.
- **Eventtypes:** `AP_SANCTION_PUBLISHED`, `AP_ORDER_PUBLISHED`, `AP_DECISION_UPDATED`.

### P0.11 Nederlandse Arbeidsinspectie — ernstige asbestovertredingen

- **URL:** https://asbestovertredingen.nlarbeidsinspectie.nl/
- **Wat:** zware/ernstige asbestovertredingen met boete, overtreder, vestigingsplaats, werklocatie, datum, overtredingen en eventuele stillegging.
- **Lokaal filter:** asbestwerklocatie Amersfoort/Leusden; daarnaast vestigingsplaats en lokale entiteitenlijst.
- **Frequentie:** dagelijks pollen; volume is laag.
- **Aanpak:** HTML-overzicht en detailpagina; diff op record/detail-URL; lange overlap wegens latere juridische updates.
- **Nieuwswaarde:** bouw- of sloopwerk dat wegens ernstige asbestovertreding is beboet of stilgelegd.
- **Eventtypes:** `ASBESTOS_VIOLATION_PUBLISHED`, `ASBESTOS_WORK_STOPPED`, `ASBESTOS_DECISION_UPDATED`.

### P1.1 KOOP — niet-gemeentelijke officiële publicaties

- **Catalogus:** https://data.overheid.nl/dataset/officiele-bekendmakingen
- **SRU-basis:** https://repository.overheid.nl/sru
- **Wat:** Staatscourant, Provinciaal blad, Waterschapsblad en Blad gemeenschappelijke regeling, naast het Gemeenteblad.
- **Lokaal filter:** `dt.spatial`, tekst, geometrische metadata, maker en lokale entiteiten/aliassen. Gebruik collectie `officielepublicaties`.
- **Frequentie:** dagelijks/continu.
- **Aanpak:** **eerst audit:** neem honderd recente records uit ieder niet-gemeentelijk publicatieblad die Amersfoort/Leusden raken en meet hoeveel de huidige `overheid.nl`-adapter al bevat. Als dekking >=95% is, alleen classifiers en filters uitbreiden. Anders een SRU 2.0-adapter maken met twee dagen overlap en stabiele publicatie-ID.
- **Nieuwswaarde:** watervergunningen, natuurontheffingen, provinciale infrastructuur, rijksbesluiten, onteigeningen, verkeersbesluiten en besluiten van regionale samenwerkingen.
- **Deduplicatie:** dezelfde publicatie kan via meerdere KOOP-ingangen verschijnen; dedup op officiële identifier, niet op titel.
- **Eventtypes:** afhankelijk van documenttype, onder meer `WATER_PERMIT`, `PROVINCIAL_DECISION`, `NATIONAL_DECISION`, `JOINT_AUTHORITY_DECISION`.

### P1.2 DUO Open Onderwijsdata

- **Basisonderwijs:** https://onderwijsdata.duo.nl/datasets/adressen_bo/resources/dcc9c9a5-6d01-410b-967f-810557588ba4
- **BO API-voorbeeld:** https://onderwijsdata.duo.nl/api/3/action/datastore_search?resource_id=dcc9c9a5-6d01-410b-967f-810557588ba4
- **Voortgezet onderwijs:** https://onderwijsdata.duo.nl/datasets/adressen_vo/resources/5187f8d5-ff9c-4284-8e06-4311f0354956
- **Wat:** hoofd- en nevenvestigingen, vestigingscode, naam, bestuur, adres, gemeente en denominatie.
- **Lokaal filter:** `GEMEENTENAAM` Amersfoort/Leusden; valideer ook postcode/BAG.
- **Frequentie:** maandelijks.
- **Aanpak:** CKAN Datastore API of CSV; snapshot en diff op vestigingscode; modelleer schoolbestuur en vestiging afzonderlijk.
- **Nieuwswaarde:** nieuwe/verdwenen/verhuisde vestiging, naams- of bestuurswijziging.
- **Eventtypes:** `SCHOOL_BRANCH_OPENED`, `SCHOOL_BRANCH_CLOSED`, `SCHOOL_MOVED`, `SCHOOL_BOARD_CHANGED`.

### P1.3 AFM-register financiële dienstverleners

- **URL:** https://www.afm.nl/nl-nl/sector/registers/vergunningenregisters/financiele-dienstverleners
- **Wat:** statutaire naam, handelsnaam, vestigingsplaats en vergunning-/registerinformatie; volledige CSV/XML-export.
- **Lokaal filter:** vestigingsplaats Amersfoort/Leusden en match tegen lokale entiteiten.
- **Frequentie:** dagelijks ophalen en alleen verwerken wanneer de hash wijzigt.
- **Aanpak:** gebruik bij voorkeur XML met XSD of CSV-export; bewaar registerstatus en categorie als tijdgebonden relatie/attribuut.
- **Nieuwswaarde:** nieuwe, gewijzigde of ingetrokken registratie van lokale financiële dienstverlener.
- **Eventtypes:** `AFM_REGISTRATION_ADDED`, `AFM_REGISTRATION_CHANGED`, `AFM_REGISTRATION_REMOVED`.

### P1.4 DNB Openbaar Register

- **URL:** https://www.dnb.nl/openbaar-register/
- **Wat:** banken, verzekeraars, pensioenfondsen, betaalinstellingen, trustkantoren en andere onder DNB vallende instellingen; API en volledige CSV/XML.
- **Lokaal filter:** vestigings-/adresvelden en lokale watchlist.
- **Frequentie:** iedere werkdag; downloads worden om 06.00 uur bijgewerkt.
- **Aanpak:** CSV/XML na 06.30 uur ophalen; diff op register-ID plus instelling; status en registercategorie bewaren.
- **Nieuwswaarde:** vergunning-/statuswijzigingen bij lokaal relevante financiële instellingen.
- **Eventtypes:** `DNB_REGISTRATION_ADDED`, `DNB_REGISTRATION_CHANGED`, `DNB_REGISTRATION_REMOVED`.

### P1.5 Politie/CBS wijk- en buurtdata

- **Dataset:** https://data.overheid.nl/dataset/482f47fe-588e-4173-ac57-955b95d7eb56
- **OData API:** https://dataderden.cbs.nl/ODataApi/OData/47022NED
- **Portaal:** https://data.politie.nl/#/Politie/nl/dataset/47022NED/table
- **Wat:** geregistreerde misdrijven per soort, maand, wijk en buurt, vanaf 2012.
- **Lokaal filter:** gebruik CBS-regiocodes voor wijken/buurten van Amersfoort en Leusden; bouw de code-set uit de dimensietabel en versieer de gebiedsindeling. Filter niet alleen op naamtekst.
- **Frequentie:** maandelijks.
- **Aanpak:** OData JSON/ATOM, incrementeel per nieuwe maand. Bewaar revisies. Maak een statistische detector; lever nooit een tip “omdat er nieuwe cijfers zijn”.
- **Nieuwswaarde:** lokale patronen die niet via losse politieberichten zichtbaar zijn.
- **Minimale anomalielogica:** minimaal 5 incidenten; vergelijk met dezelfde maand in eerdere jaren, rollend twaalfmaandsgemiddelde en stadsbrede trend; gebruik robuuste z-score of negatieve-binomiale verwachting; markeer kleine aantallen en registratie-effecten.
- **Eventtypes:** `CRIME_SERIES_UPDATED`, `CRIME_ANOMALY_DETECTED`, `CRIME_TREND_DETECTED`.

### P1.6 NDW wegwerkzaamheden en evenementen

- **Portaal:** https://opendata.ndw.nu/
- **Feed:** https://opendata.ndw.nu/planningsfeed_wegwerkzaamheden_en_evenementen.xml.gz
- **Wat:** geplande wegwerkzaamheden/evenementen, locatie, periode, afsluitingen, omleidingen en maatregelen in DATEX II.
- **Lokaal filter:** geometrie intersecteren met gemeentegrenzen en een kleine buffer; route-impact kan buiten de grens beginnen maar lokaal effect hebben.
- **Frequentie:** iedere vijftien minuten.
- **Aanpak:** gzip streamen, XML parseren, diff op event-ID; statusupdates aan bestaand event hangen. Houd een tijdvenster, bijvoorbeeld start tussen nu en 90 dagen.
- **Nieuwswaarde:** grote/langdurige afsluitingen en vroeg zichtbare verkeersimpact van evenementen.
- **Drempel:** geen signaal voor kleine werkzaamheden; weeg duur, wegklasse, volledige afsluiting, omleiding, station/centrum/ziekenhuis en samenloop.
- **Eventtypes:** `ROADWORK_PLANNED`, `ROAD_CLOSURE_CHANGED`, `EVENT_TRAFFIC_MEASURE`.

### P1.7 RVO Projectendatabase

- **Zoekinterface:** https://projecten.rvo.nl/nl
- **Uitleg:** https://www.rvo.nl/onderwerpen/volg-innovatie
- **Wat:** ondersteunde innovatie-/subsidieprojecten met aanvrager, regeling, projectnummer, rijksbijdrage, jaar, sector, status en beschrijving.
- **Lokaal filter:** fulltext Amersfoort/Leusden plus match van aanvrager/partner tegen de lokale graph; locatievelden zijn niet altijd fijnmazig genoeg.
- **Frequentie:** wekelijks; hash de volledige export.
- **Aanpak:** volg op de zoekinterface de actuele “volledige CSV downloaden”-link in plaats van een eeuwig hardgecodeerde bestands-URL; archiveer CSV; diff op projectnummer.
- **Nieuwswaarde:** lokale bedrijven en instellingen die substantiële publieke steun krijgen voor concrete projecten.
- **Drempel:** bedrag, regeling, uitzonderlijkheid en lokale rol; landelijke consortiumpartner zonder lokale uitvoering krijgt lagere local score.
- **Eventtypes:** `RVO_PROJECT_ADDED`, `RVO_PROJECT_CHANGED`, `RVO_FUNDING_CHANGED`.

### P2.1 Jaarverantwoording Zorg

- **Datasets:** https://www.jaarverantwoordingzorg.nl/over-de-jaarverantwoording/gegevens-bekijken/gegevens-per-boekjaar
- **Wat:** openbare financiële en organisatorische verantwoordingsdata, maatschappelijke verslagen, jaarrekeningen en WNT/topinkomensgegevens van zorg- en jeugdhulpaanbieders.
- **Lokaal filter:** KVK/organisatie matchen tegen lokale zorgentiteiten; vestigingsinformatie waar aanwezig. Let op geconsolideerde concerns.
- **Frequentie:** jaarlijks, maar tijdens het verantwoordingsseizoen periodiek verversen.
- **Aanpak:** bronbestanden per boekjaar downloaden; datadictionary/sheet mapping versieerbaar maken; bereken jaar-op-jaarverschillen. Extraheer bestuurders/RvT alleen uit expliciet openbare governance-/WNT-velden of documenten met bewijs.
- **Nieuwswaarde:** groot verlies, opvallende groei/krimp, bestuurderswissel, toezichthouders, topinkomen of continuïteitsrisico bij lokale zorgaanbieder.
- **Beperking:** CIBG controleert de aangeleverde cijfers niet inhoudelijk; vermeld dat in signalen.
- **Eventtypes:** `CARE_FILING_PUBLISHED`, `CARE_FINANCIAL_ANOMALY`, `CARE_BOARD_CHANGED`, `CARE_SUPERVISOR_CHANGED`.

### P2.2 Woningcorporaties — dPi

- **Dataset:** https://data.overheid.nl/dataset/prognose-informatie-woningcorporaties-dpi2025-hfd1-tm-hfd4
- **Wat:** verplichte prognose-informatie, meerjarenplannen en investerings-/woningbouwgegevens, deels op gemeenteniveau.
- **Lokaal filter:** gemeente Amersfoort/Leusden en corporaties als Portaal, de Alliantie en andere lokaal actieve corporaties.
- **Frequentie:** jaarlijks.
- **Aanpak:** haal ieder jaar het actuele XLSX-bestand via de datasetcatalogus; maak sheet/kolom mapping per verslagversie; diff plannen en bedragen ten opzichte van vorig jaar.
- **Nieuwswaarde:** forse verschuiving in nieuwbouw, sloop, verkoop, verduurzaming of investeringen.
- **Eventtypes:** `HOUSING_FORECAST_PUBLISHED`, `HOUSING_PLAN_CHANGED`, `HOUSING_INVESTMENT_ANOMALY`.

### P2.3 Tijd voor Amersfoort / UITagenda

- **URL:** https://www.tijdvooramersfoort.nl/nl/evenementen/volledige-uitagenda
- **Wat:** honderden openbare evenementen, lezingen, festivals, optredens, makers, sprekers, locaties en data.
- **Lokaal filter:** bron is al regionaal; valideer locatie.
- **Frequentie:** dagelijks.
- **Aanpak:** gebruik JSON-LD/schema.org als aanwezig, anders gepagineerde HTML; eventdetail ophalen; canonieke URL + startdatum als sleutel. Herken terugkerende evenementen en voorkom dat iedere datum een nieuwe organisatie/persoon maakt.
- **Nieuwswaarde:** vooral entiteitsverrijking en patroonherkenning, bijvoorbeeld een lokale spreker die bij meerdere instellingen opduikt. Niet ieder agenda-item is een tip.
- **Bronklasse:** `STRUCTURED_CONTEXT`.
- **Eventtypes:** `PUBLIC_EVENT_SCHEDULED`, `SPEAKER_APPEARANCE`; signalering alleen bij opmerkelijke patronen of combinatie met hardere bronnen.

### P2.4 Gemeentelijke evenementenkalender

- **URL:** https://www.amersfoort.nl/evenementenkalender
- **Wat:** aangemelde evenementen en jaarlijks vastgestelde kalender. Opname betekent niet dat een vergunning is verleend.
- **Lokaal filter:** Amersfoort; Leusden vraagt een afzonderlijke verkenning als vergelijkbare kalender bestaat.
- **Frequentie:** maandelijks buiten het aanvraag-/vaststellingsseizoen, wekelijks van augustus tot december.
- **Aanpak:** pagina monitoren; PDF/XLSX downloaden wanneer gepubliceerd; tabellen extraheren; diff op naam + datum + locatie. Koppel later aan vergunningevent.
- **Nieuwswaarde:** nieuwe/grote festivals, kalenderconflicten en evenementen die al vroeg zichtbaar zijn.
- **Beperking:** `EVENT_REGISTERED` is geen `PERMIT_GRANTED`; toon dat expliciet.
- **Eventtypes:** `EVENT_REGISTERED`, `EVENT_CALENDAR_CHANGED`, later koppeling met `EVENT_PERMIT_APPLIED/GRANTED`.

### P2.5 Rijksmonumentenregister

- **Downloadpagina:** https://www.cultureelerfgoed.nl/onderwerpen/r/rijksmonumentenregister/monumentendatabank
- **Wat:** registergegevens van rijksmonumenten en wijzigingen; de Extract_MRS-download wordt dagelijks bijgewerkt.
- **Lokaal filter:** gemeente/plaats, adres en geometrie.
- **Frequentie:** wekelijkse download is voor lokaal nieuws voldoende.
- **Aanpak:** ZIP downloaden; parse volgens actuele specificatie; diff op monumentnummer en inhoudelijke velden; koppel aan BAG-pand/adres.
- **Nieuwswaarde:** aanwijzing, afvoering of wezenlijke registerwijziging; laag volume, weinig ruis.
- **Eventtypes:** `MONUMENT_ADDED`, `MONUMENT_REMOVED`, `MONUMENT_RECORD_CHANGED`.

### P2.6 SEVESO+

- **Inspecties:** https://seveso-plus.nl/inspectieresultaten/
- **Inrichtingenlijst:** https://seveso-plus.nl/inspectieresultaten/seveso-inrichtingenlijst/
- **Nalevingslijst:** https://seveso-plus.nl/inspectieresultaten/nalevingslijst/
- **Wat:** maandelijkse lijst van ruim 400 risicovolle inrichtingen, overtredingscategorieën en openbare inspectiesamenvattingen.
- **Lokaal filter:** gemeente, plaats, postcode en lokale bedrijvenlijst.
- **Frequentie:** maandelijkse lijsten; inspectiepagina wekelijks.
- **Aanpak:** voer eerst een eenmalige scopecheck uit. Zijn er geen huidige of vergunde Seveso-inrichtingen in Amersfoort/Leusden, zet dan alleen een maandelijkse goedkope check aan. Parse XLSX/PDF en detail-HTML.
- **Nieuwswaarde:** één ernstige lokale overtreding is groot nieuws, maar verwacht zeer laag volume.
- **Eventtypes:** `SEVESO_SITE_ADDED`, `SEVESO_INSPECTION_PUBLISHED`, `SEVESO_VIOLATION_RECORDED`.

### P2.7 RIVM Samen Meten

- **API:** https://api-samenmeten.rivm.nl/v1.0/
- **Uitleg:** https://www.samenmeten.nl/dataportaal/api-application-programming-interface
- **Wat:** SensorThings-data voor onder meer fijnstof en andere lokale sensoren.
- **Lokaal filter:** geoquery op locaties binnen de gemeentegrenzen; de API ondersteunt `geo.distance`, maar polygonale selectie kan lokaal na ophalen.
- **Frequentie:** observaties per tien tot zestig minuten, afhankelijk van sensor.
- **Aanpak:** haal lokale `Things`, `Locations`, `Datastreams` en daarna incrementele `Observations` op via `@iot.nextLink`; pas kwaliteitslabels en kalibratie toe.
- **Nieuwswaarde:** alleen multi-sensor, langdurige anomalieën; geschikt als experimentele aanwijzing.
- **Harde regel:** één sensor is nooit zelfstandig nieuws. Vereis bijvoorbeeld minimaal drie nabijgelegen geschikte sensoren, >2 uur, consistente richting, voldoende datadekking en liefst bevestiging door officiële meetdata/weercontext.
- **Bronklasse:** `MEASUREMENT`; standaard review vereist.
- **Eventtypes:** `AIR_QUALITY_ANOMALY_CANDIDATE`.

---

## 8. Afvallers en beperkingen

### 8.1 Centraal Insolventieregister (CIR)

- **URL:** https://www.rechtspraak.nl/registers/webservice-centraal-insolventieregister
- **Waarom niet:** inhoudelijk zeer waardevol en kosteloos, maar de webservice vereist een abonnement/account en gebruiksvoorwaarden. Dat botst met het criterium zonder login.
- **Herbeoordelen wanneer:** Stadsgeest expliciet accounts voor gratis publieke diensten toestaat en voorwaarden juridisch/operationeel zijn beoordeeld.

### 8.2 EP-Online

- **URL:** https://ep-online.nl/PublicData
- **API-documentatie:** https://public.ep-online.nl/swagger/index.html
- **Waarom niet:** ook de publieke downloads en API vereisen een API-key.
- **Herbeoordelen wanneer:** API-keys binnen de broncriteria worden toegestaan.

### 8.3 KVK Open Dataset Basis Bedrijfsgegevens

- **URL:** https://developers.kvk.nl/nl/documentation/open-dataset-basis-bedrijfsgegevens-api
- **Waarom onvoldoende:** alleen BV/NV; geen bedrijfsnaam of bruikbaar volledig adres/KVK-nummer in de bulkset; slechts de eerste twee postcodecijfers. De API is bovendien vooral bruikbaar als het KVK-nummer al bekend is.
- **Gebruik dat wel kan:** een al publiek bekend KVK-nummer beperkt controleren, mits licentievoorwaarden en verbod op ongewenste herleidbaarheid worden gerespecteerd. Niet gebruiken als basis voor “alle bedrijven in Amersfoort”.

### 8.4 Omgevingsdienst Utrecht (ODU, voorheen ODRU/RUD) en VRU

- **Waarom niet:** geen betrouwbare openbare machineleesbare feed gevonden met individuele inspectieresultaten, handhavingscases of brandveiligheidsbevindingen.
- **Alternatief:** formele besluiten via KOOP; incidentele documenten via bestaande Woo-/publicatiebronnen. Bouw geen scraper van algemene nieuws- of persberichtpagina's als surrogaat.
- **Herbeoordelen:** halfjaarlijkse bronverkenning.

### 8.5 Vastgoedtransacties

- **URL:** https://www.kadaster.nl/-/inzicht-via-de-kaart-api-duplicaat-2
- **Waarom niet:** Koopsom API vereist Mijn Kadaster/API-key en kost per adres; bedrijfsmatige transacties zijn eveneens betaalde producten.
- **Alternatief:** als de bestaande BRK-ingang rechtmatig al transactie/koopsom levert, bouw het bedrag-/wijzigingssignaal daarop. Koop geen nieuwe bron zonder productbesluit.

---

## 9. Detectieregels

Implementeer regels eerst transparant en deterministisch. Een taalmodel mag bewijsvelden extraheren of een uitleg formuleren, maar niet beslissen dat een ontbrekend feit “waarschijnlijk” waar is.

### R1. Bedrijf krijgt vergunning voor extra loods of activiteit

```text
WHEN new_permit(event)
 AND event.category IN {bouw, milieu, gebruik, uitbreiding activiteit}
 AND event.address -> BAG match
 AND BAG address -> active entity location
 AND text/evidence indicates uitbreiding, loods, hal, productie, opslag,
     extra activiteit, capaciteit or oppervlakte
THEN create signal BUSINESS_EXPANSION_CANDIDATE
```

Verrijk met organisatie, huidige locaties, eerdere vergunningen op hetzelfde adres, eigenaar/gebruiker niet verwarren, en eventuele RVO-/TenderNed-projecten. Een adresmatch bewijst gebruik van de locatie, niet automatisch eigendom.

### R2. Bestuurder of RvT-lid duikt elders op

```text
WHEN relation PERSON --DIRECTOR_OF/SUPERVISOR_OF--> LOCAL_ORG is new
 AND same PERSON has a corroborated role at another organization
 AND other organization has a high-impact event or is itself locally important
THEN create signal GOVERNANCE_NETWORK_CHANGE
```

Vereis sterke persoonsresolutie. Bij alleen naamgelijkenis: review, geen signaal.

### R3. Landelijke sanctie tegen lokaal bedrijf

```text
WHEN source IN {ACM, AP, Arbeidsinspectie, AFM, DNB, SEVESO}
 AND event.type is sanction/violation/revocation
 AND subject entity has local relevance >= 65
THEN create signal NATIONAL_DECISION_LOCAL_IMPACT
```

Toon het relatiepad, bijvoorbeeld `sanctiepartij -> dochter van -> organisatie -> vestiging in Amersfoort`. Maximaal twee graph-hops voor automatische signalen; langere paden alleen na review.

### R4. Femke Bol of andere lokale publieke persoon in een onverwachte bron

```text
WHEN normalized person mention matches LOCAL_PUBLIC_PERSON
 AND source is factual/authoritative
 AND mention is subject/participant, not incidental boilerplate
 AND document is novel relative to existing media cluster
THEN create signal LOCAL_PERSON_IN_EXTERNAL_EVENT
```

De lokale band is een aparte bewezen relatie. Alleen een naamhit is onvoldoende; controleer context, rol en naamgenoten.

### R5. Anomalie in politiedata

Voor `(buurt, delictsoort, maand)`:

1. Vereis `count >= 5`.
2. Bereken verwacht aantal uit dezelfde kalendermaand in maximaal vijf voorgaande jaren, rollend twaalfmaandsgemiddelde en de ontwikkeling in de hele gemeente.
3. Corrigeer waar mogelijk voor gebieds-/bevolkingswijzigingen.
4. Trigger bij bijvoorbeeld `observed >= max(2 * expected, expected + 5)` én robuuste z-score boven ingestelde grens.
5. Vereis een tweede patroon: twee opeenvolgende maanden, meerdere naburige buurten, of duidelijke afwijking van de stadsbrede trend.

Formule en drempels moeten configureerbaar zijn en via backtesting worden gekalibreerd. Vermeld altijd dat het geregistreerde misdrijven betreft en dat kleine aantallen volatiel zijn.

### R6. Kinderopvang met nieuwe tekortkomingen

```text
WHEN new GGD report for local LRK location
 AND extracted finding indicates unmet requirement
 AND severity/advice suggests enforcement, order, fine, closure or removal
THEN signal CHILDCARE_INSPECTION_CONCERN
```

Bewaar letterlijke bewijsparagraaf en paginanummer. Laat AI onderscheid maken tussen tekortkoming, herstel na tekortkoming en definitief gemeentelijk besluit; bevestig met regels/statusvelden.

### R7. Grote of terugkerende Liander-storing

Trigger bij drempels uit de bronkaart. Cluster alle updates op storingsnummer. Maak één signaal dat wordt bijgewerkt; stuur alleen een tweede redactienotificatie bij materiële escalatie, grote vertraging of oplossing.

### R8. Veelgevraagde lokale spreker/maker

```text
WHEN person appears at >= 4 distinct public events
 AND >= 3 distinct organizers or venues
 AND within rolling 90 days
 AND person has corroborated local relation
THEN raise importance score and create optional discovery signal
```

Agenda-optredens zijn context, geen bewijs van bijzondere maatschappelijke betekenis. Dit signaal heeft standaard lage prioriteit.

### R9. Organisatieverandering uit registerdiff

Voor ANBI, GLEIF, DUO, LRK, AFM en DNB: maak alleen events van semantische wijzigingen. Een andere kolomvolgorde, bestandsdatum of whitespace is geen wijziging. Verwijdering uit een snapshot wordt pas `REMOVED` na bron-specifieke bevestiging, bijvoorbeeld twee succesvolle opeenvolgende snapshots of een expliciete status.

### R10. Multi-source versterking

Verhoog een signaal als binnen 30/60/90 dagen meerdere onafhankelijke bronnen hetzelfde project, adres of entiteit raken. Voorbeelden:

- bouwvergunning + RVO-subsidie + TenderNed-opdracht;
- festivalregistratie + NDW-maatregelen + evenementenvergunning;
- GGD-tekortkoming + houderwissel;
- nieuw RvT-lid + zorgjaarverantwoording + ACM/AP-event.

Bronnen die dezelfde officiële publicatie doorplaatsen tellen niet als onafhankelijk.

---

## 10. Ingestie, diffing, deduplicatie en provenance

### 10.1 Adaptercontract

Iedere bronadapter implementeert conceptueel:

```text
discover(cursor, window) -> SourceReference[]
fetch(reference, conditional_headers) -> RawObject
parse(raw_object) -> SourceRecord[]
normalize(source_record) -> CanonicalRecord
diff(previous, current) -> Change[]
emit(change) -> EntityCandidate[] + RelationCandidate[] + Event[]
health(fetch_run_history) -> HealthStatus
```

### 10.2 Source manifest

Voorbeeld:

```yaml
id: nlarbeidsinspectie_eerlijk_werk
authority_class: AUTHORITATIVE_EVENT
schedule: "daily"
expected_update_interval_hours: 48
fetch:
  type: html_paginated
  timeout_seconds: 30
  max_requests_per_minute: 20
  overlap_days: 30
identity:
  source_key: detail_url
diff:
  semantic_fields:
    - inspected_organization
    - chamber_of_commerce_number
    - inspection_location
    - inspection_date
    - laws
    - violations
    - sanction
    - legal_status
local_filters:
  places: [Amersfoort, Leusden]
retention:
  raw: permanent
  normalized_versions: permanent
```

Maak planning intern in de bestaande scheduler; neem bovenstaande YAML alleen over als dat bij de codebase past.

### 10.3 Snapshot en diff

- Bewaar de ruwe response vóór parsing.
- Gebruik `ETag` en `Last-Modified` als optimalisatie, niet als enige wijzigingsdetectie.
- Bereken een cryptografische content hash van ruwe bytes.
- Bereken daarnaast een semantische hash van genormaliseerde betekenisvolle velden.
- Maak veldniveau-diffs en classificeer `added`, `changed`, `removed`, `corrected`, `retracted`.
- Gebruik overlappende tijdvensters; bronnen corrigeren vaak achteraf.
- Beschouw een lege response nooit automatisch als een geldige lege dataset.
- Bevestig bulkverwijderingen pas na een tweede succesvolle run en bron-specifieke plausibiliteitscontrole.

### 10.4 Deduplicatie

**Binnen een bron**

1. officiële ID;
2. stabiele detail-URL;
3. samengestelde natuurlijke sleutel;
4. pas als laatste content hash.

**Tussen bronnen**

Bereken event-similarity uit:

- gedeelde officiële zaak-/publicatie-ID;
- dezelfde primaire entiteit;
- zelfde adres/geometrie;
- tijdsafstand;
- document-/titelsimilarity;
- gelijk eventtype en betrokken rollen.

Voorstel:

- harde gedeelde identifier: automatisch hetzelfde eventcluster;
- anders similarity >=0,90: automatisch clusteren;
- 0,75–0,89: review of voorlopig gerelateerd;
- <0,75: los event.

Bewaar alle bronrecords in het cluster. Kies niet één bron en gooi de rest weg.

### 10.5 Provenancepakket per event/signaal

Minimaal:

- bronnaam en authority class;
- canonical URL en eventuele document-URL;
- bronidentifier/zaaknummer;
- `published_at`, `occurred_at`, `fetched_at`;
- raw object hash en opslaglocatie;
- parserversie en modelversie;
- gebruikte velden en korte bewijsfragmenten/paginanummers;
- entity-matchmethode en confidence;
- relatiepad waarmee lokale relevantie is vastgesteld;
- eventuele correctie, bezwaar-/beroepsstatus of onzekerheid.

---

## 11. Monitoring en foutafhandeling

### 11.1 Health checks

Per bron bijhouden:

- laatste succesvolle fetch en parse;
- HTTP-status/verbindingsfout;
- aantal records versus 7-/30-run baseline;
- percentage parsefouten;
- ontbrekende verplichte velden;
- schema-/headerwijzigingen;
- ouderdom van nieuwste bronrecord;
- aantal pagina's/bestandsgrootte;
- `robots.txt`, licentie en gebruiksvoorwaarden laatst gecontroleerd.

### 11.2 Niet stil falen

Markeer een run als fout of verdacht bij:

- loginpagina/captcha in plaats van data;
- HTML waar CSV/XML/JSON werd verwacht;
- recordvolume <20% of >500% van normale bandbreedte;
- alle identifiers plots leeg;
- onverwachte charset/delimiter;
- meer dan 5% parsefouten;
- ontbrekende pagina in paginering;
- bulkverwijdering zonder expliciete bronstatus.

### 11.3 Herstel

- retries met exponentiële backoff en jitter;
- respecteer `Retry-After`;
- circuit breaker na herhaalde bronfouten;
- laatste goede snapshot blijft current, maar wordt als stale gemarkeerd;
- mislukte records in quarantine/dead-letter queue met reproduceerbare raw input;
- herverwerken moet kunnen zonder opnieuw downloaden;
- parserversies moeten historische raw objects opnieuw kunnen verwerken.

### 11.4 Operationele meldingen

Maak een dagelijks bronstatusoverzicht. Alarmeer direct bij:

- P0-bron langer dan 2× verwachte update- of fetchfrequentie stuk;
- authenticatie/captcha/robots-wijziging;
- massale schemawijziging;
- onverklaarde bulkverwijdering;
- opslag- of provenancefout.

---

## 12. Fasering en technische taken

### Fase 0 — inventarisatie en contracten

**Doel:** weten hoe de huidige Stadsgeest werkt en regressies voorkomen.

- [ ] Repository, runtime, database, scheduler, queues en huidige adapters beschrijven.
- [ ] Bestaande brondekking en event-/signaalmodel inventariseren.
- [ ] Duplicatie-audit voor `overheid.nl`/KOOP uitvoeren.
- [ ] Meet huidige BAG-matchrate, duplicate rate, parser failure rate en signaalvolume.
- [ ] Migratieplan en feature flags definiëren.
- [ ] Datamodelmigraties met rollback maken.
- [ ] Adaptercontract, source manifest en provenancecontract vastleggen.
- [ ] Testfixturestandaard en mock HTTP-laag toevoegen.

**Exit:** migraties draaien in test, bestaande pipeline blijft groen, baselinecijfers zijn vastgelegd.

### Fase 1 — entiteitenfundament

**Doel:** lokale organisaties en locaties betrouwbaar kunnen herkennen.

- [ ] `entities`, `identifiers`, `aliases`, `locations`, `entity_locations`, `relations` en auditlog implementeren.
- [ ] BAG-adresnormalisatie en PostGIS-geofilter implementeren.
- [ ] ANBI-adapter bouwen.
- [ ] GLEIF-adapter bouwen.
- [ ] OSM/Overpass contextadapter bouwen.
- [ ] Handmatige seedimport maken voor grote werkgevers, DierenPark Amersfoort, podia, festivals, sportclubs, zorginstellingen, scholen en andere redactioneel belangrijke organisaties.
- [ ] Elke handmatige seed verplicht voorzien van bron-URL, reden, datum en reviewdatum.
- [ ] Entity resolver met merge/review/unmerge bouwen.
- [ ] Reviewinterface of minimaal beheercommand/API voor kandidaten leveren.

**Exit:** een zoekbare lokale graph met aantoonbare provenance; organisatie- en vestigingsmatches werken op golden set.

### Fase 2 — eerste eventbronnen en graph matching

**Doel:** aantonen dat de entiteitenlaag nieuwe tips oplevert.

- [ ] Arbeidsinspectie Eerlijk werk.
- [ ] LRK-diff en gerichte GGD-rapportcrawler.
- [ ] Liander ArcGIS.
- [ ] Tuchtrecht SRU.
- [ ] Asbestovertredingen.
- [ ] ACM RSS/detail/PDF.
- [ ] AP sanctie/detail/PDF.
- [ ] Bestaande vergunningevents aan BAG en lokale entiteiten koppelen.
- [ ] Detectieregels R1, R2, R3, R4, R6, R7 en R9 implementeren.
- [ ] Signaalweergave uitbreiden met relatiepad en bewijs.

**Exit:** end-to-end demo van minimaal vijf echte of historisch gereplayde signalen die zonder graph niet gevonden zouden zijn.

### Fase 3 — sectorregisters en statistiek

**Doel:** lokale infrastructuur verbreden en afwijkingen vinden.

- [ ] KOOP-auditbesluit uitvoeren: bestaande adapter uitbreiden of nieuwe SRU-adapter.
- [ ] DUO BO/VO.
- [ ] AFM.
- [ ] DNB.
- [ ] Politie/CBS met gebiedsversies en anomaliedetector.
- [ ] NDW.
- [ ] RVO.
- [ ] Detectieregels R5 en R10 implementeren.
- [ ] Backtesting en drempelkalibratie op minimaal 24 maanden politie- en eventdata.

**Exit:** maandelijkse anomalieën zijn uitlegbaar en het systeem produceert geen tips door alleen een nieuwe datamaand of bestandsversie.

### Fase 4 — periodieke en experimentele bronnen

**Doel:** langzame maar journalistiek rijke veranderingen en zachte context toevoegen.

- [ ] Jaarverantwoording Zorg.
- [ ] dPi woningcorporaties.
- [ ] Tijd voor Amersfoort.
- [ ] Evenementenkalender.
- [ ] Rijksmonumentenregister.
- [ ] SEVESO+ scopecheck en adapter.
- [ ] RIVM Samen Meten achter experimentele feature flag.
- [ ] Bestuur/RvT-extractie uit openbare organisatiepagina's en documenten.
- [ ] Regel R8 en sectorspecifieke jaar-op-jaarregels.

**Exit:** langzame bronnen zijn versieerbaar, hun schemawijzigingen zijn afgevangen en zachte bronnen kunnen geen harde automatische claims genereren.

### Fase 5 — redactionele leerloop

**Doel:** kwaliteit meten en rankings op echte redactiekeuzes verbeteren.

- [ ] Feedbackknoppen: `bruikbaar`, `bekend`, `niet lokaal`, `te zwak`, `duplicaat`, `feitelijk fout`.
- [ ] Redencodes en vrije notitie opslaan.
- [ ] Dashboards voor precision, duplicate rate, bronbijdrage en ongebruikte signalen.
- [ ] Scores eerst handmatig/regelmatig kalibreren; pas later een geleerd rankmodel gebruiken.
- [ ] Maandelijkse review van false positives, gemiste entiteiten en brongezondheid.

**Exit:** aantoonbare verbetering tegenover de baseline zonder verlies van provenance of uitlegbaarheid.

---

## 13. Rol van AI

### 13.1 Wel gebruiken voor

- documenttype en eventtype classificeren;
- organisaties, personen, rollen, bedragen, data en adressen uit vrije tekst/PDF extraheren;
- bewijsfragmenten en paginanummers aanwijzen;
- semantische vergelijking van twee versies nadat deterministische diff een wijziging vond;
- kandidaat-entity matches rangschikken;
- redactiesamenvatting schrijven op basis van reeds vastgelegde feiten;
- uitleg geven waarom een signaal lokaal en nieuwswaardig is.

### 13.2 Niet gebruiken voor

- bepalen of een fetch compleet was;
- verzinnen of reconstrueren van ontbrekende identifiers;
- geocoderen wanneer BAG/geometry beschikbaar is;
- automatisch mergen van naamgelijke personen;
- besluiten dat een organisatie eigenaar van een pand is op basis van alleen adresgebruik;
- sanctiestatus, bezwaar of definitieve rechtskracht invullen zonder bronbewijs;
- statistische anomalieën berekenen; AI mag de berekening uitleggen, niet vervangen.

### 13.3 Verplicht AI-outputcontract

Gebruik schema-gevalideerde JSON. Voor ieder geëxtraheerd feit:

```json
{
  "field": "sanction_type",
  "value": "last onder dwangsom",
  "confidence": 0.96,
  "evidence": {
    "raw_object_id": "...",
    "page": 4,
    "text_span": "...",
    "start_offset": 1220,
    "end_offset": 1250
  }
}
```

Feiten zonder evidence worden verworpen. Modelnaam, promptversie en extractieschemaversie worden opgeslagen.

---

## 14. Human in the loop

### Altijd reviewen

- persoonsmerge zonder harde unieke combinatie;
- beschuldigingen/sancties met onduidelijke juridische status;
- lokale relevantie alleen via twee graph-hops;
- zachte bron als belangrijke aanleiding;
- sensor- of statistisch signaal met klein aantal;
- conflicterende adressen, KVK/RSIN/LEI of organisatienamen;
- mogelijke privacygevoelige persoonsinformatie;
- eerste drie productiesignalen van een nieuwe bronadapter.

### Reviewweergave

Toon naast elkaar:

- kandidaat-entiteiten en hun identifiers;
- bronfragmenten;
- adressen/geografie;
- huidige en voorgestelde relaties;
- matchscore met afzonderlijke bijdragen;
- wat het systeem zal doen bij accepteren/afwijzen;
- `merge`, `link zonder merge`, `afwijzen`, `do_not_merge`, `later`.

### Redactionele tip

Een tip toont:

- feitelijke kop;
- waarom nu;
- lokale relatie in één zin;
- betrokken organisaties/personen/locaties;
- bronlinks en publicatiedata;
- concrete bewijsregels;
- onzekerheden en juridische status;
- eventueel gerelateerde eerdere events;
- score-uitleg, niet alleen een getal.

---

## 15. Testgevallen

Maak alle onderstaande gevallen als vaste, synthetische of geanonimiseerde fixtures. Gebruik historische echte pagina's alleen wanneer licentie en testopslag dat toestaan.

### T1 Vergunning extra loods

- Nieuw vergunningrecord noemt `Nijverheidsweg 12` en “uitbreiden bedrijfsruimte met opslagloods”.
- BAG koppelt adres aan pand/VBO.
- Graph bevat organisatie X als actuele gebruiker van dit adres.
- **Verwacht:** één `BUSINESS_EXPANSION_CANDIDATE`, lokaal pad zichtbaar, geen claim dat X eigenaar is.

### T2 Adres zonder bedrijfsmatch

- Zelfde vergunning, maar geen betrouwbare entity-location.
- **Verwacht:** lokaal vergunningevent blijft bestaan; geen bedrijfsnaam verzinnen; optioneel entity-resolution review.

### T3 Bestuurder met naamgenoot

- Twee personen heten “J. de Vries”, met verschillende organisaties en geen aanvullend bewijs.
- **Verwacht:** niet mergen; review; geen governance-signaal.

### T4 Bestuurder met sterke match

- Volledige naam, rol, overlappende organisatiebiografie en tweede openbare bron komen overeen.
- **Verwacht:** relatiekandidaat met hoge confidence; na policy eventueel automatische link, auditlog aanwezig.

### T5 Landelijke ACM-sanctie zonder plaatsnaam

- ACM-document noemt lokale onderneming X, maar niet Amersfoort.
- Graph bevat LEI/KVK/alias en actieve lokale vestiging.
- **Verwacht:** lokaal relevant signaal, relatiepad en zaaknummer zichtbaar.

### T6 Landelijke moeder, lokale dochter

- AP-besluit treft moeder M; M `PARENT_OF` lokale dochter D.
- **Verwacht:** lokale score lager dan directe sanctie tegen D maar boven drempel bij sterke relatie; review bij indirecte impact.

### T7 Femke Bol en naamcontext

- Autoritatieve bron noemt Femke Bol als betrokkene; document noemt Amersfoort niet.
- Graph bevat sterke publieke lokale relatie en alias.
- **Verwacht:** lokale-persoonssignalering.
- Negatieve variant: tekst bevat alleen een lijst/boilerplate of een naamgenoot; geen signaal.

### T8 Politie kleine aantallen

- Buurt stijgt van 1 naar 3 incidenten (+200%).
- **Verwacht:** geen anomaliesignaal wegens minimumaantal.

### T9 Politie robuuste stijging

- Bedrijfsinbraken stijgen naar 14, verwachting 5, tweede maand verhoogd, stadsbrede trend vlak.
- **Verwacht:** één uitlegbaar anomaliesignaal met absolute aantallen, baseline en waarschuwing over registratiedata.

### T10 Liander statusreeks

- Dezelfde storing verschijnt zes keer met veranderende eindtijd en uiteindelijk opgelost.
- **Verwacht:** één eventcluster en één signaal; update/escalatie volgens drempel, geen zes duplicaten.

### T11 LRK houderwissel en GGD-rapport

- Zelfde LRK-ID, nieuwe houder/KVK; nieuwe PDF met ernstige tekortkoming.
- **Verwacht:** twee events, één samengesteld hoogwaardig signaal indien tijdsrelatie relevant is; bewijs met PDF-pagina.

### T12 OSM-naamswijziging

- OSM-gebruiker wijzigt naam van een locatie.
- **Verwacht:** candidate/review, geen hard nieuwsfeit en geen automatische verwijdering van bestaande entiteit.

### T13 Bulkbestand tijdelijk leeg

- ANBI/LRK/AFM-download levert geldig HTTP 200 maar nul records.
- **Verwacht:** run `suspicious/failed`, geen duizenden removal events, laatste goede snapshot blijft current.

### T14 Parserwijziging

- Kolomnaam verandert of PDF-layout schuift.
- **Verwacht:** contracttest faalt duidelijk, raw object blijft beschikbaar, bronhealth rood, geen stille gedeeltelijke verwerking.

### T15 Correctie en rechtsstatus

- Sanctiepagina wordt later aangepast na bezwaar.
- **Verwacht:** bestaand event krijgt nieuwe versie/status en correctieprovenance; eerder signaal wordt bijgewerkt, niet verdubbeld.

---

## 16. Acceptatiecriteria

### Datakwaliteit

- 100% van productie-events heeft bron-ID/URL, raw object, fetchdatum en parserversie.
- 100% van harde lokale matches toont het relatiepad en matchbewijs.
- Geen automatische persoonsmerge op naam alleen.
- Geen bulkverwijderingen na één lege of mislukte fetch.
- Alle tijden worden intern in UTC opgeslagen en bij presentatie correct naar Europe/Amsterdam vertaald.
- Historische namen, locaties en relaties blijven bevraagbaar.

### Betrouwbaarheid

- Twee identieke runs zijn idempotent: geen extra events/signalen.
- Statusupdates van één bronrecord vormen versies van hetzelfde event.
- P0-bronnen hebben contracttests, fixtures en health checks.
- Een parser kan opgeslagen raw objects opnieuw verwerken zonder netwerkverkeer.
- Schema drift veroorzaakt een zichtbare fout, geen stille dataverlies.

### Entity resolution

- Op een handmatig gelabelde golden set van minimaal 200 organisatiematches: precision >=98% voor automatische merges.
- Op minimaal 100 persoonskandidaten: geen bekende false-positive automatische merges; twijfel gaat naar review.
- Iedere merge is uitlegbaar en terug te draaien.

### Signalering

- Minimaal R1, R2, R3, R4, R5, R6 en R7 werken end-to-end.
- Cross-source duplicate rate <5% op een redactionele pilotset.
- Elk signaal heeft score-uitleg en concrete bewijsvelden.
- Zachte contextbronnen kunnen zonder bevestiging geen harde sanctie-, overtredings- of eigendomsclaim genereren.
- Politie-anomalieën tonen absolute aantallen en onderdrukken procentuele uitschieters bij kleine aantallen.

### Productwaarde

- Replay van minimaal 90 dagen levert minstens vijf valide signalen op die de bestaande plaatsnaam-/documentroute niet vond.
- Redactie kan per tip aangeven: bruikbaar, bekend, niet lokaal, te zwak, duplicaat of feitelijk fout.
- Na een pilot van vier weken worden precision, bronnenbijdrage en meest voorkomende afwijsredenen gerapporteerd; drempels worden op basis daarvan bijgesteld.

---

## 17. Definition of Done per bron

Een bron is pas “klaar” wanneer:

- [ ] URL, licentie/voorwaarden, owner en updatefrequentie zijn vastgelegd.
- [ ] Adapter rate limits, timeouts, retries en conditional requests gebruikt.
- [ ] Raw response onveranderd wordt bewaard.
- [ ] Parser minimaal normale, lege, foutieve en gewijzigde fixtures heeft.
- [ ] Stabiele bronkey en semantische hash zijn gedefinieerd.
- [ ] Lokale filter is getest op Amersfoort én Leusden.
- [ ] Add/change/remove/correction-gedrag is getest.
- [ ] Entity candidates en eventtypes een schema hebben.
- [ ] Provenance volledig is.
- [ ] Deduplicatie met bestaande bronnen is getest.
- [ ] Health thresholds en alerting actief zijn.
- [ ] Eerste drie productieresultaten handmatig zijn beoordeeld.
- [ ] Runbook beschrijft hoe te backfillen en hoe parserfouten te herstellen.

---

## 18. Eerste concrete bouwsprint

Als startopdracht aan Claude:

1. Maak de current-state-analyse en meet BAG-/KOOP-dekking.
2. Voeg het kernschema voor entities, identifiers, aliases, locations, relations, provenance en review toe.
3. Bouw BAG-normalisatie en de organization resolver.
4. Importeer ANBI, GLEIF en OSM voor Amersfoort/Leusden.
5. Voeg een kleine handmatige seedset toe met minimaal:
   - grote werkgevers en hoofdkantoren/kantoren;
   - DierenPark Amersfoort;
   - Meander Medisch Centrum en belangrijke lokale zorgaanbieders;
   - Flint, FLUOR, De Lieve Vrouw en grote festivals;
   - scholen/schoolbesturen, woningcorporaties en sportclubs;
   - redactioneel relevante publieke personen, waaronder Femke Bol, uitsluitend met openbare bron en lokale-relatiebewijs.
6. Koppel historische vergunningrecords aan BAG en de seedgraph.
7. Implementeer detectieregel R1 en replay minimaal 90 dagen.
8. Laat de redactie tien resultaten beoordelen voordat andere detectieregels worden geactiveerd.

**Eerste demonstratie:** toon drie vergunningevents op bedrijfsadressen, inclusief BAG-match, organisatie, relatiepad, confidence, bewijs en waarom wel/geen uitbreidingssignaal is gemaakt.

---

## 19. Bronverificatie en onderhoud

De URL's en eigenschappen in dit document zijn op 4 september 2026 gecontroleerd aan de hand van officiële bronpagina's en catalogi. Externe bronnen veranderen. Neem daarom in `sources` ook `last_verified_at`, `terms_checked_at` en `owner_contact` op. Hercontroleer minimaal ieder halfjaar:

- bron-URL en redirect;
- robots/voorwaarden/licentie;
- updatefrequentie;
- schema en identifiers;
- beschikbaarheid van een betere API/feed;
- of een eerder afgevallen bron inmiddels zonder login/key/betaling beschikbaar is;
- of twee bronnen inmiddels dezelfde dataset dupliceren.

Het systeem moet niet streven naar “alle bedrijven en personen”. Door de beperkingen van gratis KVK-data is volledigheid onhaalbaar. Streef naar een transparant, groeiend en journalistiek bruikbaar lokaal netwerk met aantoonbare herkomst, hoge matchprecisie en een redactionele leerloop.
