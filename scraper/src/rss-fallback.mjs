/**
 * Leest eerst de feed en gebruikt de HTML-lijst zowel bij een lege feed als
 * bij een netwerk- of parsefout. Een kapotte feed mag een werkende website
 * niet als bronstoring laten eindigen.
 */
export async function laadFeedOfHtml(bron, { fetchFeed, fetchHtmlItems }) {
  try {
    const feed = await fetchFeed(bron.feedUrl);
    if (feed.items?.length) return { items: feed.items, route: 'feed' };
    if (!bron.htmlFallback) return { items: [], route: 'lege-feed' };
    return { items: await fetchHtmlItems(bron.htmlFallback), route: 'html-na-lege-feed' };
  } catch (feedFout) {
    if (!bron.htmlFallback) throw feedFout;
    try {
      return { items: await fetchHtmlItems(bron.htmlFallback), route: 'html-na-feedfout' };
    } catch (htmlFout) {
      throw new Error(`feed: ${feedFout.message}; HTML-terugval: ${htmlFout.message}`);
    }
  }
}
