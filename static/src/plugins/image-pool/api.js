// The API client of the image-pool plugin: the calls its own views make.
//
// The shared plumbing is ../../shared/api/request.js; the four calls that more than one
// category uses are in ../../shared/api/shared.js. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from '../../shared/api/request.js';

export const api = {
  async getImagePoolModels() {
    return fetchJson('/api/image-pool/models');
  },

  async getImagePoolAdminModels() {
    return fetchJson('/api/image-pool/models/admin');
  },

  async getImagePoolAdminGpuMemory() {
    return fetchJson('/api/image-pool/models/admin/gpu-memory');
  },

  async loadImagePoolAdminModel(modelName, payload = null) {
    const options = {
      method: 'POST',
    };
    if (payload && typeof payload === 'object') {
      options.headers = {'Content-Type': 'application/json'};
      options.body = JSON.stringify(payload);
    }
    return fetchJson(`/api/image-pool/models/admin/${encodeURIComponent(modelName)}/load`, options);
  },

  async unloadImagePoolAdminModel(modelName) {
    return fetchJson(`/api/image-pool/models/admin/${encodeURIComponent(modelName)}/unload`, {
      method: 'POST'
    });
  },

  async getImagePoolLoras() {
    return fetchJson('/api/image-pool/loras');
  },

  async inspectImagePoolLora(formData) {
    return fetchJson('/api/image-pool/loras/inspect', {
      method: 'POST',
      body: formData
    });
  },

  async importImagePoolLora(payload) {
    return fetchJson('/api/image-pool/loras/import', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async deleteImagePoolLora(slug) {
    return fetchJson(`/api/image-pool/loras/${encodeURIComponent(slug)}`, {
      method: 'DELETE'
    });
  },

  async updateImagePoolLora(slug, payload) {
    return fetchJson(`/api/image-pool/loras/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async getImageTrainingDatasets() {
    return fetchJson('/api/image-pool/training/datasets');
  },

  async createImageTrainingDataset(payload) {
    return fetchJson('/api/image-pool/training/datasets', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async getImageTrainingDataset(datasetSlug) {
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}`);
  },

  async deleteImageTrainingDataset(datasetSlug) {
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}`, {
      method: 'DELETE'
    });
  },

  async uploadImageTrainingDatasetFiles(datasetSlug, formData) {
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}/files`, {
      method: 'POST',
      body: formData
    });
  },

  async downloadImageTrainingSampleDataset(datasetSlug = 'bfl-graphic-impressions') {
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}/sample-download`, {
      method: 'POST'
    });
  },

  async getImageTrainingRun(datasetSlug, trainer = '') {
    const query = trainer ? `?trainer=${encodeURIComponent(trainer)}` : '';
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}/run${query}`);
  },

  async startImageTrainingRun(datasetSlug, payload) {
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}/run`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async stopImageTrainingRun(datasetSlug, trainer = '') {
    const query = trainer ? `?trainer=${encodeURIComponent(trainer)}` : '';
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}/stop${query}`, {
      method: 'POST'
    });
  },

  async captionImageTrainingImage(datasetSlug, payload) {
    return fetchJson(`/api/image-pool/training/datasets/${encodeURIComponent(datasetSlug)}/caption`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async runImageGeneration(payload) {
    return fetchJson('/api/image-pool/images/generations', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async runImageEdit(payload) {
    return fetchJson('/api/image-pool/images/edits', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  }
};
