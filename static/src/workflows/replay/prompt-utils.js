export function formatPromptOptionLabel(record) {
  return String(record?.id || '').trim() || '(unnamed prompt)';
}

export function resolvePromptSelectionId(promptId, records, defaultPromptId = '') {
  const ids = Array.isArray(records) ? records.map((record) => record.id) : [];
  const normalized = String(promptId || '').trim();
  if (normalized && ids.includes(normalized)) {
    return normalized;
  }
  if (defaultPromptId && ids.includes(defaultPromptId)) {
    return defaultPromptId;
  }
  return ids[0] || '';
}
