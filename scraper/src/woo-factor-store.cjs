'use strict';
const { createHash } = require('node:crypto');

async function importAnalyses(db, analyses, validate) {
  const tx = await db.transaction('write');
  let inserted = 0;
  try {
    for (const input of analyses) {
      const a = validate(input);
      const json = JSON.stringify(a);
      const hash = createHash('sha256').update(json).digest('hex');
      const existing = (await tx.execute({sql:'SELECT analyse_hash FROM woo_factor_cases WHERE id=?',args:[a.id]})).rows[0];
      if (existing) {
        if (existing.analyse_hash !== hash) throw new Error(`Analyse ${a.id} bestaat al met andere inhoud. Gebruik een nieuwe versiecode; redactieoordelen worden niet overschreven.`);
        continue;
      }
      const dossier = (await tx.execute({sql:'SELECT id FROM dossiers WHERE slug=?',args:[a.dossier_slug]})).rows[0];
      if (!dossier) throw new Error(`Onbekend dossier: ${a.dossier_slug}`);
      await tx.execute({sql:'INSERT INTO woo_factor_cases(id,dossier_id,analyse_json,analyse_hash,concept) VALUES (?,?,?,?,?)',args:[a.id,dossier.id,json,hash,a.concept]});
      await tx.execute({sql:"INSERT INTO woo_factor_events(case_id,revision,actor,action,snapshot_json) VALUES (?,1,'ai','analyse',?)",args:[a.id,JSON.stringify({analyse:a,concept:a.concept,besluit:'te_beoordelen'})]});
      inserted++;
    }
    await tx.commit();
    return { inserted, unchanged: analyses.length-inserted };
  } catch (e) { await tx.rollback(); throw e; }
  finally { tx.close(); }
}

module.exports = { importAnalyses };
