// LibreTranslate — open source, self-hostable. Public instance at
// libretranslate.com needs a key; self-hosted instances usually don't.
// Docs: https://docs.libretranslate.com/
import { fetchJson, ProviderError } from './http.js';

export const libretranslate = {
  id: 'libretranslate',
  name: 'LibreTranslate (self-hosted or key)',
  needsKey: false,
  fields: [
    { key: 'libreUrl', label: 'Server URL', type: 'url', placeholder: 'https://libretranslate.com', requestsHost: true },
    { key: 'libreApiKey', label: 'API key (optional)', type: 'password', placeholder: 'leave empty for self-hosted' }
  ],
  maxLength: 2000,

  mapLang(code) {
    const c = String(code).toLowerCase();
    if (c === 'zh-cn') return 'zh';
    if (c === 'zh-tw') return 'zt';
    if (c === 'no') return 'nb';
    return c.split('-')[0];
  },

  async translate({ text, from = 'auto', to, settings, details = false }) {
    const base = (settings.libreUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(base)) {
      throw new ProviderError('Set a LibreTranslate server URL in the settings.', { provider: 'LibreTranslate' });
    }
    const body = {
      q: text,
      source: from === 'auto' ? 'auto' : this.mapLang(from),
      target: this.mapLang(to),
      format: 'text'
    };
    if (details) body.alternatives = 3;
    if (settings.libreApiKey) body.api_key = settings.libreApiKey.trim();

    const json = await fetchJson(`${base}/translate`, {
      provider: 'LibreTranslate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return {
      translation: json.translatedText || '',
      detectedSource: json.detectedLanguage?.language || null,
      alternatives: Array.isArray(json.alternatives) ? json.alternatives : []
    };
  }
};
