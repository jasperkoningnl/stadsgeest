import * as cheerio from 'cheerio';

/** Haalt alleen echte MBO-nieuwsartikelen uit een pagina. */
export function extractMboLinks(html, pageUrl = 'https://www.mboamersfoort.nl/') {
  const $ = cheerio.load(html);
  const links = new Map();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    let url;
    try { url = new URL(href, pageUrl); } catch { return; }
    if (url.hostname !== 'www.mboamersfoort.nl' && url.hostname !== 'mboamersfoort.nl') return;
    const pad = url.pathname.replace(/\/+$/, '/');
    if (!pad.startsWith('/nieuws/') && !pad.startsWith('/actueel/nieuws/')) return;
    if (pad === '/nieuws/' || pad === '/actueel/nieuws/') return;
    url.hash = '';
    const linkText = $(el).text().trim();
    const titleParent = $(el).parents().filter((_, parent) => $(parent).find('h1,h2,h3,h4').length > 0).first();
    const contextTitle = titleParent.find('h1,h2,h3,h4').last().text().trim();
    const title = (contextTitle
      || (!/^lees meer$/i.test(linkText) ? linkText : '')
      || pad.split('/').filter(Boolean).at(-1)?.replace(/-/g, ' ')
      || '').replace(/\s+/g, ' ').trim();
    if (title && !links.has(url.href)) links.set(url.href, title);
  });
  return links;
}
