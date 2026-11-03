// Background service worker: owns network calls (host permissions bypass
// page CORS), the context menu, keyboard command and the "due cards" badge.
import '../shared/core.js';
import { translate, clearCache } from './translator.js';
import { getSettings, updateSettings, getDictionary, saveWord, removeWord, getDueWords } from '../shared/storage.js';
import { matchLanguage } from '../shared/languages.js';

const { STORAGE_KEYS, dictKey } = globalThis.LLCore;
const MENU_ID = 'selective-translate';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Translate “%s”', contexts: ['selection'] });
  });
  chrome.alarms.create('badge', { periodInMinutes: 15 });
  if (reason === 'install') {
    // Default the target language to the browser UI language.
    const lang = matchLanguage(chrome.i18n.getUILanguage());
    if (lang) await updateSettings({ targetLang: lang });
    chrome.runtime.openOptionsPage();
  }
  updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);
chrome.alarms.onAlarm.addListener((a) => a.name === 'badge' && updateBadge());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.dictionary]) updateBadge();
  if (area === 'sync' && changes[STORAGE_KEYS.settings]) clearCache();
});

async function updateBadge() {
  const due = (await getDueWords()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
  await chrome.action.setBadgeText({ text: due ? String(due > 99 ? '99+' : due) : '' });
}

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    /* content script not available on this page (chrome://, Web Store, …) */
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id != null) {
    sendToTab(tab.id, { type: 'translateSelection', text: info.selectionText });
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'translate-selection') return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (target?.id != null) sendToTab(target.id, { type: 'translateSelection' });
});

const handlers = {
  async translate({ text }) {
    return { result: await translate(text, await getSettings()) };
  },
  async saveWord({ entry }, sender) {
    return { entry: await saveWord({ ...entry, url: entry.url || sender.tab?.url || '' }) };
  },
  async removeWord({ key }) {
    await removeWord(key);
    return {};
  },
  async lookupSaved({ text, sourceLang }) {
    const dict = await getDictionary();
    return { entry: dict[dictKey(text, sourceLang)] || null };
  },
  async clearCache() {
    clearCache();
    return {};
  },
  async openOptions() {
    await chrome.runtime.openOptionsPage();
    return {};
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  handler(msg, sender)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
  return true; // keep the channel open for the async response
});
