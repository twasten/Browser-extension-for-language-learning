import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseGoogleResponse } from '../src/providers/google.js';
import { deepl } from '../src/providers/deepl.js';
import { libretranslate } from '../src/providers/libretranslate.js';
import { PROVIDERS, getProvider } from '../src/providers/index.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('Google: word response yields translation, transcription and parts of speech', async () => {
  const r = parseGoogleResponse(await fixture('google-word.json'));
  assert.equal(r.translation, 'бег');
  assert.equal(r.detectedSource, 'en');
  assert.equal(r.transcription, 'ˈrəniNG');
  assert.equal(r.partsOfSpeech[0].pos, 'noun');
  assert.ok(r.partsOfSpeech[0].terms.includes('ход'));
});

test('Google: multi-sentence response is joined', async () => {
  const r = parseGoogleResponse(await fixture('google-sentence.json'));
  assert.equal(r.translation, 'Кот сидел на коврике. Это было счастливо.');
  assert.deepEqual(r.partsOfSpeech, []);
});

test('DeepL language code mapping', () => {
  assert.equal(deepl.mapTarget('en'), 'EN-US');
  assert.equal(deepl.mapTarget('zh-TW'), 'ZH-HANT');
  assert.equal(deepl.mapTarget('de'), 'DE');
  assert.equal(deepl.mapSource('zh-CN'), 'ZH');
});

test('DeepL without key fails with a helpful message', async () => {
  await assert.rejects(deepl.translate({ text: 'hi', to: 'de', settings: {} }), /API key/);
});

test('LibreTranslate request shape', async () => {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ translatedText: 'Hallo', detectedLanguage: { language: 'en', confidence: 90 } }));
  };
  try {
    const r = await libretranslate.translate({ text: 'Hello', to: 'de', settings: { libreUrl: 'https://lt.example/', libreApiKey: 'k' } });
    assert.equal(r.translation, 'Hallo');
    assert.equal(r.detectedSource, 'en');
    assert.equal(calls[0].url, 'https://lt.example/translate');
    assert.deepEqual(calls[0].body, { q: 'Hello', source: 'auto', target: 'de', format: 'text', api_key: 'k' });
  } finally {
    globalThis.fetch = orig;
  }
});

test('every provider implements the interface', () => {
  for (const p of PROVIDERS) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.translate, 'function');
    assert.ok(Array.isArray(p.fields));
  }
  assert.equal(getProvider('nope').id, 'google');
});
