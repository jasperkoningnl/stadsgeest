const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { createClient } = require('@libsql/client');
const { EntityResolver } = require('./src/kg/entity-resolver.cjs');

function usage() {
  console.log('Gebruik:');
  console.log('  node manage-entity-merge.cjs list');
  console.log('  node manage-entity-merge.cjs approve <candidate-id> --actor=<naam> --reason=<reden>');
  console.log('  node manage-entity-merge.cjs reject <candidate-id> --actor=<naam> --reason=<reden>');
  console.log('  node manage-entity-merge.cjs unmerge <audit-id> --actor=<naam> --reason=<reden>');
}

function option(name) {
  return process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3).trim() || '';
}

async function main() {
  const [action, rawId] = process.argv.slice(2);
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  try {
    if (action === 'list') {
      const rows = (await db.execute(`SELECT c.id,c.score,c.status,a.canonical_name entity_a,b.canonical_name entity_b,c.match_details,c.created_at
        FROM entity_merge_candidates c JOIN kg_entities a ON a.id=c.entity_a_id JOIN kg_entities b ON b.id=c.entity_b_id
        WHERE c.status IN ('pending','review') ORDER BY c.score DESC,c.id`)).rows;
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    const id = Number(rawId);
    const actor = option('actor');
    const reason = option('reason');
    if (!Number.isInteger(id) || id < 1 || !actor || !reason) { usage(); process.exitCode = 1; return; }
    const resolver = new EntityResolver({ db });
    if (action === 'approve') {
      const candidate = (await db.execute({ sql: 'SELECT * FROM entity_merge_candidates WHERE id=?', args: [id] })).rows[0];
      if (!candidate || !['pending', 'review'].includes(String(candidate.status))) throw new Error('Kandidaat bestaat niet of is al afgehandeld.');
      const auditId = await resolver.mergeEntities(Number(candidate.entity_a_id), Number(candidate.entity_b_id), { actor, reason, candidateId: id });
      console.log(JSON.stringify({ action: 'merged', candidateId: id, auditId }, null, 2));
    } else if (action === 'reject') {
      const result = await db.execute({
        sql: `UPDATE entity_merge_candidates SET status='rejected',reviewed_by=?,reviewed_at=datetime('now'),match_details=json_set(COALESCE(match_details,'{}'),'$.review_reason',?) WHERE id=? AND status IN ('pending','review')`,
        args: [actor, reason, id],
      });
      if (!result.rowsAffected) throw new Error('Kandidaat bestaat niet of is al afgehandeld.');
      console.log(JSON.stringify({ action: 'rejected', candidateId: id }, null, 2));
    } else if (action === 'unmerge') {
      await resolver.unmerge(id, { actor, reason });
      console.log(JSON.stringify({ action: 'reversed', auditId: id }, null, 2));
    } else {
      usage(); process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
