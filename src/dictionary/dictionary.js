// Dictionary list + spaced-repetition flashcards.
// Works both as a full tab and inside Chrome's side panel.
import '../shared/core.js';
import { getDictionary, getSettings, removeWord, reviewWord, exportData, importData } from '../shared/storage.js';
import { GRADES, isDue, previewIntervals, formatDelay } from '../shared/srs.js';
import { languageName } from '../shared/languages.js';
import { toast } from '../ui/settings-ui.js';

const { isMastered, speak, STORAGE_KEYS } = globalThis.LLCore;
const $ = (id) => document.getElementById(id);

let dict = {};
let settings = {};

// ------------------------------------------------------------ helpers

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

/** Context sentence with the saved word wrapped in <mark>, built without innerHTML. */
function contextNodes(context, word) {
  if (!context) return [];
  const i = context.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());
  if (i < 0) return [context];
  return [context.slice(0, i), el('mark', {}, context.slice(i, i + word.length)), context.slice(i + word.length)];
}

function status(entry, now = Date.now()) {
  if (isMastered(entry)) return 'mastered';
  if (!entry.srs?.lastReview) return 'new';
  return 'learning';
}

function dueLabel(entry, now = Date.now()) {
  const due = entry.srs?.due ?? now;
  return due <= now ? 'due now' : `next in ${formatDelay(due - now)}`;
}

function say(entry) {
  speak(entry.text, entry.sourceLang, settings.speechRate);
}

// ------------------------------------------------------------ tabs

function showTab(name) {
  const review = name === 'review';
  $('tabWords').setAttribute('aria-selected', String(!review));
  $('tabReview').setAttribute('aria-selected', String(review));
  $('wordsView').hidden = review;
  $('reviewView').hidden = !review;
  history.replaceState(null, '', review ? '#review' : '#');
  if (review) startSession();
}

$('tabWords').addEventListener('click', () => showTab('words'));
$('tabReview').addEventListener('click', () => showTab('review'));

function updateCounts() {
  const all = Object.values(dict);
  const now = Date.now();
  $('countAll').textContent = all.length || '';
  $('countDue').textContent = all.filter((e) => isDue(e.srs, now)).length || '';
}

// ------------------------------------------------------------ word list

function renderList() {
  const q = $('search').value.trim().toLocaleLowerCase();
  const filter = $('filter').value;
  const sort = $('sort').value;
  const now = Date.now();

  let items = Object.values(dict).filter((e) => {
    if (filter === 'due' && !isDue(e.srs, now)) return false;
    if (filter === 'mastered' && !isMastered(e)) return false;
    if (filter === 'learning' && isMastered(e)) return false;
    if (!q) return true;
    return [e.text, e.translation, e.context].some((s) => (s || '').toLocaleLowerCase().includes(q));
  });

  const sorters = {
    recent: (a, b) => b.addedAt - a.addedAt,
    alpha: (a, b) => a.text.localeCompare(b.text),
    due: (a, b) => (a.srs?.due ?? 0) - (b.srs?.due ?? 0)
  };
  items.sort(sorters[sort]);

  $('list').replaceChildren(
    ...items.map((e) => {
      const st = status(e, now);
      const pos = (e.partsOfSpeech || []).map((p) => p.pos).slice(0, 2).join(', ');
      return el(
        'li',
        { class: 'item' },
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-word', lang: e.sourceLang }, e.text, e.transcription ? el('span', { class: 'item-phon' }, e.transcription) : null),
          el('div', { class: 'item-tr', lang: e.targetLang }, e.translation),
          e.context ? el('div', { class: 'item-ctx' }, contextNodes(e.context, e.text)) : null,
          el(
            'div',
            { class: 'item-meta' },
            el('span', { class: `chip ${st}` }, st),
            el('span', {}, dueLabel(e, now)),
            pos ? el('span', {}, `· ${pos}`) : null,
            el('span', {}, `· ${languageName(e.sourceLang)} → ${languageName(e.targetLang)}`),
            e.url ? el('a', { href: e.url, target: '_blank', rel: 'noopener', title: e.url }, '· source') : null
          )
        ),
        el(
          'div',
          { class: 'item-actions' },
          el('button', { class: 'icon-btn', type: 'button', title: 'Listen', 'aria-label': `Listen to ${e.text}`, onclick: () => say(e) }, '🔊'),
          el(
            'button',
            {
              class: 'icon-btn del',
              type: 'button',
              title: 'Delete',
              'aria-label': `Delete ${e.text}`,
              onclick: async () => {
                await removeWord(e.key);
                toast(`Removed “${e.text}”`);
              }
            },
            '🗑'
          )
        )
      );
    })
  );
  $('empty').hidden = Object.keys(dict).length > 0;
}

['search', 'filter', 'sort'].forEach((id) => $(id).addEventListener('input', renderList));

$('export').addEventListener('click', async () => {
  const blob = new Blob([JSON.stringify(await exportData(), null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `selective-translate-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const n = await importData(JSON.parse(await file.text()));
    toast(`Imported ${n} entries`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
  e.target.value = '';
});

// ------------------------------------------------------------ flashcards

let queue = [];
let current = null;
let reviewed = 0;
let sessionSize = 0;
let revealed = false;

function startSession() {
  const now = Date.now();
  queue = Object.values(dict)
    .filter((e) => isDue(e.srs, now))
    .sort((a, b) => a.srs.due - b.srs.due)
    .map((e) => e.key);
  reviewed = 0;
  sessionSize = queue.length;
  nextCard();
}

function nextCard() {
  current = null;
  while (queue.length && !current) current = dict[queue.shift()] || null;
  const hasCard = !!current;
  $('session').hidden = !hasCard;
  $('done').hidden = hasCard;
  $('progressBar').style.width = sessionSize ? `${(reviewed / sessionSize) * 100}%` : '0';
  if (!hasCard) return renderDone();

  revealed = false;
  $('cardWord').textContent = current.text;
  $('cardWord').lang = current.sourceLang || '';
  $('cardContext').replaceChildren(...contextNodes(current.context, current.text));
  $('cardBack').hidden = true;
  $('show').hidden = false;
  $('grades').hidden = true;
  $('show').focus();
}

function reveal() {
  if (!current || revealed) return;
  revealed = true;
  $('cardPhon').textContent = current.transcription || '';
  $('cardTranslation').textContent = current.translation;
  $('cardTranslation').lang = current.targetLang || '';
  $('cardPos').replaceChildren(
    ...(current.partsOfSpeech || []).slice(0, 3).map((p) => el('div', {}, el('b', {}, p.pos), ' ', p.terms.slice(0, 4).join(', ')))
  );
  const previews = previewIntervals(current.srs);
  document.querySelectorAll('.grade').forEach((b) => {
    b.querySelector('small').textContent = previews[b.dataset.grade];
  });
  $('cardBack').hidden = false;
  $('show').hidden = true;
  $('grades').hidden = false;
  say(current);
}

async function answer(name) {
  if (!current || !revealed) return;
  const key = current.key;
  const grade = GRADES[name];
  if (grade < 3) queue.push(key); // see it again this session
  else reviewed++;
  await reviewWord(key, grade);
  dict = await getDictionary();
  nextCard();
}

function renderDone() {
  const upcoming = Object.values(dict)
    .map((e) => e.srs?.due)
    .filter((d) => d > Date.now())
    .sort((a, b) => a - b)[0];
  const total = Object.keys(dict).length;
  $('doneTitle').textContent = total ? (reviewed ? `Done — ${reviewed} card${reviewed === 1 ? '' : 's'} reviewed!` : 'All caught up!') : 'No cards yet';
  $('doneText').textContent = !total
    ? 'Save words from any page with the ☆ button in the translation tooltip.'
    : upcoming
      ? `Next card is due in ${formatDelay(upcoming - Date.now())}.`
      : '';
}

$('show').addEventListener('click', reveal);
$('cardSpeak').addEventListener('click', () => current && say(current));
document.querySelectorAll('.grade').forEach((b) => b.addEventListener('click', () => answer(b.dataset.grade)));

document.addEventListener('keydown', (e) => {
  if ($('reviewView').hidden || e.target.matches('input, select, textarea')) return;
  if ((e.key === ' ' || e.key === 'Enter') && !revealed) {
    e.preventDefault();
    reveal();
  } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
    e.preventDefault();
    answer(['again', 'hard', 'good', 'easy'][Number(e.key) - 1]);
  }
});

// ------------------------------------------------------------ init

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.dictionary]) {
    dict = changes[STORAGE_KEYS.dictionary].newValue || {};
    updateCounts();
    renderList();
  }
  if (area === 'sync' && changes[STORAGE_KEYS.settings]) {
    settings = { ...settings, ...(changes[STORAGE_KEYS.settings].newValue || {}) };
  }
});

[dict, settings] = await Promise.all([getDictionary(), getSettings()]);
updateCounts();
renderList();
showTab(location.hash === '#review' ? 'review' : 'words');
