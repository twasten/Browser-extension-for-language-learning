/*
 * Shared, dependency-free helpers.
 *
 * This file is written as a *classic* script that attaches `globalThis.LLCore`
 * so it can be used in three places without a bundler:
 *   - content scripts (listed before content.js in manifest.json),
 *   - ES modules (service worker, popup, options, dictionary) via a
 *     side-effect `import '../shared/core.js'`,
 *   - Node tests (same side-effect import).
 */
(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    settings: 'settings', // chrome.storage.sync
    dictionary: 'dictionary' // chrome.storage.local
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    sourceLang: 'auto', // language being learned ("auto" = detect)
    targetLang: 'en', // language translations are shown in
    provider: 'google',
    deeplApiKey: '',
    libreUrl: 'https://libretranslate.com',
    libreApiKey: '',
    triggerMode: 'button', // "button" | "instant"
    highlightSaved: true,
    autoPronounce: false,
    wordDetails: true, // enrich single words with transcription + part of speech
    speechRate: 0.9,
    disabledSites: []
  };

  const MAX_TEXT_LENGTH = 1500;
  const MASTERED_INTERVAL_DAYS = 21;

  const LETTER = /[\p{L}\p{M}\p{N}]/u;
  const EDGE_PUNCT = /^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu;
  const SINGLE_TOKEN = /^[\p{L}\p{M}\p{N}]+(?:['’\-‐][\p{L}\p{M}\p{N}]+)*$/u;
  const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  /** Strip surrounding punctuation/quotes: “Hello,” -> Hello */
  function cleanWord(text) {
    return normalize(text).replace(EDGE_PUNCT, '');
  }

  function countWordLike(text, locale) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(locale || undefined, { granularity: 'word' });
      let n = 0;
      for (const s of seg.segment(text)) if (s.isWordLike) n++;
      return n;
    }
    return text.split(/\s+/).filter((w) => LETTER.test(w)).length;
  }

  /**
   * Decide whether a selection is a single word or a phrase/sentence.
   * Returns { kind: 'word' | 'phrase' | 'none', text }.
   */
  function classify(raw, locale) {
    const text = normalize(raw);
    if (!text || !LETTER.test(text)) return { kind: 'none', text: '' };
    const word = cleanWord(text);
    if (word && word.length <= 40 && !/\s/.test(word)) {
      // Latin/Cyrillic/etc.: one token, hyphens/apostrophes allowed (well-known, don't).
      if (SINGLE_TOKEN.test(word) && !NO_SPACE_SCRIPT.test(word)) return { kind: 'word', text: word };
      // CJK/Thai: no spaces, rely on the ICU word segmenter.
      if (NO_SPACE_SCRIPT.test(word) && word.length <= 8 && countWordLike(word, locale) === 1) {
        return { kind: 'word', text: word };
      }
    }
    return { kind: 'phrase', text: text.slice(0, MAX_TEXT_LENGTH) };
  }

  /** Sentence of `full` that contains the range [start, end). */
  function extractSentence(full, start, end) {
    const text = String(full || '');
    if (!text) return '';
    const stop = /[.!?。！？\n]/;
    let a = Math.max(0, Math.min(start, text.length));
    let b = Math.max(a, Math.min(end, text.length));
    while (a > 0 && !stop.test(text[a - 1])) a--;
    while (b < text.length && !stop.test(text[b])) b++;
    if (b < text.length) b++; // include the terminator
    const sentence = normalize(text.slice(a, b));
    return sentence.length > 300 ? sentence.slice(0, 300) + '…' : sentence;
  }

  function langBase(code) {
    return String(code || '').toLowerCase().split(/[-_]/)[0];
  }

  /** Stable dictionary key: "<source lang>:<lowercased text>". */
  function dictKey(text, lang) {
    return `${langBase(lang) || 'auto'}:${normalize(text).toLocaleLowerCase()}`;
  }

  function isMastered(entry) {
    return !!(entry && entry.srs && entry.srs.interval >= MASTERED_INTERVAL_DAYS);
  }

  function hostnameMatches(hostname, patterns) {
    const h = String(hostname || '').toLowerCase();
    return (patterns || []).some((p) => {
      const pat = String(p).trim().toLowerCase().replace(/^\*\./, '');
      return pat && (h === pat || h.endsWith('.' + pat));
    });
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Build one regex that finds any of `phrases` as whole words
   * (no word-boundary checks for scripts written without spaces).
   */
  function buildPhraseRegex(phrases) {
    const parts = [...new Set(phrases.map((p) => normalize(p)).filter(Boolean))]
      .sort((a, b) => b.length - a.length)
      .map((p) => {
        const esc = escapeRegExp(p).replace(/ /g, '\\s+');
        return NO_SPACE_SCRIPT.test(p) ? esc : `(?<![\\p{L}\\p{M}\\p{N}])${esc}(?![\\p{L}\\p{M}\\p{N}])`;
      });
    if (!parts.length) return null;
    return new RegExp(parts.join('|'), 'giu');
  }

  /** Pick a Web Speech voice for `lang` and speak `text`. */
  function speak(text, lang, rate) {
    const synth = global.speechSynthesis;
    if (!synth || !text) return false;
    synth.cancel();
    const u = new global.SpeechSynthesisUtterance(text);
    if (lang && lang !== 'auto') {
      u.lang = lang;
      const base = langBase(lang);
      const voices = synth.getVoices();
      const voice =
        voices.find((v) => v.lang.toLowerCase() === String(lang).toLowerCase()) ||
        voices.find((v) => langBase(v.lang) === base);
      if (voice) u.voice = voice;
    }
    u.rate = rate || 0.9;
    synth.speak(u);
    return true;
  }

  global.LLCore = {
    STORAGE_KEYS,
    DEFAULT_SETTINGS,
    MAX_TEXT_LENGTH,
    MASTERED_INTERVAL_DAYS,
    normalize,
    cleanWord,
    classify,
    extractSentence,
    langBase,
    dictKey,
    isMastered,
    hostnameMatches,
    buildPhraseRegex,
    speak
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
