// bluesky.js — Bluesky publieke feed: zoekterm "Amersfoort" + Amersfoortse accounts
// API: https://public.api.bsky.app/ (geen auth vereist voor publieke posts)
import 'dotenv/config';
import db from '../db.js';
import { saveRawItem, getOrCreateSource, logResult } from '../utils.js';

const BASE = 'https://public.api.bsky.app/xrpc';
const H = { 'Accept': 'application/json' };

const get = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: H, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} voor ${path}`);
  return r.json();
};

// Construeer post-URL van URI: at://did:plc:{xxx}/app.bsky.feed.post/{rkey}
const postUrl = (uri, handle) => {
  const rkey = uri.split('/').at(-1);
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
};

// Sla één post op
const savePost = async (db, sourceId, post) => {
  const author = post.author;
  const record = post.record;
  const text = record?.text || '';
  const handle = author?.handle || 'unknown';
  const uri = post.uri;

  const title = `[${author?.displayName || handle}] ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`;
  const url = postUrl(uri, handle);
  return saveRawItem(db, {
    sourceId,
    externalUrl: url,
    title,
    content: text,
    summary: `@${handle} — ${record?.createdAt?.slice(0, 10) || ''}`,
  });
};

async function scrape() {
  let totalSaved = 0, totalSkipped = 0, totalErrors = 0;

  // 1. Zoekfeed "Amersfoort"
  const searchSourceId = await getOrCreateSource(db, {
    name: 'Bluesky — zoekfeed "Amersfoort"',
    url: 'https://bsky.app/search?q=Amersfoort',
    sourceType: 'api',
    reliability: 'signal',
    category: 'social',
    scrapeFrequency: 'daily',
  });

  try {
    const data = await get('/app.bsky.feed.searchPosts?q=Amersfoort&limit=25&sort=latest');
    let saved = 0, skipped = 0;
    for (const post of data.posts || []) {
      try {
        const r = await savePost(db, searchSourceId, post);
        if (r.saved) saved++; else skipped++;
      } catch (e) { totalErrors++; }
    }
    logResult('Bluesky zoek', saved, skipped, 0);
    totalSaved += saved; totalSkipped += skipped;
  } catch (e) {
    console.error('Bluesky zoekfeed fout:', e.message);
    totalErrors++;
  }

  // 2. Account-feeds
  const accounts = [
    { handle: 'adamersfoort.bsky.social',      name: 'AD Amersfoort (Bluesky)' },
    { handle: '112amersfoort.nl',              name: '112 Amersfoort (Bluesky)' },
    { handle: 'fiets033.bsky.social',          name: 'Fietsersbond Amersfoort (Bluesky)' },
    { handle: 'cdaamersfoort.bsky.social',     name: 'CDA Amersfoort (Bluesky)' },
    { handle: 'pvddamersfoort.bsky.social',    name: 'PvdD Amersfoort (Bluesky)' },
    { handle: 'vvdamersfoort.bsky.social',     name: 'VVD Amersfoort (Bluesky)' },
  ];

  for (const { handle, name } of accounts) {
    const sourceId = await getOrCreateSource(db, {
      name,
      url: `https://bsky.app/profile/${handle}`,
      sourceType: 'api',
      reliability: 'signal',
      category: 'social',
      scrapeFrequency: 'daily',
    });

    try {
      const data = await get(`/app.bsky.feed.getAuthorFeed?actor=${handle}&limit=10`);
      let saved = 0, skipped = 0;
      for (const item of data.feed || []) {
        if (!item.post) continue;
        try {
          const r = await savePost(db, sourceId, item.post);
          if (r.saved) saved++; else skipped++;
        } catch (e) { totalErrors++; }
      }
      logResult(`Bluesky @${handle.split('.')[0]}`, saved, skipped, 0);
      totalSaved += saved; totalSkipped += skipped;
    } catch (e) {
      console.error(`Bluesky ${handle} fout:`, e.message);
    }
  }

  logResult('Bluesky totaal', totalSaved, totalSkipped, totalErrors);
}

scrape().catch(console.error);
