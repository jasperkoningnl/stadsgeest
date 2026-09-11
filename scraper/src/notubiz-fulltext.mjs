const MIN_TEXT = 200;

export function isNotubizUrl(value) {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === 'notubiz.nl' || host.endsWith('.notubiz.nl');
  } catch {
    return false;
  }
}

export function notubizDocumentParts(value) {
  if (!isNotubizUrl(value)) return null;
  const match = new URL(String(value)).pathname.match(/^\/document\/(\d+)\/(\d+)/i);
  if (!match) return null;
  return { documentId: match[1], revision: match[2] };
}

export function oriUrlCandidates(value) {
  const url = new URL(String(value));
  url.search = '';
  const clean = url.toString().replace(/\/$/, '');
  const parts = notubizDocumentParts(clean);
  const candidates = new Set([String(value), clean]);
  if (parts) {
    candidates.add(`https://api.notubiz.nl/document/${parts.documentId}/${parts.revision}`);
    candidates.add(`https://amersfoort.notubiz.nl/document/${parts.documentId}/${parts.revision}`);
  }
  return [...candidates];
}

export function buildOriLookup(value) {
  const urls = oriUrlCandidates(value);
  return {
    size: 10,
    query: {
      bool: {
        should: urls.flatMap(url => [
          { term: { 'original_url.keyword': url } },
          { term: { original_url: url } },
        ]),
        minimum_should_match: 1,
      },
    },
    _source: ['text', 'original_url'],
  };
}

export function extractOriText(payload, sourceUrl, minText = MIN_TEXT) {
  const sourceParts = notubizDocumentParts(sourceUrl);
  const matches = (payload?.hits?.hits || [])
    .map(hit => hit?._source || {})
    .filter(source => {
      if (!sourceParts) return true;
      const hitParts = notubizDocumentParts(source.original_url);
      return hitParts?.documentId === sourceParts.documentId;
    })
    .map(source => String(source.text || '').replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= minText)
    .sort((a, b) => b.length - a.length);
  return matches[0] || null;
}
