// DeepL API (Free or Pro). Free keys end with ":fx" and use api-free.deepl.com.
// Docs: https://developers.deepl.com/docs/api-reference/translate
import { fetchJson, ProviderError } from './http.js';

const TARGET_MAP = { en: 'EN-US', pt: 'PT-BR', 'zh-cn': 'ZH-HANS', 'zh-tw': 'ZH-HANT', no: 'NB' };
const SOURCE_MAP = { 'zh-cn': 'ZH', 'zh-tw': 'ZH', no: 'NB' };

export const deepl = {
  id: 'deepl',
  name: 'DeepL (API key)',
  needsKey: true,
  fields: [
    { key: 'deeplApiKey', label: 'DeepL API key', type: 'password', placeholder: 'xxxxxxxx-…:fx' }
  ],
  maxLength: 5000,

  mapTarget(code) {
    const c = String(code).toLowerCase();
    return TARGET_MAP[c] || c.split('-')[0].toUpperCase();
  },
  mapSource(code) {
    const c = String(code).toLowerCase();
    return SOURCE_MAP[c] || c.split('-')[0].toUpperCase();
  },

  async translate({ text, from = 'auto', to, settings }) {
    const key = (settings.deeplApiKey || '').trim();
    if (!key) throw new ProviderError('Add your DeepL API key in the extension settings.', { provider: 'DeepL' });
    const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const body = { text: [text], target_lang: this.mapTarget(to) };
    if (from && from !== 'auto') body.source_lang = this.mapSource(from);

    const json = await fetchJson(`${host}/v2/translate`, {
      provider: 'DeepL',
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const t = json.translations?.[0];
    if (!t) throw new ProviderError('DeepL returned no translation', { provider: 'DeepL' });
    return {
      translation: t.text,
      detectedSource: t.detected_source_language ? t.detected_source_language.toLowerCase() : null
    };
  }
};
