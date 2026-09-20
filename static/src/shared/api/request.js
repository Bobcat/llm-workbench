// The request plumbing every API client shares.
//
// One place does the talking to the workbench: same-origin fetch, JSON, and an error that
// carries the message the server sent. The per-plugin clients in
// static/src/plugins/<category-id>/api.js and the core client in ./shared.js import this.
// See docs/plugin-architecture.md, phase 4.

const API_BASE = '';

export async function fetchJson(url, options = {}) {
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
