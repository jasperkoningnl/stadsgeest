import test from 'node:test';
import assert from 'node:assert/strict';
import { laadFeedOfHtml } from '../../src/rss-fallback.mjs';

const bron = { feedUrl: 'https://voorbeeld.nl/feed/', htmlFallback: { page: 'https://voorbeeld.nl/nieuws/' } };

test('gebruikt HTML-terugval als de feed een fout geeft', async () => {
  const resultaat = await laadFeedOfHtml(bron, {
    fetchFeed: async () => { throw new Error('HTTP 503'); },
    fetchHtmlItems: async () => [{ title: 'Nieuw bericht' }],
  });
  assert.equal(resultaat.route, 'html-na-feedfout');
  assert.equal(resultaat.items[0].title, 'Nieuw bericht');
});

test('gebruikt HTML-terugval ook bij een geldige maar lege feed', async () => {
  const resultaat = await laadFeedOfHtml(bron, {
    fetchFeed: async () => ({ items: [] }),
    fetchHtmlItems: async () => [{ title: 'Via de site' }],
  });
  assert.equal(resultaat.route, 'html-na-lege-feed');
});

test('geeft de feedfout door als er geen terugval is', async () => {
  await assert.rejects(() => laadFeedOfHtml({ feedUrl: bron.feedUrl }, {
    fetchFeed: async () => { throw new Error('kapot'); },
    fetchHtmlItems: async () => [],
  }), /kapot/);
});
