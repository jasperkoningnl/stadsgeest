"""NER-worker voor Stadsgeest (spoor 1).

Leest JSON-regels van stdin: {"id": <raw_item_id>, "text": "<analysetekst>"}
Schrijft JSON-regels naar stdout: {"id": ..., "raw": n, "kept": [...], "dropped": {...}}

Heeft bewust geen databasetoegang en geen netwerk: de Node-runner
(src/extract-ner.cjs) doet alle I/O. Eerste regel op stdout is een
header met de modelversie, zodat de runner die kan vastleggen.
"""
import json
import re
import sys

import spacy

FILTER_VERSION = "filter-7"
MAX_CHARS = 50_000

LABEL_MAP = {
    "PERSON": "person",
    "ORG": "organization",
    "GPE": "location",
    "LOC": "location",
    "FAC": "location",
}

# Documentstructuur en boilerplate uit B&W-, raads- en Woo-pagina's.
# Genormaliseerd (lowercase). Uitbreiden na review.
STOPLIST = {
    "college", "raad", "gemeenteraad", "raad van", "collegekamer",
    "collegevoorstellen", "collegevoorstel", "invitaties", "bijlage",
    "bijlages", "bijlagen", "bronbestand", "inventarislijst",
    "geanonimiseerd", "omgevingsprogramma", "bevoegdhedenbesluit",
    "odt-formaat", "besluitenlijst", "raadsvoorstel", "raadsinformatiebrief",
    "omgevingswetprocedures", "actiesauthentieke versie", "informatiepermanente",
    "verkeersaanpassingen", "ozb", "woo", "wmo", "bw", "b&w",
    "algemene", "oost", "west", "noord", "zuid", "amersfoorter", "amersfoorters",
    "bibliotheek", "poet", "grop", "risa", "vog", "dat", "partij", "concreet",
    "or", "raad commissie", "raad geen", "amersfoortse",
}
TRAILING_FUNCTION_WORDS = {"van", "de", "het", "der", "den", "voor", "en", "in", "op", "t"}
# Formulier- en documentwoorden: een span met een van deze tokens is vrijwel
# altijd een stuk kop of metadata ('Appelweg Datum', 'Noord Raadsvoorstel').
DOC_WORDS = {
    "datum", "kenmerk", "onderwerp", "zaaknummer", "versie", "pagina",
    "raadsvoorstel", "collegevoorstel", "bijlage", "bijlages", "besluit",
    "raadsinformatiebrief", "agendapunt", "kosten", "gevolgen",
    "communicatieboodschap", "risicoparagraaf", "participatiegids", "vergadering",
    "gesplitst", "abonneert", "voorlopig", "ontwerp", "review", "loofboom",
    "wet", "opsteller", "portefeuillehouder", "locatie",
    "geen", "kennis", "directeur", "kaderstellende", "gemeentearchivaris",
    "nl", "bso", "hersteluitspraak", "groen",
    "collegebericht", "schriftelijke", "bespreekpunt", "adviesrecht",
}
# Namen van regelingen, programma's en documenten zijn geen actoren of plekken.
DOC_SUFFIXES = ("wet", "besluit", "verordening", "regeling", "programma", "gids",
                "paragraaf", "boodschap", "plaag", "markt", "feest", "visie", "plan",
                "beurs", "uitspraak")
# Plaatsnamen die in dit corpus geen informatie toevoegen.
TRIVIAL_LOCATIONS = {"amersfoort", "nederland"}
# Komt in vrijwel elke bekendmaking voor (afzender of bezwaarclausule) en voegt
# niets toe; de aliasextractie vangt de gemeente al.
TRIVIAL_ANY = {"amersfoort", "alvast bedankt", "gemeente amersfoort",
               "rechtbank midden-nederland", "midden-nederland",
               "college van b. & w.", "stad amersfoort", "de stad amersfoort"}
STREET_SUFFIXES = ("straat", "weg", "laan", "plein", "kade", "gracht", "singel",
                   "dijk", "steeg", "hof", "pad", "dreef", "erf", "park")

RE_FILE = re.compile(r"\.(pdf|docx?|odt|xlsx?|html?|txt|zip)$", re.I)
RE_GLUED = re.compile(r"[a-zà-ÿ][A-Z]")          # 'ActiesAuthentieke', 'informatiePermanente'
RE_CODE = re.compile(r"^[A-Z]{1,4}-?\d")          # 'CLZ-00034839', 'V25'
RE_GEMEENTE = re.compile(r"^gemeente\s+\S", re.I)
RE_PUNCT = re.compile(r"[·\[\]|…!?@#*+=<>{}\\]|[\U0001F000-\U0001FFFF\u2600-\u27BF]")
RE_QUOTE = re.compile(r"[\"',;:()]")
RE_LETTER_DIGIT = re.compile(r"[A-Za-z]\d|\d[A-Za-z]")
RE_COMPANY = re.compile(r"\b(B\.?V\.?|N\.?V\.?|V\.?O\.?F\.?|U\.?A\.?)$")
RE_ADDRESS = re.compile(r"^[A-Z][\w\-]+(" + "|".join(("straat", "weg", "laan", "plein", "kade", "gracht", "singel", "dijk", "steeg", "hof", "pad", "dreef", "erf", "park", "ring")) + r")\s+\d+[a-zA-Z]?$")
RE_ROMAN = re.compile(r"^[IVXLC]{1,6}\.?$")
RE_MEASURE = re.compile(r"^ca\.?\s", re.I)
RE_POSTCODE_TAIL = re.compile(r"^[A-Z]{2}\s+[A-Z]")      # 'HN Amersfoort' uit '3811 HN Amersfoort'


def norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip()


def classify(ent, doc_text):
    """Geeft (entity_type, None) terug, of (None, reden) als de span ruis is."""
    label = ent.label_
    etype = LABEL_MAP.get(label)
    if etype is None:
        return None, "label"
    text = ent.text.strip()
    n = norm(text)
    tokens = [t for t in ent if not t.is_space]

    if len(text) < 2 or not any(c.isalpha() for c in text):
        return None, "te_kort"
    if text[0].isdigit():
        return None, "begint_met_cijfer"
    if sum(c.isdigit() for c in text) / len(text) > 0.2:
        return None, "cijfers"
    if "_" in text or RE_FILE.search(text):
        return None, "bestandsnaam"
    if RE_CODE.match(text):
        return None, "code"
    if RE_GLUED.search(text) and " " not in text and not text.isupper():
        # aan elkaar geplakte woorden uit HTML-extractie; 'KeiHart' valt hier ook onder
        return None, "geplakt"
    if RE_PUNCT.search(text) or RE_QUOTE.search(text) or not text[0].isalnum() or text[-1] in "-/":
        return None, "leesteken"
    if RE_LETTER_DIGIT.search(text) and not RE_ADDRESS.match(text):
        return None, "letter_cijfer"
    if len(tokens) == 1 and text.isupper() and len(text) <= 4 and re.match(r"\s+\d", doc_text[ent.end_char:ent.end_char + 3]):
        return None, "code"
    if RE_MEASURE.match(text):
        return None, "maat"
    if len(tokens) == 1 and text.isupper() and len(text) > 4:
        return None, "hoofdletterwoord"
    if etype == "organization" and len(tokens) == 1 and len(text) <= 4 and not text.isupper():
        return None, "kort_woord"
    if ent.end_char < len(doc_text) and doc_text[ent.end_char].isalpha():
        return None, "afgebroken_woord"
    if ent.start_char > 0 and doc_text[ent.start_char - 1].isalpha():
        return None, "afgebroken_woord"
    if text[0].islower() and not RE_GEMEENTE.match(text):
        return None, "kleine_letter"
    if RE_POSTCODE_TAIL.match(text):
        return None, "postcoderest"
    if any(norm(t.text) in DOC_WORDS for t in tokens):
        return None, "documentwoord"
    if any(norm(t.text).endswith(DOC_SUFFIXES) for t in tokens):
        return None, "regeling_of_document"
    if RE_ROMAN.match(text):
        return None, "romeins_cijfer"
    if sum(1 for t in tokens if t.text[:1].islower()) >= 3:
        return None, "zinsfragment"
    if "\n" in ent.text:
        return None, "over_regelgrens"
    if n in STOPLIST:
        return None, "stoplijst"
    if len(tokens) > 6:
        return None, "te_lang"
    if len(tokens) > 1 and norm(tokens[-1].text) in TRAILING_FUNCTION_WORDS:
        return None, "losse_staart"
    if len(tokens) > 1 and len(tokens[-1].text) == 1 and tokens[-1].text.isalpha():
        return None, "afbreekfout"

    if RE_ADDRESS.match(text):
        etype = "location"
    elif etype == "person" and RE_COMPANY.search(text):
        etype = "organization"

    if etype == "person":
        # Eén token ('France', 'Van Ring' is twee) is te zwak voor een persoon.
        if len(tokens) < 2:
            return None, "persoon_een_token"
        if norm(tokens[-1].text).endswith(STREET_SUFFIXES):
            return None, "straatnaam"
    if etype == "location" and RE_GEMEENTE.match(text):
        # 'Gemeente Amersfoort' is in deze teksten vrijwel altijd de organisatie.
        etype = "organization"
    if n in TRIVIAL_ANY:
        return None, "triviaal"
    if etype == "location" and len(tokens) == 1 and re.search(r"(ies|eurs|ers)$", n):
        return None, "meervoud"
    if etype == "location" and n in TRIVIAL_LOCATIONS:
        return None, "triviaal"
    return etype, None


def main():
    nlp = spacy.load("nl_core_news_lg", exclude=["lemmatizer"])
    version = f"spacy-{spacy.__version__}/nl_core_news_lg-{nlp.meta['version']}/{FILTER_VERSION}"
    print(json.dumps({"header": True, "model_version": version, "max_chars": MAX_CHARS}), flush=True)

    def records():
        for line in sys.stdin:
            line = line.strip()
            if line:
                yield json.loads(line)

    def texts(recs):
        for r in recs:
            yield r["text"][:MAX_CHARS], r

    for doc, rec in nlp.pipe(texts(records()), as_tuples=True, batch_size=8):
        kept, dropped, by_key = [], {}, {}
        raw = 0
        for ent in doc.ents:
            if ent.label_ not in LABEL_MAP:
                continue
            raw += 1
            etype, reason = classify(ent, doc.text)
            if reason:
                dropped[reason] = dropped.get(reason, 0) + 1
                continue
            key = (etype, norm(ent.text))
            if key in by_key:
                by_key[key]["occurrences"] += 1
                continue
            item = {
                "text": ent.text.strip(),
                "norm": norm(ent.text),
                "type": etype,
                "label": ent.label_,
                "start": ent.start_char,
                "end": ent.end_char,
                "occurrences": 1,
            }
            by_key[key] = item
            kept.append(item)
        out = {
            "id": rec["id"],
            "raw": raw,
            "kept": kept,
            "dropped": dropped,
            "truncated": len(rec["text"]) > MAX_CHARS,
        }
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
