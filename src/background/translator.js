// Orchestrates a translation request: picks the provider, enriches single
// words with pronunciation + part of speech, and caches results.
import '../shared/core.js';
import { getProvider } from '../providers/index.js';
import { google } from '../providers/google.js';
import { fetchJson } from '../providers/http.js';

const { classify, langBase, MAX_TEXT_LENGTH } = globalThis.LLCore;

const CACHE_LIMIT = 300;
const cache = new Map(); // in-memory LRU; the service worker may be recycled, that's fine

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

export function clearCache() {
  cache.clear();
}

/** IPA for English words from the Free Dictionary API (best effort). */
async function englishIpa(word) {
  try {
    const json = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`, {
      timeout: 3000,
      provider: 'dictionaryapi.dev'
    });
    const entry = Array.isArray(json) ? json[0] : null;
    if (!entry) return null;
    const ipa = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '';
    const pos = [...new Set((entry.meanings || []).map((m) => m.partOfSpeech).filter(Boolean))];
    return { ipa, pos };
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{
 *   text, kind, translation, sourceLang, targetLang, provider,
 *   transcription, partsOfSpeech, alternatives
 * }>}
 */
export async function translate(rawText, settings) {
  const { kind, text } = classify(rawText);
  if (kind === 'none') throw new Error('Select some text to translate.');

  const provider = getProvider(settings.provider);
  const from = settings.sourceLang || 'auto';
  const to = settings.targetLang || 'en';
  const isWord = kind === 'word';
  const wantDetails = isWord && settings.wordDetails !== false;
  const input = text.slice(0, Math.min(MAX_TEXT_LENGTH, provider.maxLength || MAX_TEXT_LENGTH));

  const cacheKey = [provider.id, from, to, wantDetails ? 'd' : '', input].join('\u0001');
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const base = await provider.translate({ text: input, from, to, settings, details: wantDetails });

  const result = {
    text: input,
    kind,
    provider: provider.id,
    translation: base.translation || '',
    sourceLang: base.detectedSource || (from !== 'auto' ? from : null),
    targetLang: to,
    transcription: base.transcription || '',
    partsOfSpeech: base.partsOfSpeech || [],
    alternatives: (base.alternatives || []).filter((a) => a && a !== base.translation)
  };

  if (wantDetails) {
    // Providers without dictionary data (DeepL, LibreTranslate) borrow it from Google.
    const needsDictionary = !result.partsOfSpeech.length || !result.transcription;
    const [extra, ipa] = await Promise.all([
      needsDictionary && provider.id !== 'google'
        ? google.translate({ text: input, from, to, details: true }).catch(() => null)
        : null,
      langBase(result.sourceLang) === 'en' || (!result.sourceLang && /^[a-z'-]+$/i.test(input)) ? englishIpa(input) : null
    ]);
    if (extra) {
      result.sourceLang = result.sourceLang || extra.detectedSource;
      if (!result.transcription) result.transcription = extra.transcription;
      if (!result.partsOfSpeech.length) result.partsOfSpeech = extra.partsOfSpeech;
    }
    if (ipa?.ipa) result.transcription = ipa.ipa; // real IPA beats Google's respelling
    if (!result.partsOfSpeech.length && ipa?.pos?.length) {
      result.partsOfSpeech = ipa.pos.map((pos) => ({ pos, terms: [] }));
    }
  }

  cacheSet(cacheKey, result);
  return result;
}
