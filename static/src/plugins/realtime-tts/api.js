// The API client of the realtime-tts plugin: the calls its own views make.
//
// The shared plumbing is ../../shared/api/request.js; the four calls that more than one
// category uses are in ../../shared/api/shared.js. See docs/plugin-architecture.md, phase 4.
import { fetchJson } from '../../shared/api/request.js';

export const api = {
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
  }
};

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
