import { escapeHtml } from '../../shared/ui-helpers.js';
import { syncSelectTitle } from './ui.js';

function isNearBottom(panel, threshold = 8) {
  if (!panel) return true;
  return panel.scrollTop + panel.clientHeight >= panel.scrollHeight - threshold;
}

function basenameFromPath(path) {
  const normalized = String(path || '').replace(/\\/g, '/');
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function resolveReplaySamplePath(path, sampleFiles, defaultSamplePath) {
  const normalized = String(path || '').trim();
  if (normalized && Array.isArray(sampleFiles)) {
    const exact = sampleFiles.find((item) => item.path === normalized);
    if (exact) return exact.path;
    const basename = basenameFromPath(normalized);
    const byName = sampleFiles.find((item) => item.name === basename);
    if (byName) return byName.path;
  }
  if (Array.isArray(sampleFiles) && sampleFiles.length > 0) {
    return sampleFiles[0].path;
  }
  return defaultSamplePath;
}

export function setupPanelAutoScroll(panel) {
  if (!panel) return;
  panel.dataset.autofollow = 'on';
  panel.addEventListener('scroll', () => {
    panel.dataset.autofollow = isNearBottom(panel) ? 'on' : 'off';
  });
}

export function pinPanelToBottomIfEnabled(panel) {
  if (!panel) return;
  if (panel.dataset.autofollow === 'off') return;
  panel.scrollTop = panel.scrollHeight;
  requestAnimationFrame(() => {
    if (panel.dataset.autofollow === 'off') return;
    panel.scrollTop = panel.scrollHeight;
  });
}

export function setSampleFileSelection(container, path, defaultSamplePath) {
  const select = container.querySelector('#sampleFileSelect');
  const sampleFiles = Array.isArray(container?.__replaySampleFiles) ? container.__replaySampleFiles : [];
  const resolved = resolveReplaySamplePath(path, sampleFiles, defaultSamplePath);
  if (!select) return resolved;
  if (select.value !== resolved) {
    select.value = resolved;
  }
  syncSelectTitle(select);
  return resolved;
}

export function getReplayTranscriptState(container) {
  if (!container.__replayTranscriptState) {
    container.__replayTranscriptState = {
      sourceCommitted: '',
      sourceCommittedFragments: [],
      sourcePreview: '',
      sourcePreviewTiming: null,
      targetCommitted: '',
    };
  }
  return container.__replayTranscriptState;
}

export function applyTranscriptDelta(currentCommitted, data) {
  let nextCommitted = String(currentCommitted || '');
  if (data?.reset === true) {
    nextCommitted = '';
  }
  if (data?.committed_append) {
    nextCommitted += String(data.committed_append);
  }
  return nextCommitted;
}

export function buildTranscriptHtml({ committed, preview, emptyPlaceholder }) {
  let html = '';
  if (committed) {
    html += `<span class="committed-fragment">${escapeHtml(committed)}</span>`;
  }
  if (preview) {
    if (committed && !committed.endsWith(' ') && !preview.startsWith(' ')) {
      html += ' ';
    }
    html += `<span class="preview-fragment">${escapeHtml(preview)}</span>`;
  }
  if (!html) {
    return `<span class="placeholder">${escapeHtml(emptyPlaceholder)}</span>`;
  }
  return html;
}

export function bindSourceTimestampToggle(container) {
  const toggle = container.querySelector('#sourceTimestampToggle');
  if (!toggle || toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';
  toggle.addEventListener('change', () => {
    renderSourceTranscript(container);
  });
}

export function applySourceTranscriptUpdate(state, data) {
  const reset = data?.reset === true;
  const committedAppend = String(data?.committed_append || '');
  const timing = normalizeSourceTiming(data?.source_timing);

  if (!Array.isArray(state.sourceCommittedFragments)) {
    state.sourceCommittedFragments = [];
  }
  if (reset) {
    state.sourceCommittedFragments = [];
  }
  state.sourceCommitted = applyTranscriptDelta(state.sourceCommitted, data);
  if (committedAppend) {
    state.sourceCommittedFragments.push({
      text: committedAppend,
      timing,
    });
  }
  state.sourcePreview = String(data?.preview || '');
  state.sourcePreviewTiming = state.sourcePreview ? timing : null;
}

export function renderSourceTranscript(container) {
  const sourceText = container.querySelector('#sourceText');
  if (!sourceText) return;
  const state = getReplayTranscriptState(container);
  sourceText.innerHTML = buildSourceTranscriptHtml({
    state,
    showTimestamps: isSourceTimestampEnabled(container),
    showRecordedPreviewTiming: isRecordedTimerVisible(container),
    emptyPlaceholder: '(empty)',
  });
}

export function clearReplayView(container) {
  container.__replayTranscriptState = {
    sourceCommitted: '',
    sourceCommittedFragments: [],
    sourcePreview: '',
    sourcePreviewTiming: null,
    targetCommitted: '',
  };
  const sourceText = container.querySelector('#sourceText');
  const targetText = container.querySelector('#targetText');
  if (sourceText) {
    renderSourceTranscript(container);
  }
  if (targetText) {
    targetText.innerHTML = '<span class="placeholder">(waiting for translation)</span>';
  }
  const eventStat = container.querySelector('#eventStat');
  const kindStat = container.querySelector('#kindStat');
  const translatedStat = container.querySelector('#translatedStat');
  const timingStat = container.querySelector('#timingStat');
  const sourceTimingText = container.querySelector('#replaySourceTimingText');
  const sourceRevisionStat = container.querySelector('#sourceRevisionStat');
  const targetRevisionStat = container.querySelector('#targetRevisionStat');
  if (eventStat) eventStat.textContent = '-/-';
  if (kindStat) kindStat.textContent = '-';
  if (translatedStat) {
    translatedStat.textContent = '-';
    translatedStat.className = 'metric-value';
  }
  if (timingStat) timingStat.textContent = '- / -';
  if (sourceTimingText) {
    sourceTimingText.textContent = 'Source timing appears here once replay events arrive.';
    sourceTimingText.classList.add('is-placeholder');
  }
  if (sourceRevisionStat) sourceRevisionStat.textContent = '0';
  if (targetRevisionStat) targetRevisionStat.textContent = '0';
}

function buildSourceTranscriptHtml({ state, showTimestamps, showRecordedPreviewTiming, emptyPlaceholder }) {
  if (!showTimestamps) {
    if (showRecordedPreviewTiming && state.sourcePreview) {
      return buildInlineSourcePreviewTimingHtml({
        committed: state.sourceCommitted,
        preview: state.sourcePreview,
        previewTiming: state.sourcePreviewTiming,
        emptyPlaceholder,
      });
    }
    return buildTranscriptHtml({
      committed: state.sourceCommitted,
      preview: state.sourcePreview,
      emptyPlaceholder,
    });
  }

  let html = '';
  for (const fragment of state.sourceCommittedFragments || []) {
    if (!fragment?.text) continue;
    html += buildTimedSourceLineHtml({
      text: fragment.text,
      timing: fragment.timing,
      lineClass: 'committed-fragment',
    });
  }
  if (state.sourcePreview) {
    html += buildTimedSourceLineHtml({
      text: state.sourcePreview,
      timing: state.sourcePreviewTiming,
      lineClass: 'preview-fragment',
    });
  }
  if (!html) {
    return `<span class="placeholder">${escapeHtml(emptyPlaceholder)}</span>`;
  }
  return html;
}

function buildInlineSourcePreviewTimingHtml({ committed, preview, previewTiming, emptyPlaceholder }) {
  let html = '';
  if (committed) {
    html += `<span class="committed-fragment">${escapeHtml(committed)}</span>`;
  }
  if (preview) {
    if (committed && !committed.endsWith(' ') && !preview.startsWith(' ')) {
      html += ' ';
    }
    html += [
      '<span class="preview-fragment">',
      `<span class="replay-source-timestamp replay-source-timestamp-start">(${formatSourceTimestamp(previewTiming?.startMs)})</span>`,
      `<span class="replay-source-timed-line-text">${escapeHtml(preview)}</span>`,
      `<span class="replay-source-timestamp replay-source-timestamp-end">(${formatSourceTimestamp(previewTiming?.endMs)})</span>`,
      '</span>',
    ].join('');
  }
  if (!html) {
    return `<span class="placeholder">${escapeHtml(emptyPlaceholder)}</span>`;
  }
  return html;
}

function buildTimedSourceLineHtml({ text, timing, lineClass }) {
  return [
    `<span class="replay-source-timed-line ${lineClass}">`,
    `<span class="replay-source-timestamp replay-source-timestamp-start">(${formatSourceTimestamp(timing?.startMs)})</span>`,
    `<span class="replay-source-timed-line-text">${escapeHtml(text)}</span>`,
    `<span class="replay-source-timestamp replay-source-timestamp-end">(${formatSourceTimestamp(timing?.endMs)})</span>`,
    '</span>',
  ].join('');
}

function isSourceTimestampEnabled(container) {
  return container.querySelector('#sourceTimestampToggle')?.checked === true;
}

function isRecordedTimerVisible(container) {
  const timer = container.querySelector('#replayRecordedTimer');
  return Boolean(timer && timer.hidden === false);
}

function normalizeSourceTiming(timing) {
  if (!timing || typeof timing !== 'object') return null;
  const startMs = numberOrNull(timing.speech_start_ms);
  const endMs = numberOrNull(timing.speech_end_ms);
  if (startMs === null || endMs === null) return null;
  return { startMs, endMs };
}

function formatSourceTimestamp(valueMs) {
  if (!Number.isFinite(valueMs)) return '-';
  const totalTenths = Math.max(0, Math.round(valueMs / 100));
  const tenths = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}.${tenths}`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
