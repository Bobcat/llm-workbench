// The API client of the llm-pool plugin: the calls its own views make.
//
// The shared plumbing is ../../shared/api/request.js; the four calls that more than one
// category uses are in ../../shared/api/shared.js. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from '../../shared/api/request.js';

export const api = {
  async runTextGeneration(payload) {
    return fetchJson('/api/text-generation/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async runChatPrompt(payload) {
    return fetchJson('/api/chat/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async getAdminGpuMemory() {
    return fetchJson('/api/models/admin/gpu-memory');
  },

  async loadAdminModel(modelName, payload = null) {
    const options = {
      method: 'POST',
    };
    if (payload && typeof payload === 'object') {
      options.headers = {'Content-Type': 'application/json'};
      options.body = JSON.stringify(payload);
    }
    return fetchJson(`/api/models/admin/${encodeURIComponent(modelName)}/load`, options);
  },

  async unloadAdminModel(modelName) {
    return fetchJson(`/api/models/admin/${encodeURIComponent(modelName)}/unload`, {
      method: 'POST'
    });
  }
};
