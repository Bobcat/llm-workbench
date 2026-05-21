export function isFirstPassPrompt(record) {
  return String(record?.sections?.translation?.stage || '').trim().toLowerCase() === 'first_pass';
}

export function isSecondPassPrompt(record) {
  return String(record?.sections?.translation?.stage || '').trim().toLowerCase() === 'second_pass';
}

export function formatPromptOptionLabel(record) {
  const title = String(record?.title || '').trim();
  const promptId = String(record?.id || '').trim();
  if (title && promptId && title !== promptId) {
    return `${title} - ${promptId}`;
  }
  return title || promptId || '(unnamed prompt)';
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
