// The API client of the realtime-translation plugin: the calls its own views make.
//
// The shared plumbing is ../../shared/api/request.js; the four calls that more than one
// category uses are in ../../shared/api/shared.js. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from '../../shared/api/request.js';

export const api = {
  async getDefaultModel() {
    return fetchJson('/api/config/default-model');
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
