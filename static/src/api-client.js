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
  async getDefaultModel() {
    return fetchJson('/api/config/default-model');
  },

  async getModels() {
    return fetchJson('/api/models');
  },

  async getPrompts(includeDisabled = true) {
    const query = includeDisabled ? '?include_disabled=true' : '?include_disabled=false';
    return fetchJson(`/api/prompts${query}`);
  },

  async getPrompt(promptId) {
    return fetchJson(`/api/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`);
  },

  async getPromptLoadIssues() {
    return fetchJson('/api/prompts/load-issues');
  },

  async createPrompt(payload) {
    return fetchJson('/api/prompts', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async updatePrompt(promptId, payload) {
    return fetchJson(`/api/prompts/${encodeURIComponent(promptId).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async renamePrompt(promptId, newPromptId) {
    return fetchJson('/api/prompts/rename', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt_id: promptId, new_prompt_id: newPromptId})
    });
  },

  async duplicatePrompt(promptId, newPromptId) {
    return fetchJson('/api/prompts/duplicate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt_id: promptId, new_prompt_id: newPromptId})
    });
  },

  async archivePrompt(promptId) {
    return fetchJson('/api/prompts/archive', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt_id: promptId})
    });
  },

  async testTranslationPrompt(payload) {
    return fetchJson('/api/prompts/test-translation', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
  },

  async runPrompt(payload) {
    return fetchJson('/api/prompts/run', {
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
