import '../shared/core.js';
import { bindSettings } from '../ui/settings-ui.js';
import { getDictionary, getSettings, updateSettings } from '../shared/storage.js';
import { isDue } from '../shared/srs.js';

const { hostnameMatches, isMastered } = globalThis.LLCore;
const $ = (id) => document.getElementById(id);

async function renderStats() {
  const entries = Object.values(await getDictionary());
  const now = Date.now();
  $('statSaved').textContent = entries.length;
  $('statDue').textContent = entries.filter((e) => isDue(e.srs, now)).length;
  $('statKnown').textContent = entries.filter(isMastered).length;
  $('review').disabled = entries.length === 0;
}

async function setupSiteToggle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let hostname = '';
  try {
    const url = new URL(tab?.url || '');
    if (/^https?:$/.test(url.protocol)) hostname = url.hostname;
  } catch {
    /* no URL access (chrome:// pages etc.) */
  }
  if (!hostname) return;
  const settings = await getSettings();
  $('siteRow').hidden = false;
  $('siteName').textContent = hostname.replace(/^www\./, '');
  $('siteToggle').checked = !hostnameMatches(hostname, settings.disabledSites);
  $('siteToggle').addEventListener('change', async (e) => {
    const s = await getSettings();
    const site = hostname.replace(/^www\./, '');
    const list = s.disabledSites.filter((p) => !hostnameMatches(hostname, [p]));
    if (!e.target.checked) list.push(site);
    await updateSettings({ disabledSites: list });
  });
}

function openDictionaryPage(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/dictionary/dictionary.html${hash}`) });
  window.close();
}

$('review').addEventListener('click', () => openDictionaryPage('#review'));

$('dictionary').addEventListener('click', async () => {
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  } catch {
    openDictionaryPage();
  }
});

$('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

$('swap').addEventListener('click', async () => {
  const s = await getSettings();
  if (s.sourceLang === 'auto') return;
  await updateSettings({ sourceLang: s.targetLang, targetLang: s.sourceLang });
  await bindSettings(document); // refresh the selects
});

bindSettings(document);
renderStats();
setupSiteToggle();
