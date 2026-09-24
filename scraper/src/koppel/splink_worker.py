# Splink-worker voor de organisatiekoppeling (docs/KOPPELING.md).
#
# Leest op stdin JSON {"records": [...]} met per record uid, naam_norm, postcode,
# huisnr en plaats (genormaliseerd door koppel/normaliseer.cjs). Schrijft op
# stdout JSON {"paren": [[uid_l, uid_r, kans], ...], "model": {...}}.
# Geen database en geen netwerk: alle I/O doet koppel-organisaties.cjs.
#
# Gewichten staan vast. De EM-training van Splink leerde op deze dunne data
# onzinnige gewichten (proef 23-9-2026: een exacte naam kreeg m = 0,09). Alleen
# de u-waarden worden geschat, via random sampling met een vaste seed, zodat
# dezelfde invoer dezelfde uitvoer geeft.
import json
import sys

import pandas as pd
from splink import DuckDBAPI, Linker, SettingsCreator, block_on
import splink.comparison_library as cl

MODEL_VERSIE = 'splink-4.0.17/vast-v1'
DREMPEL_PAREN = 0.2


def main():
    invoer = json.load(sys.stdin)
    records = invoer['records']
    if len(records) < 2:
        json.dump({'paren': [], 'model': {'versie': MODEL_VERSIE, 'records': len(records)}}, sys.__stdout__)
        return
    df = pd.DataFrame([{k: r.get(k) for k in ('uid', 'naam_norm', 'postcode', 'huisnr', 'plaats')} for r in records])
    settings = SettingsCreator(
        link_type='dedupe_only',
        unique_id_column_name='uid',
        probability_two_random_records_match=2e-4,
        blocking_rules_to_generate_predictions=[
            block_on('naam_norm'),
            block_on('postcode', 'huisnr'),
            block_on('substr(naam_norm,1,7)', 'plaats'),
            block_on('substr(naam_norm,1,10)'),
        ],
        comparisons=[
            cl.JaroWinklerAtThresholds('naam_norm', [0.97, 0.9]).configure(m_probabilities=[0.6, 0.15, 0.15, 0.10]),
            cl.ExactMatch('postcode').configure(m_probabilities=[0.7, 0.3]),
            cl.ExactMatch('huisnr').configure(m_probabilities=[0.8, 0.2]),
            cl.ExactMatch('plaats').configure(m_probabilities=[0.9, 0.1]),
        ],
        retain_intermediate_calculation_columns=True,
    )
    linker = Linker(df, settings, db_api=DuckDBAPI())
    linker.training.estimate_u_using_random_sampling(max_pairs=2e6, seed=42)
    pred = linker.inference.predict(threshold_match_probability=DREMPEL_PAREN).as_pandas_dataframe()
    # Per paar ook de vergelijkingsniveaus (gamma): naam 3 = exact, 2 = JW >= 0,97,
    # 1 = JW >= 0,9, 0 = anders; overige velden 1 = gelijk, 0 = anders, -1 = leeg.
    # De clustering in Node eist daarmee dat de naam lijkt; een gedeeld adres
    # alleen is geen zelfde organisatie (bedrijfsverzamelgebouw).
    def g(kolom):
        return [int(x) for x in pred[kolom]]
    paren = [[int(a), int(b), round(float(p), 4), gn, gp, gh, gpl] for a, b, p, gn, gp, gh, gpl in
             zip(pred['uid_l'], pred['uid_r'], pred['match_probability'],
                 g('gamma_naam_norm'), g('gamma_postcode'), g('gamma_huisnr'), g('gamma_plaats'))]
    json.dump({'paren': paren, 'model': {'versie': MODEL_VERSIE, 'records': len(records), 'drempel_paren': DREMPEL_PAREN}}, sys.__stdout__)


if __name__ == '__main__':
    # Alles wat Splink of DuckDB zelf print, gaat naar stderr; stdout is alleen voor
    # het JSON-antwoord.
    uit = sys.stdout
    sys.stdout = sys.stderr
    try:
        resultaat = main()
    finally:
        sys.stdout = uit
