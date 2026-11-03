// Google Translate — the free, unofficial "gtx" endpoint used by browser
// translate widgets. No API key needed; one request returns the translation,
// the detected source language, transliteration and (for single words)
// dictionary entries grouped by part of speech.
import { fetchJson, ProviderError } from './http.js';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

export function parseGoogleResponse(d) {
  const sentences = Array.isArray(d?.sentences) ? d.sentences : [];
  const translation = sentences
    .filter((s) => typeof s.trans === 'string')
    .map((s) => s.trans)
    .join('')
    .trim();
  const translit = sentences.find((s) => 'translit' in s || 'src_translit' in s) || {};
  const partsOfSpeech = (Array.isArray(d?.dict) ? d.dict : [])
    .filter((e) => e && e.pos)
    .map((e) => ({ pos: e.pos, terms: (e.terms || []).slice(0, 6) }));
  return {
    translation,
    detectedSource: d?.src || null,
    transcription: translit.src_translit || '',
    targetTranslit: translit.translit || '',
    partsOfSpeech
  };
}

export const google = {
  id: 'google',
  name: 'Google Translate (free, no key)',
  needsKey: false,
  fields: [],
  maxLength: 5000,

  mapLang(code) {
    return code === 'he' ? 'iw' : code;
  },

  /**
   * @param {{text:string, from:string, to:string, details?:boolean}} req
   */
  async translate({ text, from = 'auto', to, details = false }) {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: from === 'auto' ? 'auto' : this.mapLang(from),
      tl: this.mapLang(to),
      dj: '1',
      ie: 'UTF-8',
      oe: 'UTF-8'
    });
    params.append('dt', 't');
    params.append('dt', 'rm'); // transliteration / pronunciation hint
    if (details) params.append('dt', 'bd'); // dictionary: part of speech + alternatives

    // POST keeps long selections out of the URL.
    let json;
    try {
      json = await fetchJson(`${ENDPOINT}?${params}`, {
        provider: 'Google',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ q: text }).toString()
      });
    } catch (e) {
      // Too many requests -> Google answers 429 or redirects to a captcha page.
      if (e.status === 429 || e.status === 302 || /unexpected response/.test(e.message)) {
        throw new ProviderError(
          'Google is temporarily limiting requests from your network. Try again later or switch to DeepL/LibreTranslate in the settings.',
          { status: e.status, provider: 'Google' }
        );
      }
      throw e;
    }
    const result = parseGoogleResponse(json);
    if (result.detectedSource === 'iw') result.detectedSource = 'he';
    return result;
  }
};
