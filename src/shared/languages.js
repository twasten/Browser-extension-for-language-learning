// Language list shown in the UI. Codes follow Google Translate / BCP-47;
// providers map them to their own codes (see src/providers/*.js).
export const LANGUAGES = [
  ['ar', 'Arabic'],
  ['bg', 'Bulgarian'],
  ['ca', 'Catalan'],
  ['zh-CN', 'Chinese (Simplified)'],
  ['zh-TW', 'Chinese (Traditional)'],
  ['hr', 'Croatian'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['nl', 'Dutch'],
  ['en', 'English'],
  ['et', 'Estonian'],
  ['fi', 'Finnish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['he', 'Hebrew'],
  ['hi', 'Hindi'],
  ['hu', 'Hungarian'],
  ['id', 'Indonesian'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['kk', 'Kazakh'],
  ['ko', 'Korean'],
  ['lv', 'Latvian'],
  ['lt', 'Lithuanian'],
  ['no', 'Norwegian'],
  ['fa', 'Persian'],
  ['pl', 'Polish'],
  ['pt', 'Portuguese'],
  ['ro', 'Romanian'],
  ['ru', 'Russian'],
  ['sr', 'Serbian'],
  ['sk', 'Slovak'],
  ['sl', 'Slovenian'],
  ['es', 'Spanish'],
  ['sv', 'Swedish'],
  ['th', 'Thai'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['vi', 'Vietnamese']
].map(([code, name]) => ({ code, name }));

export function languageName(code) {
  if (!code || code === 'auto') return 'Auto-detect';
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === String(code).toLowerCase());
  if (exact) return exact.name;
  const base = String(code).toLowerCase().split('-')[0];
  const byBase = LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base);
  return byBase ? byBase.name : code;
}

/** Best supported UI language for a browser locale like "de-AT". */
export function matchLanguage(locale) {
  if (!locale) return null;
  const l = locale.toLowerCase();
  const exact = LANGUAGES.find((x) => x.code.toLowerCase() === l);
  if (exact) return exact.code;
  if (l.startsWith('zh')) return /tw|hk|hant/.test(l) ? 'zh-TW' : 'zh-CN';
  if (l.startsWith('nb') || l.startsWith('nn')) return 'no';
  if (l.startsWith('iw')) return 'he';
  const base = l.split('-')[0];
  const byBase = LANGUAGES.find((x) => x.code === base);
  return byBase ? byBase.code : null;
}
