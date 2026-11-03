# Selective Translate

A Chrome extension (Manifest V3) for learning a foreign language by reading real web pages.
It translates **only the text you select**, never the whole page. You read the original
and ask for help only on the word or sentence you don't understand.

- **Select → click → translate.** A small button appears next to your selection. Clicking it opens a tooltip with the translation.
- **Words and sentences are handled differently.** A single word shows its translation, transcription and parts of speech with alternative meanings. A phrase or sentence shows the translation only. The extension detects which one you selected.
- **Pronunciation.** The 🔊 button reads the original text aloud with the Web Speech API.
- **Dictionary.** The ☆ button saves the word, its translation and the sentence it came from.
- **Flashcards.** Saved words come back for review on a spaced-repetition schedule (SM-2). The toolbar badge shows how many cards are due.
- **Progress on the page.** Saved words are highlighted wherever they appear: yellow while you're learning them, green once they're mastered.
- **Swappable translation providers.** Google Translate works with no key. DeepL and LibreTranslate are also supported.

## Install (developer mode)

1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder (the one containing `manifest.json`).
4. Open any article, select a word and click the button that appears.

The settings page opens on first install. **Choose the language you want translations shown in** (it defaults to your browser's UI language). If you select text that is already in that language, for example English text with English as the target, the tooltip says so and lets you pick another language right there.

| Action | How |
| --- | --- |
| Translate a selection | Click the floating button, press <kbd>Alt</kbd>+<kbd>T</kbd>, or right-click → *Translate “…”* |
| Close the tooltip | <kbd>Esc</kbd> or click anywhere outside it |
| Turn off on one site | Popup → *Active on this site* |
| Review flashcards | Popup → **Review cards** (<kbd>Space</kbd> shows the answer, <kbd>1</kbd>–<kbd>4</kbd> rate it) |
| Dictionary in the side panel | Popup → **Dictionary** |

## Project structure

```
manifest.json                 MV3 manifest
src/
  shared/
    core.js                   classic script → globalThis.LLCore: word/phrase detection,
                              sentence extraction, dictionary keys, highlight regex, speech
    storage.js                settings (storage.sync) + dictionary (storage.local)
    srs.js                    SM-2 spaced repetition
    languages.js              language list for the UI
  providers/
    index.js                  provider registry + interface docs
    google.js                 Google Translate (free "gtx" endpoint)
    deepl.js                  DeepL API Free/Pro
    libretranslate.js         LibreTranslate (public or self-hosted)
    http.js                   fetch with timeout + readable errors
  background/
    service-worker.js         message router, context menu, Alt+T command, due-cards badge
    translator.js             provider selection, word enrichment, LRU cache
  content/
    content.js                selection → button → tooltip (Shadow DOM), highlighting
    content.css               ::highlight() styles for saved words
  popup/                      quick settings, stats, links
  options/                    full settings page, provider test, speech test
  dictionary/                 word list + flashcards (used as a tab and as the side panel)
  ui/                         shared CSS + declarative settings binding
test/                         node:test unit tests (+ captured Google responses)
icons/
```

### How a translation flows

```
content.js                     service-worker.js             translator.js → provider
──────────                     ─────────────────             ────────────────────────
mouseup / keyup
  └ getSelection() → LLCore.classify() → word | phrase
  └ show floating button
click ─────── {type:'translate', text} ──▶ handler ─────────▶ cache? → provider.translate()
                                                              word? → + transcription, POS
tooltip ◀──────────── {ok, result} ◀──────────────────────────┘
☆ ─────────── {type:'saveWord', entry} ──▶ storage.saveWord() → storage.local
storage.onChanged ─▶ re-highlight the page, update badge, refresh dictionary page
```

Design choices:

- **No layout breakage.** The button and tooltip live in a closed Shadow DOM attached to `<html>`, so page CSS can't reach them and they don't shift page content. Saved words are marked with the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API), which adds no elements to the DOM.
- **All network calls happen in the service worker.** Host permissions let it make cross-origin requests, so pages with strict CSP or CORS don't interfere.
- **No build step.** The code is plain ES modules. `core.js` is a classic script, so content scripts, modules and Node tests can all share it.

## Translation providers

| Provider | Key | Notes |
| --- | --- | --- |
| Google (default) | none | Unofficial endpoint. Gives transcription and dictionary data (part of speech, alternatives) in one request. Can be rate-limited. |
| DeepL | [Free or Pro key](https://www.deepl.com/pro-api) | Keys ending in `:fx` use `api-free.deepl.com` automatically. |
| LibreTranslate | optional | Self-hosted (`docker run -p 5000:5000 libretranslate/libretranslate`) or libretranslate.com with a key. The extension asks for permission to reach custom hosts. |

For single words, providers without dictionary data (DeepL, LibreTranslate) get transcription and part of speech from Google. English words get IPA from the [Free Dictionary API](https://dictionaryapi.dev/). You can turn word details off in the settings.

> API keys are stored in `chrome.storage.sync`, so they follow your Chrome profile across devices.

### Adding a provider

1. Create `src/providers/myprovider.js`:

   ```js
   import { fetchJson } from './http.js';

   export const myprovider = {
     id: 'myprovider',
     name: 'My Provider',
     needsKey: true,
     // Settings inputs are generated from this list in the popup and options page:
     fields: [{ key: 'myproviderKey', label: 'API key', type: 'password' }],
     maxLength: 5000,
     async translate({ text, from, to, settings, details }) {
       const json = await fetchJson('https://api.example.com/translate', {
         provider: 'My Provider',
         method: 'POST',
         headers: { Authorization: `Bearer ${settings.myproviderKey}`, 'Content-Type': 'application/json' },
         body: JSON.stringify({ text, source: from, target: to })
       });
       return { translation: json.result, detectedSource: json.source };
       // optional: transcription, partsOfSpeech: [{pos, terms}], alternatives
     }
   };
   ```

2. Add it to `PROVIDERS` in `src/providers/index.js`.
3. Add its API host to `host_permissions` in `manifest.json`.
4. Optionally add `myproviderKey: ''` to `DEFAULT_SETTINGS` in `src/shared/core.js`.

Good candidates: Microsoft Translator, Yandex, an LLM such as Claude (context-aware sentence translation), or a local offline model.

## Spaced repetition

`src/shared/srs.js` is a small SM-2 implementation:

| Answer | Effect |
| --- | --- |
| Again | Card lapses, comes back in 10 min (also re-queued in the current session), ease −0.2 |
| Hard | Short interval growth (×1.2), ease −0.14 |
| Good | 1 day → 6 days → interval × ease |
| Easy | Longer interval (× ease × 1.3), ease +0.1 |

A card counts as **mastered** once its interval reaches 21 days. Mastered words are highlighted green on pages.

## Development

```bash
npm test          # unit tests (node:test, no dependencies)
```

```bash
npm run package   # zip for the Chrome Web Store
```

After editing files, click **Reload** on the extension card in `chrome://extensions` and refresh the page you're testing.

## Roadmap / ideas

- **Providers:** Microsoft Translator, an LLM provider that uses the surrounding sentence as context, an offline mode.
- **Dictionary:** tags and decks, Anki/CSV export, editing entries, example sentences from the page.
- **Flashcards:** reverse cards (translation → word), typed answers, audio-only cards, daily goals and streaks.
- **Reading:** hover a highlighted word to see its saved translation, show reading stats per page, PDF viewer support.
- **Other browsers:** Firefox (MV3 with `browser.*` polyfill) and Edge (works as is).
- **i18n:** localize the UI via `_locales/`.

## Privacy

Only the text you explicitly ask to translate is sent to the translation provider you chose. Settings and saved words stay in Chrome storage. Nothing is sent anywhere else.

## License

MIT
