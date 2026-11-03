import '../shared/core.js';
import { bindSettings, requestHostPermission } from '../ui/settings-ui.js';
import { getSettings } from '../shared/storage.js';
import { LANGUAGES } from '../shared/languages.js';

const { speak } = globalThis.LLCore;
const $ = (id) => document.getElementById(id);

const HINTS = {
  google: 'Free, no key needed. Uses the unofficial endpoint behind Google’s translate widgets — fine for personal use, but it may be rate-limited.',
  deepl: 'Get a free key (500,000 characters/month) at deepl.com/pro-api. Keys ending in “:fx” use the Free API automatically. Word details (transcription, part of speech) still come from Google.',
  libretranslate: 'Open-source and self-hostable. The public libretranslate.com instance needs a key; your own server (e.g. http://localhost:5000) usually doesn’t.'
};

function showHint(provider) {
  $('providerHint').textContent = HINTS[provider] || '';
}

function showRate(v) {
  $('rateOut').textContent = `${Number(v).toFixed(2)}×`;
}

const settings = await bindSettings(document, (key, value) => {
  if (key === 'provider') showHint(value);
  if (key === 'speechRate') showRate(value);
  $('testResult').textContent = '';
});
showHint(settings.provider);
showRate(settings.speechRate);

$('test').addEventListener('click', async () => {
  const s = await getSettings();
  if (s.provider === 'libretranslate') await requestHostPermission(s.libreUrl);
  const out = $('testResult');
  out.className = 'small muted';
  out.textContent = 'Translating “good morning”…';
  const res = await chrome.runtime.sendMessage({ type: 'translate', text: 'good morning, friends' });
  if (res?.ok) {
    out.className = 'small ok';
    out.textContent = `✓ “${res.result.translation}” (${res.result.sourceLang || '?'} → ${res.result.targetLang})`;
  } else {
    out.className = 'small err';
    out.textContent = `✗ ${res?.error || 'No response'}`;
  }
});

const speakLang = $('speakLang');
LANGUAGES.forEach((l) => speakLang.append(new Option(l.name, l.code)));
speakLang.value = 'fr';
$('speak').addEventListener('click', async () => {
  const s = await getSettings();
  speak($('speakText').value, speakLang.value, s.speechRate);
});

$('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
