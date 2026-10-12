'use strict';

// spaCy-posities tellen Unicode-codepunten, niet JavaScript UTF-16-eenheden.
// Maak de tekenlijst eenmaal per document; slice mag geen emoji doorknippen.
function contextSnippet(characters, start, end) {
  return characters.slice(Math.max(0, start - 60), end + 90).join('')
    .toWellFormed().replace(/\s+/g, ' ').trim();
}

module.exports = { contextSnippet };
