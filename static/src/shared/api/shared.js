// The API calls that more than one plugin uses.
//
// A call that only one category makes belongs to that category, in
// static/src/plugins/<category-id>/api.js. These four are core: measured over the views, they are
// the only ones two categories call. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from './request.js';

export const sharedApi = {
  async getAdminModels() {
    return fetchJson('/api/models/admin');
  },

  async getModels() {
    return fetchJson('/api/models');
  },

  async getTtsAdminModels() {
    return fetchJson('/api/tts-pool/models/admin');
  },

  async listTranslationPrompts() {
    return fetchJson('/api/translation/prompts');
  }
};
