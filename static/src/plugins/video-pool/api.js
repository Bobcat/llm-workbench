// The API client of the video-pool plugin: the calls its own views make.
//
// The shared plumbing is ../../shared/api/request.js; the four calls that more than one
// category uses are in ../../shared/api/shared.js. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from '../../shared/api/request.js';

export const api = {
  async getVideoPoolModels() {
    return fetchJson('/api/video-pool/models');
  },

  async getVideoPoolAdminModels() {
    return fetchJson('/api/video-pool/models/admin');
  },

  async getVideoPoolAdminGpuMemory() {
    return fetchJson('/api/video-pool/models/admin/gpu-memory');
  },

  async loadVideoPoolAdminModel(modelName, payload = null) {
    const options = {
      method: 'POST',
    };
    if (payload && typeof payload === 'object') {
      options.headers = {'Content-Type': 'application/json'};
      options.body = JSON.stringify(payload);
    }
    return fetchJson(`/api/video-pool/models/admin/${encodeURIComponent(modelName)}/load`, options);
  },

  async unloadVideoPoolAdminModel(modelName) {
    return fetchJson(`/api/video-pool/models/admin/${encodeURIComponent(modelName)}/unload`, {
      method: 'POST'
    });
  },

  async runVideoGeneration(payload) {
    return fetchJson('/api/video-pool/videos/generations', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async runImageToVideo(payload) {
    return fetchJson('/api/video-pool/videos/image-to-video', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  }
};
