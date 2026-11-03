/*
 * Translation provider registry.
 *
 * A provider is a plain object:
 *   {
 *     id: 'myprovider',             // stored in settings.provider
 *     name: 'Human readable name',
 *     needsKey: boolean,
 *     fields: [{ key, label, type, placeholder, requestsHost? }], // settings UI is generated from this
 *     maxLength: number,            // max characters per request
 *     async translate({ text, from, to, settings, details }) {
 *       return {
 *         translation: string,      // required
 *         detectedSource?: string,  // language code
 *         transcription?: string,   // pronunciation of the source word
 *         partsOfSpeech?: [{ pos, terms: string[] }],
 *         alternatives?: string[]
 *       };
 *     }
 *   }
 *
 * To add a provider: create src/providers/<id>.js, add it below, and add its
 * API host to "host_permissions" in manifest.json (or rely on the optional
 * host permission request for user-configured URLs).
 */
import { google } from './google.js';
import { deepl } from './deepl.js';
import { libretranslate } from './libretranslate.js';

export const PROVIDERS = [google, deepl, libretranslate];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || google;
}

export function listProviders() {
  return PROVIDERS.map(({ id, name, needsKey, fields }) => ({ id, name, needsKey, fields }));
}
