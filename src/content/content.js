/*
 * Content script: watches text selection, shows a small floating button and,
 * on click, a tooltip with the translation of *only* the selected text.
 * It also highlights words already saved to the dictionary.
 *
 * Depends on src/shared/core.js (loaded first, exposes globalThis.LLCore).
 */
(() => {
  'use strict';
  if (window.__selectiveTranslateLoaded) return;
  window.__selectiveTranslateLoaded = true;

  const C = globalThis.LLCore;
  const { STORAGE_KEYS } = C;

  let settings = { ...C.DEFAULT_SETTINGS };
  let dictionary = {};

  // ---------------------------------------------------------------- helpers

  function isActive() {
    return settings.enabled && !C.hostnameMatches(location.hostname, settings.disabledSites);
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (e) {
      const invalidated = /context invalidated/i.test(String(e?.message));
      return {
        ok: false,
        error: invalidated ? 'The extension was updated — reload this page.' : String(e?.message || e)
      };
    }
  }

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
  }

  function pageRect(r) {
    return {
      left: r.left + scrollX,
      right: r.right + scrollX,
      top: r.top + scrollY,
      bottom: r.bottom + scrollY,
      width: r.width,
      height: r.height
    };
  }

  const ICONS = {
    translate:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h8M8 3v2M10.5 5c-1 4-3.5 7-6.5 8.5M6.5 9c1.2 2 3 3.5 5 4.5"/><path d="M13 21l4-9 4 9M14.5 18h5"/></svg>',
    speak:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    star:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
    copy:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  function iconButton(name, title, onclick, extraClass = '') {
    const b = h('button', { class: `st-icon ${extraClass}`, title, 'aria-label': title, type: 'button', onclick });
    b.innerHTML = ICONS[name]; // static, trusted SVG
    return b;
  }

  // ---------------------------------------------------------------- UI host

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .st-btn, .st-tip {
      position: absolute;
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: var(--fg); --fg:#1f2330; --muted:#6b7080; --bg:#ffffff; --line:#e6e7ee;
      --accent:#4f46e5; --accent-soft:#eef0ff; --chip:#f3f4f8;
    }
    @media (prefers-color-scheme: dark) {
      .st-btn, .st-tip { --fg:#e8e9f0; --muted:#9a9db0; --bg:#1f2130; --line:#33364a;
        --accent:#8b88ff; --accent-soft:#2b2c48; --chip:#2a2c3d; }
    }
    [hidden] { display: none !important; }
    .st-btn {
      display: grid; place-items: center; width: 28px; height: 28px; padding: 0;
      border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--accent);
      box-shadow: 0 2px 8px rgba(0,0,0,.15); cursor: pointer;
      animation: st-pop .12s ease-out;
    }
    .st-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }
    .st-tip {
      width: max-content; min-width: 200px; max-width: min(380px, calc(100vw - 16px));
      background: var(--bg); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08);
      padding: 10px 12px 8px; animation: st-pop .12s ease-out; text-align: left;
    }
    @keyframes st-pop { from { opacity: 0; transform: translateY(3px); } }
    .st-head {
      display: flex; align-items: center; gap: 6px; margin: -4px -6px 4px; padding: 4px 6px;
      border-radius: 8px; cursor: grab; user-select: none; touch-action: none;
    }
    .st-head:hover { background: var(--chip); }
    .st-tip.dragging { cursor: grabbing; box-shadow: 0 16px 40px rgba(0,0,0,.25); }
    .st-tip.dragging .st-head { cursor: grabbing; }
    .st-icon, .st-select { cursor: pointer; }
    .st-word { font-weight: 650; font-size: 15px; overflow-wrap: anywhere; }
    .st-phon { color: var(--muted); font-size: 13px; }
    .st-spacer { flex: 1; }
    .st-icon {
      display: grid; place-items: center; width: 26px; height: 26px; padding: 0; flex: none;
      border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer;
    }
    .st-icon:hover { background: var(--chip); color: var(--fg); }
    .st-icon.on { color: #eab308; }
    .st-icon.on svg { fill: currentColor; }
    .st-tr { font-size: 15px; overflow-wrap: anywhere; white-space: pre-wrap; }
    .st-tr.phrase { font-size: 14.5px; }
    .st-pos { margin-top: 6px; display: grid; gap: 3px; font-size: 13px; }
    .st-tag {
      display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 4px;
      background: var(--accent-soft); color: var(--accent); font-size: 11.5px; font-weight: 600;
    }
    .st-terms { color: var(--muted); }
    .st-note {
      margin-top: 8px; padding: 8px; border-radius: 8px; background: var(--accent-soft);
      font-size: 12.5px; display: grid; gap: 6px;
    }
    .st-select {
      font: inherit; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px;
      background: var(--bg); color: var(--fg); width: 100%;
    }
    .st-foot { margin-top: 8px; display: flex; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 11.5px; }
    .st-error { color: #dc2626; }
    .st-link { color: var(--accent); cursor: pointer; text-decoration: underline; background: none; border: 0; padding: 0; font: inherit; }
    .st-loading { display: flex; gap: 4px; padding: 6px 0; }
    .st-loading i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: st-dot 1s infinite ease-in-out; }
    .st-loading i:nth-child(2) { animation-delay: .15s; } .st-loading i:nth-child(3) { animation-delay: .3s; }
    @keyframes st-dot { 0%,80%,100% { opacity: .25; } 40% { opacity: 1; } }
  `;

  let host = null;
  let shadow = null;
  let btn = null;
  let tip = null;

  function ensureUI() {
    if (host && host.isConnected) return;
    if (!host) {
      host = document.createElement('selective-translate-root');
      host.style.cssText =
        'all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
      shadow = host.attachShadow({ mode: 'closed' });
      const style = h('style');
      style.textContent = SHADOW_CSS;
      btn = h('button', {
        class: 'st-btn',
        type: 'button',
        title: 'Translate selection',
        'aria-label': 'Translate selection',
        hidden: true,
        style: 'pointer-events:auto'
      });
      btn.innerHTML = ICONS.translate;
      // Keep the page selection alive when the button is pressed.
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pending) openTooltip(pending);
      });
      tip = h('div', { class: 'st-tip', role: 'dialog', 'aria-live': 'polite', hidden: true, style: 'pointer-events:auto' });
      shadow.append(style, btn, tip);
      setupDragging();
    }
    document.documentElement.appendChild(host);
  }

  function eventInsideUI(e) {
    return !!host && e.composedPath().includes(host);
  }

  // ---------------------------------------------------------------- selection

  let pending = null; // last selection waiting for the button click
  let lastPointer = null;

  function contextFor(range, text) {
    const sc = range.startContainer;
    if (sc === range.endContainer && sc.nodeType === Node.TEXT_NODE) {
      return C.extractSentence(sc.data, range.startOffset, range.endOffset);
    }
    const el = sc.nodeType === Node.ELEMENT_NODE ? sc : sc.parentElement;
    const block = el?.closest('p,li,td,th,dd,blockquote,h1,h2,h3,h4,h5,h6,figcaption,article,section,div') || el;
    const full = block?.textContent || '';
    const idx = full.indexOf(text.trim());
    return idx >= 0 ? C.extractSentence(full, idx, idx + text.trim().length) : '';
  }

  function readSelection() {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) {
      try {
        const { selectionStart: s, selectionEnd: e, value } = ae;
        if (s == null || e <= s) return null;
        const r = pageRect(ae.getBoundingClientRect());
        return { text: value.slice(s, e), anchor: r, box: r, context: C.extractSentence(value, s, e) };
      } catch {
        return null; // input types without selection API
      }
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0);
    const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
    const box = range.getBoundingClientRect();
    if (!rects.length && !box.width && !box.height) return null;
    return {
      text,
      anchor: pageRect(rects[rects.length - 1] || box), // end of the selection
      box: pageRect(box),
      context: contextFor(range, text)
    };
  }

  function onSelectionDone() {
    if (!isActive()) return;
    const s = readSelection();
    if (!s) {
      hideButton();
      return;
    }
    const { kind, text } = C.classify(s.text);
    if (kind === 'none') {
      hideButton();
      return;
    }
    // Same selection already shown in the tooltip: nothing to do.
    if (tipState && !tip.hidden && tipState.sel.text === text) return;
    pending = { ...s, kind, text };
    if (settings.triggerMode === 'instant') openTooltip(pending);
    else showButton(pending);
  }

  function showButton(sel) {
    ensureUI();
    const size = 28;
    let left = sel.anchor.right + 4;
    let top = sel.anchor.bottom + 4;
    left = Math.min(left, scrollX + document.documentElement.clientWidth - size - 4);
    btn.style.left = `${Math.max(scrollX + 4, left)}px`;
    btn.style.top = `${top}px`;
    btn.hidden = false;
  }

  function hideButton() {
    if (btn) btn.hidden = true;
  }

  // ---------------------------------------------------------------- tooltip

  let tipState = null; // { sel, result }
  let requestId = 0;

  // Where the user dragged the tooltip, in viewport coordinates (null = next to the selection).
  // Saved so later tooltips open in the same convenient place, on any site.
  const POSITION_KEY = 'tooltipPosition';
  let pinned = null;

  function clampToViewport(x, y) {
    const vw = document.documentElement.clientWidth;
    return {
      x: Math.max(8, Math.min(x, vw - tip.offsetWidth - 8)),
      y: Math.max(8, Math.min(y, innerHeight - tip.offsetHeight - 8))
    };
  }

  function positionTooltip() {
    if (!tipState || tip.hidden) return;
    if (pinned) {
      const { x, y } = clampToViewport(pinned.x, pinned.y);
      tip.style.left = `${scrollX + x}px`;
      tip.style.top = `${scrollY + y}px`;
      return;
    }
    const box = tipState.sel.box;
    const vw = document.documentElement.clientWidth;
    const w = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = Math.min(box.left, scrollX + vw - w - 8);
    left = Math.max(scrollX + 8, left);
    let top = box.bottom + 8;
    const viewBottom = scrollY + innerHeight;
    if (top + th > viewBottom && box.top - th - 8 >= scrollY) top = box.top - th - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  /** Drag the tooltip by its header row; double-click the header to snap back. */
  function setupDragging() {
    let drag = null;
    const onHeader = (e) => e.target.closest?.('.st-head') && !e.target.closest('button, select, a');

    tip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !onHeader(e)) return;
      e.preventDefault(); // no text selection while dragging
      const r = tip.getBoundingClientRect();
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, moved: false };
    });

    tip.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        // Small threshold so clicks and double-clicks on the header aren't drags.
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
        drag.moved = true;
        tip.classList.add('dragging');
        tip.setPointerCapture(e.pointerId); // keep receiving moves even off the tooltip
      }
      const { x, y } = clampToViewport(e.clientX - drag.dx, e.clientY - drag.dy);
      drag.x = x;
      drag.y = y;
      tip.style.left = `${scrollX + x}px`;
      tip.style.top = `${scrollY + y}px`;
    });

    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) {
        pinned = { x: drag.x, y: drag.y };
        chrome.storage.local.set({ [POSITION_KEY]: pinned }).catch(() => {});
      }
      tip.classList.remove('dragging');
      drag = null;
    };
    tip.addEventListener('pointerup', end);
    tip.addEventListener('pointercancel', end);

    tip.addEventListener('dblclick', (e) => {
      if (!onHeader(e)) return;
      pinned = null;
      chrome.storage.local.remove(POSITION_KEY).catch(() => {});
      positionTooltip();
    });
  }

  function closeTooltip() {
    requestId++;
    tipState = null;
    if (tip) {
      tip.hidden = true;
      tip.replaceChildren();
    }
  }

  function hideAll() {
    hideButton();
    closeTooltip();
  }

  async function openTooltip(sel) {
    ensureUI();
    hideButton();
    tipState = { sel, result: null };
    const id = ++requestId;
    tip.replaceChildren(
      h('div', { class: 'st-head' }, h('span', { class: 'st-word' }, sel.kind === 'word' ? sel.text : 'Translating…'), h('span', { class: 'st-spacer' }), iconButton('close', 'Close (Esc)', hideAll)),
      h('div', { class: 'st-loading' }, h('i'), h('i'), h('i'))
    );
    tip.hidden = false;
    positionTooltip();

    const res = await send({ type: 'translate', text: sel.text });
    if (id !== requestId) return; // closed or superseded meanwhile
    if (!res?.ok) {
      renderError(res?.error || 'Translation failed');
      return;
    }
    tipState.result = res.result;
    renderResult();
    if (settings.autoPronounce && res.result.kind === 'word') speakSource();
  }

  function renderError(message) {
    tip.replaceChildren(
      h('div', { class: 'st-head' }, h('span', { class: 'st-word st-error' }, 'Couldn’t translate'), h('span', { class: 'st-spacer' }), iconButton('close', 'Close (Esc)', hideAll)),
      h('div', { class: 'st-tr' }, message),
      h('div', { class: 'st-foot' }, h('button', { class: 'st-link', type: 'button', onclick: () => send({ type: 'openOptions' }) }, 'Open settings'))
    );
    positionTooltip();
  }

  function savedKey(result) {
    return C.dictKey(result.text, result.sourceLang);
  }

  function speakSource() {
    const r = tipState?.result;
    if (r) C.speak(r.text, r.sourceLang, settings.speechRate);
  }

  async function toggleSave(button) {
    const r = tipState?.result;
    if (!r) return;
    const key = savedKey(r);
    button.disabled = true;
    const res = dictionary[key]
      ? await send({ type: 'removeWord', key })
      : await send({
          type: 'saveWord',
          entry: {
            text: r.text,
            kind: r.kind,
            translation: r.translation,
            transcription: r.transcription,
            partsOfSpeech: r.partsOfSpeech,
            sourceLang: r.sourceLang,
            targetLang: r.targetLang,
            context: tipState.sel.context,
            url: location.href
          }
        });
    button.disabled = false;
    if (!res?.ok) {
      renderError(res?.error || 'Could not update the dictionary');
      return;
    }
    if (res.entry) dictionary[key] = res.entry;
    else delete dictionary[key];
    updateSaveButton();
  }

  function updateSaveButton() {
    const b = tip?.querySelector('.st-save');
    if (!b || !tipState?.result) return;
    const saved = !!dictionary[savedKey(tipState.result)];
    b.classList.toggle('on', saved);
    b.title = saved ? 'Remove from dictionary' : 'Add to dictionary';
    b.setAttribute('aria-label', b.title);
  }

  function renderResult() {
    const r = tipState.result;
    const isWord = r.kind === 'word';
    const langs = `${(r.sourceLang || '?').toUpperCase()} → ${(r.targetLang || '').toUpperCase()}`;

    const head = h(
      'div',
      { class: 'st-head', title: 'Drag to move · double-click to put back' },
      isWord ? h('span', { class: 'st-word', lang: r.sourceLang || undefined }, r.text) : h('span', { class: 'st-phon' }, langs),
      isWord && r.transcription ? h('span', { class: 'st-phon' }, r.transcription.startsWith('/') ? r.transcription : `[${r.transcription}]`) : null,
      h('span', { class: 'st-spacer' }),
      iconButton('speak', 'Listen', speakSource),
      iconButton('star', 'Add to dictionary', (e) => toggleSave(e.currentTarget), 'st-save'),
      isWord ? null : iconButton('copy', 'Copy translation', () => navigator.clipboard?.writeText(r.translation)),
      iconButton('close', 'Close (Esc)', hideAll)
    );

    const body = [h('div', { class: `st-tr ${isWord ? '' : 'phrase'}`, lang: r.targetLang }, r.translation || '—')];

    if (isWord) {
      const extras = r.partsOfSpeech.slice(0, 3).map((p) =>
        h(
          'div',
          {},
          h('span', { class: 'st-tag' }, p.pos),
          h('span', { class: 'st-terms' }, p.terms.filter((t) => t !== r.translation).slice(0, 4).join(', '))
        )
      );
      if (!extras.length && r.alternatives.length) {
        extras.push(h('div', {}, h('span', { class: 'st-terms' }, r.alternatives.slice(0, 4).join(', '))));
      }
      if (extras.length) body.push(h('div', { class: 'st-pos' }, extras));
    }

    if (C.sameLanguage(r.sourceLang, r.targetLang)) body.push(sameLanguageNote(r));

    const foot = h('div', { class: 'st-foot' }, h('span', {}, isWord ? langs : ''), h('span', {}, r.provider));
    tip.replaceChildren(head, ...body, foot);
    updateSaveButton();
    positionTooltip();
  }

  /**
   * The text is already in the target language (e.g. EN → EN), usually because
   * the target defaulted to the browser language. Let the user pick one inline.
   */
  function sameLanguageNote(r) {
    const select = h('select', { class: 'st-select', 'aria-label': 'Translate into' }, h('option', { value: '' }, 'Choose a language…'));
    const note = h(
      'div',
      { class: 'st-note' },
      h('div', {}, 'This text is already in the language translations are shown in. Translate into:'),
      select
    );
    send({ type: 'languages' }).then((res) => {
      for (const l of res?.languages || []) {
        if (!C.sameLanguage(l.code, r.targetLang)) select.append(h('option', { value: l.code }, l.name));
      }
    });
    select.addEventListener('change', async () => {
      if (!select.value || !tipState) return;
      const sel = tipState.sel;
      const res = await send({ type: 'setTargetLang', lang: select.value });
      if (!res?.ok) return renderError(res?.error || 'Could not save the language');
      settings.targetLang = select.value;
      openTooltip(sel);
    });
    return note;
  }

  // ---------------------------------------------------------------- highlighting

  const HL_SUPPORTED = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'CANVAS', 'TEMPLATE']);
  let hlTimer = 0;
  let observer = null;

  function scheduleHighlight(delay = 250) {
    if (!HL_SUPPORTED) return;
    clearTimeout(hlTimer);
    hlTimer = setTimeout(runHighlight, delay);
  }

  function clearHighlights() {
    if (!HL_SUPPORTED) return;
    CSS.highlights.delete('st-learning');
    CSS.highlights.delete('st-known');
  }

  function runHighlight() {
    clearHighlights();
    const entries = Object.values(dictionary).filter((e) => e.text && e.text.length <= 60);
    const wanted = settings.highlightSaved && isActive() && entries.length > 0 && document.body;
    toggleObserver(wanted);
    if (!wanted) return;

    const status = new Map(entries.map((e) => [C.normalize(e.text).toLocaleLowerCase(), C.isMastered(e)]));
    const re = C.buildPhraseRegex(entries.map((e) => e.text));
    if (!re) return;

    const learning = new Highlight();
    const known = new Highlight();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName.toUpperCase()) || p.isContentEditable) return NodeFilter.FILTER_REJECT;
        return node.data.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    const deadline = performance.now() + 120; // keep big pages responsive
    let node;
    while ((node = walker.nextNode()) && performance.now() < deadline) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(node.data))) {
        const range = new Range();
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const mastered = status.get(C.normalize(m[0]).toLocaleLowerCase());
        (mastered ? known : learning).add(range);
      }
    }
    CSS.highlights.set('st-learning', learning);
    CSS.highlights.set('st-known', known);
  }

  function toggleObserver(on) {
    if (on && !observer && document.body) {
      observer = new MutationObserver((mutations) => {
        if (mutations.some((m) => m.target !== host && !(host && host.contains(m.target)))) scheduleHighlight(800);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else if (!on && observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // ---------------------------------------------------------------- events

  document.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 0 || eventInsideUI(e)) return;
      lastPointer = { x: e.pageX, y: e.pageY };
      setTimeout(onSelectionDone, 10); // let the browser finalize the selection
    },
    true
  );

  document.addEventListener(
    'keyup',
    (e) => {
      if (eventInsideUI(e)) return;
      if (e.shiftKey || e.key === 'Shift' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) onSelectionDone();
    },
    true
  );

  let selTimer = 0;
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection();
      const ae = document.activeElement;
      const fieldSelected = ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && ae.selectionEnd > ae.selectionStart;
      if ((!sel || sel.isCollapsed) && !fieldSelected) hideButton();
    }, 150);
  });

  document.addEventListener(
    'mousedown',
    (e) => {
      if (eventInsideUI(e)) return;
      hideAll(); // outside click closes the tooltip
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && ((tip && !tip.hidden) || (btn && !btn.hidden))) {
        hideAll();
        e.stopPropagation();
      }
    },
    true
  );

  addEventListener('resize', () => positionTooltip());

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'translateSelection' || !isActive()) return;
    const s = readSelection();
    const raw = s?.text || msg.text;
    const { kind, text } = C.classify(raw || '');
    if (kind === 'none') return;
    const fallback = lastPointer
      ? { left: lastPointer.x, right: lastPointer.x, top: lastPointer.y, bottom: lastPointer.y }
      : { left: scrollX + 16, right: scrollX + 16, top: scrollY + 16, bottom: scrollY + 16 };
    openTooltip({ text, kind, anchor: s?.anchor || fallback, box: s?.box || fallback, context: s?.context || '' });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEYS.settings]) {
      settings = { ...C.DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue || {}) };
      if (!isActive()) hideAll();
      scheduleHighlight(50);
    }
    if (area === 'local' && changes[POSITION_KEY]) {
      pinned = changes[POSITION_KEY].newValue || null; // moved in another tab
    }
    if (area === 'local' && changes[STORAGE_KEYS.dictionary]) {
      dictionary = changes[STORAGE_KEYS.dictionary].newValue || {};
      updateSaveButton();
      scheduleHighlight(50);
    }
  });

  // ---------------------------------------------------------------- init

  (async () => {
    try {
      const [s, d, pos] = await Promise.all([
        chrome.storage.sync.get(STORAGE_KEYS.settings),
        chrome.storage.local.get(STORAGE_KEYS.dictionary),
        chrome.storage.local.get(POSITION_KEY)
      ]);
      pinned = pos[POSITION_KEY] || null;
      settings = { ...C.DEFAULT_SETTINGS, ...(s[STORAGE_KEYS.settings] || {}) };
      dictionary = d[STORAGE_KEYS.dictionary] || {};
      scheduleHighlight(400);
    } catch {
      /* extension context gone */
    }
  })();
})();
