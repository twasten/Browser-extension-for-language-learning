// Declarative settings binding shared by the popup and the options page.
//
//   <select data-setting="targetLang" data-options="languages"></select>
//   <input type="checkbox" data-setting="highlightSaved">
//   <div data-provider-fields></div>   <- filled from the provider's `fields`
//
// Every [data-setting] element is loaded from storage and saved on change.
import '../shared/core.js';
import { getSettings, updateSettings } from '../shared/storage.js';
import { LANGUAGES } from '../shared/languages.js';
import { PROVIDERS, getProvider } from '../providers/index.js';

function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function fillOptions(select) {
  const kind = select.dataset.options;
  if (!kind || select.options.length) return;
  if (kind === 'languages+auto') select.append(option('auto', 'Auto-detect'));
  if (kind.startsWith('languages')) LANGUAGES.forEach((l) => select.append(option(l.code, l.name)));
  if (kind === 'providers') PROVIDERS.forEach((p) => select.append(option(p.id, p.name)));
}

function readValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number' || el.type === 'range') return Number(el.value);
  if (el.dataset.type === 'list') {
    return el.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  return el.value;
}

function writeValue(el, value) {
  if (el.type === 'checkbox') el.checked = !!value;
  else if (el.dataset.type === 'list') el.value = (value || []).join('\n');
  else el.value = value ?? '';
}

/** Ask for access to a user-supplied API host (e.g. a self-hosted LibreTranslate). */
export function requestHostPermission(url) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return Promise.resolve(false);
  }
  return chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
}

function bindElement(el, settings, onChange) {
  fillOptions(el);
  writeValue(el, settings[el.dataset.setting]);
  if (el.dataset.bound) return;
  el.dataset.bound = '1';
  el.addEventListener('change', async () => {
    const value = readValue(el);
    // Permission prompts must start inside the user gesture, before any await.
    const perm = el.dataset.requestsHost ? requestHostPermission(value) : null;
    const next = await updateSettings({ [el.dataset.setting]: value });
    if (perm) await perm;
    onChange?.(el.dataset.setting, value, next);
  });
}

function renderProviderFields(container, settings, onChange) {
  const provider = getProvider(settings.provider);
  container.replaceChildren();
  for (const f of provider.fields) {
    const label = document.createElement('label');
    label.className = 'field';
    const span = document.createElement('span');
    span.textContent = f.label;
    const input = document.createElement('input');
    input.type = f.type || 'text';
    input.placeholder = f.placeholder || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.setting = f.key;
    if (f.requestsHost) input.dataset.requestsHost = '1';
    label.append(span, input);
    container.append(label);
    bindElement(input, settings, onChange);
  }
  container.hidden = provider.fields.length === 0;
}

/**
 * Bind every [data-setting] under `root`. Returns the loaded settings.
 * `onChange(key, value, settings)` is called after each save.
 */
export async function bindSettings(root = document, onChange) {
  let settings = await getSettings();
  const providerBox = root.querySelector('[data-provider-fields]');
  const handle = (key, value, next) => {
    settings = next;
    if (key === 'provider' && providerBox) renderProviderFields(providerBox, settings, handle);
    onChange?.(key, value, next);
  };
  root.querySelectorAll('[data-setting]').forEach((el) => bindElement(el, settings, handle));
  if (providerBox) renderProviderFields(providerBox, settings, handle);
  return settings;
}

export function toast(message, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = message;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
