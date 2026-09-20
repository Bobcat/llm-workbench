// The API client of the tts-pool plugin: the calls its own views make.
//
// The shared plumbing is ../../shared/api/request.js; the four calls that more than one
// category uses are in ../../shared/api/shared.js. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from '../../shared/api/request.js';

export const api = {
  async getTtsAdminGpuMemory() {
    return fetchJson('/api/tts-pool/models/admin/gpu-memory');
  },

  async loadTtsAdminModel(modelName, payload = null) {
    const options = {
      method: 'POST',
    };
    if (payload && typeof payload === 'object') {
      options.headers = {'Content-Type': 'application/json'};
      options.body = JSON.stringify(payload);
    }
    return fetchJson(`/api/tts-pool/models/admin/${encodeURIComponent(modelName)}/load`, options);
  },

  async unloadTtsAdminModel(modelName) {
    return fetchJson(`/api/tts-pool/models/admin/${encodeURIComponent(modelName)}/unload`, {
      method: 'POST'
    });
  }
};
