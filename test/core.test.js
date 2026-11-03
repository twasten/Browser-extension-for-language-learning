import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/shared/core.js';

const C = globalThis.LLCore;

test('classify: single words (incl. punctuation, hyphens, apostrophes)', () => {
  assert.deepEqual(C.classify('  running '), { kind: 'word', text: 'running' });
  assert.deepEqual(C.classify('“Hello,”'), { kind: 'word', text: 'Hello' });
  assert.equal(C.classify('well-known').kind, 'word');
  assert.equal(C.classify("don't").kind, 'word');
  assert.equal(C.classify('Straßenbahn').kind, 'word');
  assert.equal(C.classify('привет!').text, 'привет');
});

test('classify: phrases and sentences', () => {
  assert.equal(C.classify('New York').kind, 'phrase');
  assert.equal(C.classify('The cat sat on the mat.').kind, 'phrase');
  assert.equal(C.classify('a\nb').kind, 'phrase');
});

test('classify: CJK uses the word segmenter', () => {
  assert.equal(C.classify('猫').kind, 'word');
  assert.equal(C.classify('我喜欢学习中文。').kind, 'phrase');
});

test('classify: nothing useful selected', () => {
  assert.equal(C.classify('   ').kind, 'none');
  assert.equal(C.classify('— !').kind, 'none');
});

test('extractSentence finds the surrounding sentence', () => {
  const text = 'First one. The quick fox jumps! Last.';
  const i = text.indexOf('fox');
  assert.equal(C.extractSentence(text, i, i + 3), 'The quick fox jumps!');
});

test('dictKey is case- and whitespace-insensitive', () => {
  assert.equal(C.dictKey('  Hello  World ', 'en-US'), 'en:hello world');
  assert.equal(C.dictKey('Hund', null), 'auto:hund');
});

test('hostnameMatches handles subdomains', () => {
  assert.ok(C.hostnameMatches('mail.google.com', ['google.com']));
  assert.ok(C.hostnameMatches('google.com', ['*.google.com']));
  assert.ok(!C.hostnameMatches('notgoogle.com', ['google.com']));
});

test('buildPhraseRegex matches whole words only', () => {
  const re = C.buildPhraseRegex(['cat', 'ice cream', '猫']);
  const found = (s) => [...s.matchAll(re)].map((m) => m[0]);
  assert.deepEqual(found('A cat, a catalog, Ice  cream and 我的猫'), ['cat', 'Ice  cream', '猫']);
  assert.equal(C.buildPhraseRegex([]), null);
});
