// check-notubiz.mjs — test de Notubiz API voor Amersfoort
// Draai op Jaspers laptop: node check-notubiz.mjs

const BASE = 'https://api.notubiz.nl';

// Stap 1: vind Amersfoort org-id
const orgResp = await fetch(`${BASE}/organisations?format=json&version=1.10.8`);
const orgData = await orgResp.json();
const orgs = orgData.organisations;
let amersfoortId = null;
for (const item of orgs) {
  const o = item.organisation;
  if (o.name && o.name.trim() === 'Gemeente Amersfoort') {
    amersfoortId = o['@attributes']?.id;
    console.log(`Amersfoort org-id: ${amersfoortId}`);
    console.log(`Modules: ${JSON.stringify(o.modules, null, 2)}`);
    break;
  }
}
if (!amersfoortId) { console.log('Amersfoort niet gevonden'); process.exit(1); }

// Stap 2: haal gremia op
const gremiaResp = await fetch(`${BASE}/organisations/${amersfoortId}?format=json&version=1.10.8`);
const gremiaData = await gremiaResp.json();
console.log('\n--- Gremia ---');
const gremia = gremiaData.organisation?.gremia || [];
for (const g of (Array.isArray(gremia) ? gremia : [gremia])) {
  const gr = g.gremium || g;
  console.log(`  ${gr['@attributes']?.id || '?'}: ${gr.name || JSON.stringify(gr).substring(0,100)}`);
}

// Stap 3: test /events met datumbereik
const now = new Date();
const from = new Date(now - 30 * 86400000);
const eventsUrl = `${BASE}/events?organisation_id=${amersfoortId}&date_from=${from.toISOString().split('T')[0]}+00:00:00&date_to=${now.toISOString().split('T')[0]}+23:59:59&format=json&version=1.10.8`;
console.log('\n--- Events URL ---');
console.log(eventsUrl);
const evResp = await fetch(eventsUrl);
const evData = await evResp.json();
const events = evData.events || [];
console.log(`\nAantal events (30 dagen): ${Array.isArray(events) ? events.length : 'onbekend'}`);
if (Array.isArray(events)) {
  for (const ev of events.slice(0, 5)) {
    const e = ev.event || ev;
    console.log(`  ${e['@attributes']?.id || '?'} — ${e.date || '?'} — ${e.gremium?.name || '?'}`);
  }
}

// Stap 4: test /modules endpoint (als die bestaat)
try {
  const modResp = await fetch(`${BASE}/organisations/${amersfoortId}/modules?format=json&version=1.10.8`);
  if (modResp.ok) {
    const modData = await modResp.json();
    console.log('\n--- Modules ---');
    console.log(JSON.stringify(modData, null, 2).substring(0, 1000));
  } else {
    console.log(`\n/modules endpoint: HTTP ${modResp.status}`);
  }
} catch (e) {
  console.log(`/modules endpoint: ${e.message}`);
}

// Stap 5: test de /document_folders endpoint (schriftelijke vragen = folder/module)
try {
  const foldResp = await fetch(`${BASE}/organisations/${amersfoortId}/document_folders?format=json&version=1.10.8`);
  if (foldResp.ok) {
    const foldData = await foldResp.json();
    console.log('\n--- Document folders ---');
    const folders = foldData.document_folders || [];
    for (const f of (Array.isArray(folders) ? folders.slice(0, 20) : [folders])) {
      const fd = f.document_folder || f;
      console.log(`  ${fd['@attributes']?.id || '?'}: ${fd.name || JSON.stringify(fd).substring(0,100)}`);
    }
  } else {
    console.log(`\n/document_folders: HTTP ${foldResp.status}`);
  }
} catch (e) {
  console.log(`/document_folders: ${e.message}`);
}
