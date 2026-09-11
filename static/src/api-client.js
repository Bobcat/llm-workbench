const API_BASE = '';

async function fetchJson(url, options = {}) {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Accept': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const error = new Error(formatApiErrorMessage(response.status, payload));
    error.status = response.status;
    error.payload = payload;
    error.detail = payload?.detail;
    throw error;
  }

  return response.json();
}

function formatApiErrorMessage(status, payload) {
  const detail = payload?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  if (detail && typeof detail === 'object') {
    if (typeof detail.message === 'string' && detail.message.trim()) {
      return detail.message.trim();
    }
    if (detail.error && typeof detail.error === 'object') {
      if (typeof detail.error.message === 'string' && detail.error.message.trim()) {
        return detail.error.message.trim();
      }
      if (typeof detail.error.type === 'string' && detail.error.type.trim()) {
        return detail.error.type.trim();
      }
    }
    if (typeof detail.error === 'string' && detail.error.trim()) {
      return detail.error.trim();
    }
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload?.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }
  return `HTTP ${status}`;
}

export const api = {
  getPdfArtifactJson(requestId, artifact, options = {}) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifact)}`, options);
  },
  async getDefaultModel() {
    return fetchJson('/api/config/default-model');
  },

  async getModels() {
    return fetchJson('/api/models');
  },

  async testTranslationPrompt(payload) {
    return fetchJson('/api/prompts/test-translation', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

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

  async getAdminModels() {
    return fetchJson('/api/models/admin');
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
  },

  async getTtsModels() {
    return fetchJson('/api/tts-pool/models');
  },

  async getTtsAdminModels() {
    return fetchJson('/api/tts-pool/models/admin');
  },

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
  },

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
  },

  async submitImageRequest(formData) {
    return fetchJson('/api/translation/requests', {
      method: 'POST',
      body: formData,
    });
  },

  async getImageRequest(requestId) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(requestId)}`);
  },

  async cancelImageRequest(requestId) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST'
    });
  },

  async retranslateImageRequest(sourceRequestId, body) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(sourceRequestId)}/retranslate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async rerenderImageRequest(sourceRequestId, body) {
    return fetchJson(`/api/translation/requests/${encodeURIComponent(sourceRequestId)}/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async submitPdfRequest(formData) {
    return fetchJson('/api/pdf-translation/requests', {
      method: 'POST',
      body: formData,
    });
  },

  async listPdfRequests() {
    return fetchJson('/api/pdf-translation/requests');
  },

  async getPdfRequest(requestId) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(requestId)}`);
  },

  async cancelPdfRequest(requestId) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(requestId)}/cancel`, {
      method: 'POST'
    });
  },

  async rerenderPdfRequest(sourceRequestId, body) {
    return fetchJson(`/api/pdf-translation/requests/${encodeURIComponent(sourceRequestId)}/rerender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async getPdfBenchmarkResults() {
    return fetchJson('/api/pdf-benchmark/results');
  },

  async getPdfBenchmarkTestset() {
    return fetchJson('/api/pdf-benchmark/testset');
  },

  async runPdfBenchmark(formData) {
    return fetchJson('/api/pdf-benchmark/run', {
      method: 'POST',
      body: formData,
    });
  },

  async getPdfBenchmarkRunDetail(docId, system, runId = '') {
    const query = runId ? `?run_id=${encodeURIComponent(runId)}` : '';
    return fetchJson(`/api/pdf-benchmark/runs/${encodeURIComponent(docId)}/${encodeURIComponent(system)}${query}`);
  },

  async getPdfBenchmarkRunAnchors(docId, system, runId) {
    return fetchJson(`/api/pdf-benchmark/runs/${encodeURIComponent(docId)}/${encodeURIComponent(system)}/${encodeURIComponent(runId)}/anchors`);
  },

  async deletePdfBenchmarkCell(docId, system, targetLang = null) {
    const query = targetLang !== null ? `?target_lang=${encodeURIComponent(targetLang)}` : '';
    return fetchJson(`/api/pdf-benchmark/runs/${encodeURIComponent(docId)}/${encodeURIComponent(system)}${query}`, {
      method: 'DELETE',
    });
  },

  async listPdfRegressionFixtures() {
    return fetchJson('/api/pdf-regression/fixtures');
  },

  async getPdfAnatomy(name, lang, variant) {
    const seg = encodeURIComponent;
    return fetchJson(`/api/pdf-regression/fixtures/${seg(name)}/${seg(lang)}/${seg(variant)}/anatomy`);
  },

  async getPdfRegressionStatus(requestId) {
    return fetchJson(`/api/pdf-regression/status?request_id=${encodeURIComponent(requestId)}`);
  },

  async capturePdfRegression(body) {
    return fetchJson('/api/pdf-regression/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async runPdfRegression(body) {
    return fetchJson('/api/pdf-regression/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async acceptPdfRegression(body) {
    return fetchJson('/api/pdf-regression/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async deletePdfRegressionFixture(name, lang, variant) {
    return fetchJson(
      `/api/pdf-regression/fixtures/${encodeURIComponent(name)}/${encodeURIComponent(lang)}/${encodeURIComponent(variant)}`,
      { method: 'DELETE' },
    );
  },

  async listPdfRegressionSubdirs() {
    return fetchJson('/api/pdf-regression/subdirs');
  },

  async addPdfRegressionTestset(body) {
    return fetchJson('/api/pdf-regression/add-testset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async getRegressionStatus(name) {
    return fetchJson(`/api/translation/regression/status?name=${encodeURIComponent(name || '')}`);
  },

  async addRegressionTestset(body) {
    return fetchJson('/api/translation/regression/testset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async captureRegressionFixture(body) {
    return fetchJson('/api/translation/regression/fixtures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async listRegressionFixtures() {
    return fetchJson('/api/translation/regression/fixtures');
  },

  async listRegressionSubdirs() {
    return fetchJson('/api/translation/regression/subdirs');
  },

  async runRegressionVariant(body) {
    return fetchJson('/api/translation/regression/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async resnapshotRegression(body) {
    return fetchJson('/api/translation/regression/resnapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async deleteRegressionFixture(name, lang, variant) {
    const segments = [name, lang, variant].filter(Boolean).map(encodeURIComponent).join('/');
    return fetchJson(`/api/translation/regression/fixtures/${segments}`, { method: 'DELETE' });
  },

  async listTranslationPrompts() {
    return fetchJson('/api/translation/prompts');
  },

  async getTranslationPrompt(promptId) {
    return fetchJson(`/api/translation/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`);
  },

  async createTranslationPrompt(body) {
    return fetchJson('/api/translation/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async updateTranslationPrompt(promptId, body) {
    return fetchJson(`/api/translation/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },

  async deleteTranslationPrompt(promptId) {
    return fetchJson(`/api/translation/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`, {
      method: 'DELETE',
    });
  },

  async getTranslationStatus() {
    return fetchJson('/api/translation/status');
  },

  async getReplaySpeakSamples() {
    return fetchJson('/api/realtime-tts/replay/samples');
  },

  async createReplaySpeakSession(payload) {
    return fetchJson('/api/realtime-tts/replay/session', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async setReplaySpeakOptions(sessionId, payload) {
    return fetchJson(`/api/realtime-tts/replay/${sessionId}/options`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async startReplaySpeak(sessionId) {
    return fetchJson(`/api/realtime-tts/replay/${sessionId}/start`, {
      method: 'POST'
    });
  },

  async pauseReplaySpeak(sessionId) {
    return fetchJson(`/api/realtime-tts/replay/${sessionId}/pause`, {
      method: 'POST'
    });
  },

  async resetReplaySpeak(sessionId) {
    return fetchJson(`/api/realtime-tts/replay/${sessionId}/reset`, {
      method: 'POST'
    });
  },

  async getReplaySamples() {
    return fetchJson('/api/replay/samples');
  },

  async createSession(filePath) {
    return fetchJson('/api/replay/session', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({file_path: filePath})
    });
  },

  async startReplay(sessionId) {
    return fetchJson(`/api/replay/${sessionId}/start`, {
      method: 'POST'
    });
  },

  async setSpeed(sessionId, speed) {
    return fetchJson(`/api/replay/${sessionId}/speed`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({speed})
    });
  },

  async setReplayPolicy(sessionId, policy) {
    return fetchJson(`/api/replay/${sessionId}/policy`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({policy})
    });
  },

  async setModel(sessionId, model) {
    return fetchJson(`/api/replay/${sessionId}/model`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model})
    });
  },

  async setCorrectionModel(sessionId, model) {
    return fetchJson(`/api/replay/${sessionId}/second-pass-model`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({model})
    });
  },

  async setFirstPassPrompt(sessionId, promptId) {
    return fetchJson(`/api/replay/${sessionId}/first-pass-prompt`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt_id: promptId})
    });
  },

  async setSecondPassPrompt(sessionId, promptId) {
    return fetchJson(`/api/replay/${sessionId}/second-pass-prompt`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt_id: promptId})
    });
  },

  async setFirstPassLanguages(sessionId, payload) {
    return fetchJson(`/api/replay/${sessionId}/first-pass-languages`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async pauseReplay(sessionId) {
    return fetchJson(`/api/replay/${sessionId}/pause`, {
      method: 'POST'
    });
  },

  async resetReplay(sessionId) {
    return fetchJson(`/api/replay/${sessionId}/reset`, {
      method: 'POST'
    });
  }
};

export class ReplayWebSocket {
  constructor(sessionId, onMessage) {
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.ws = null;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/replay/${this.sessionId}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.onMessage(msg);
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

export class ReplaySpeakWebSocket {
  constructor(sessionId, onMessage) {
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.ws = null;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/replay-speak/${this.sessionId}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.onMessage(message);
      } catch (err) {
        console.error('ReplaySpeak WebSocket parse error:', err);
      }
    };

    this.ws.onerror = (error) => {
      console.error('ReplaySpeak WebSocket error:', error);
    };

    return this.ws;
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
