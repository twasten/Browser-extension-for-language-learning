// Thin wrapper around chrome.storage.
// Settings -> chrome.storage.sync (small, follows the user across devices).
// Dictionary -> chrome.storage.local (can grow; not size-limited like sync).
import './core.js';
import { newCard, review as srsReview, isDue } from './srs.js';

const { DEFAULT_SETTINGS, STORAGE_KEYS, dictKey, normalize } = globalThis.LLCore;

export async function getSettings() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.settings] || {}) };
}

export async function updateSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

export async function getDictionary() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.dictionary);
  return data[STORAGE_KEYS.dictionary] || {};
}

async function setDictionary(dict) {
  await chrome.storage.local.set({ [STORAGE_KEYS.dictionary]: dict });
}

/**
 * Add (or refresh) a word/phrase. Keeps existing SRS progress if the entry
 * already exists. Returns the stored entry.
 */
export async function saveWord(input, now = Date.now()) {
  const text = normalize(input.text);
  if (!text) throw new Error('Nothing to save');
  const key = dictKey(text, input.sourceLang);
  const dict = await getDictionary();
  const prev = dict[key];
  const entry = {
    key,
    text,
    kind: input.kind || 'word',
    translation: input.translation || prev?.translation || '',
    transcription: input.transcription || prev?.transcription || '',
    partsOfSpeech: input.partsOfSpeech || prev?.partsOfSpeech || [],
    sourceLang: input.sourceLang || prev?.sourceLang || 'auto',
    targetLang: input.targetLang || prev?.targetLang || '',
    context: input.context || prev?.context || '',
    url: input.url || prev?.url || '',
    addedAt: prev?.addedAt || now,
    srs: prev?.srs || newCard(now)
  };
  dict[key] = entry;
  await setDictionary(dict);
  return entry;
}

export async function removeWord(key) {
  const dict = await getDictionary();
  delete dict[key];
  await setDictionary(dict);
}

export async function reviewWord(key, grade, now = Date.now()) {
  const dict = await getDictionary();
  if (!dict[key]) return null;
  dict[key] = { ...dict[key], srs: srsReview(dict[key].srs, grade, now) };
  await setDictionary(dict);
  return dict[key];
}

export async function getDueWords(now = Date.now()) {
  const dict = await getDictionary();
  return Object.values(dict)
    .filter((e) => isDue(e.srs, now))
    .sort((a, b) => a.srs.due - b.srs.due);
}

export async function exportData() {
  return {
    format: 'selective-translate',
    version: 1,
    exportedAt: new Date().toISOString(),
    dictionary: await getDictionary()
  };
}

/** Merge an export into the current dictionary. Returns number of entries imported. */
export async function importData(data) {
  if (!data || typeof data.dictionary !== 'object') throw new Error('Not a Selective Translate export');
  const dict = await getDictionary();
  let n = 0;
  for (const entry of Object.values(data.dictionary)) {
    if (!entry || !entry.text) continue;
    const key = dictKey(entry.text, entry.sourceLang);
    dict[key] = { ...entry, key, srs: entry.srs || newCard() };
    n++;
  }
  await setDictionary(dict);
  return n;
}
