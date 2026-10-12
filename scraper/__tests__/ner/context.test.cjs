'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contextSnippet } = require('../../src/ner/context.cjs');

test('spaCy-codepointposities blijven correct na emoji in de tekst', () => {
  const text = '😀'.repeat(80) + 'Gemeente Amersfoort' + ' einde';
  const snippet = contextSnippet(Array.from(text), 80, 98);
  assert.equal(snippet, '😀'.repeat(60) + 'Gemeente Amersfoort einde');
  assert.ok(snippet.isWellFormed());
});

test('emoji op linker- en rechtergrens worden niet doormidden geknipt', () => {
  const text = 'a'.repeat(10) + '😀' + 'b'.repeat(59) + 'X' + 'c'.repeat(89) + '😀' + 'staart';
  const snippet = contextSnippet(Array.from(text), 70, 71);
  assert.equal(snippet, '😀' + 'b'.repeat(59) + 'X' + 'c'.repeat(89) + '😀');
  assert.ok(snippet.isWellFormed());
  assert.equal(text.substring(10, 162).isWellFormed(), false);
});

test('losse surrogaten uit bronmateriaal worden veilig vervangen', () => {
  assert.equal(contextSnippet(Array.from('a\ud83db'), 0, 3), 'a�b');
});
