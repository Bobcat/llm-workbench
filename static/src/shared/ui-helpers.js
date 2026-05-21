export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(text) {
  return escapeHtml(text).replace(/`/g, '&#96;');
}

export function formatApiError(err) {
  if (!err) return 'unknown error';
  const detail = err.detail;
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
  const message = String(err.message || '').trim();
  return message || 'request failed';
}
