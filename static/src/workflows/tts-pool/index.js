import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const REFRESH_INTERVAL_MS = 3000;
const INTERACTION_GUARD_MS = 1200;
const TTS_POOL_ADDRESS_LABEL = '@127.0.0.1:8020';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'loaded', label: 'Loaded' },
  { id: 'unloaded', label: 'Unloaded' },
  { id: 'transitioning', label: 'Loading / Unloading' },
  { id: 'problems', label: 'Problems' },
];

const SORTABLE_COLUMNS = [
  { key: 'model', label: 'Model' },
  { key: 'runtime', label: 'State' },
  { key: 'action', label: 'Action' },
  { key: 'inflight', label: 'Inflight' },
  { key: 'queue', label: 'Queue' },
  { key: 'backend', label: 'Backend' },
  { key: 'vram', label: 'VRAM' },
];

export function createTtsPoolView() {
  const container = document.createElement('div');
  container.className = 'llm-pool-view tts-pool-view';

  container.innerHTML = `
    <div class="llm-pool-shell">
      <div class="llm-pool-main">
        <header class="llm-pool-top-bar">
          <div class="llm-pool-topbar">
            <div class="llm-pool-topbar-copy"></div>
          </div>

          <section class="llm-pool-toolbar">
            <div class="llm-pool-filters">
              ${FILTERS.map((filter) => `
                <button type="button" data-filter="${escapeAttr(filter.id)}">${escapeHtml(filter.label)}</button>
              `).join('')}
            </div>
          </section>
        </header>

        <div class="llm-pool-content-area">
          <section class="llm-pool-table-shell">
            <div class="llm-pool-table-header">
              ${SORTABLE_COLUMNS.map((column) => `
                <div class="llm-pool-header-cell">
                  <button
                    type="button"
                    class="llm-pool-sort-btn"
                    data-sort-key="${escapeAttr(column.key)}"
                    aria-label="Sort by ${escapeAttr(column.label.toLowerCase())}"
                  >
                    <span class="llm-pool-sort-label">${escapeHtml(column.label)}</span>
                    <span class="llm-pool-sort-arrow" aria-hidden="true"></span>
                  </button>
                </div>
              `).join('')}
            </div>
            <div id="ttsPoolRows"></div>
          </section>
        </div>

        <footer class="llm-pool-bottom-bar">
          <div class="llm-pool-footer-stats" id="ttsPoolStats">0 models / 0 loaded / 0 failed</div>
          <div class="llm-pool-pool-address" id="ttsPoolAddress">${TTS_POOL_ADDRESS_LABEL} - -</div>
          <div class="llm-pool-footer-refresh" id="ttsPoolRefresh">Last refresh: -</div>
        </footer>
      </div>
    </div>
  `;

  const rowsHost = container.querySelector('#ttsPoolRows');
  const statsEl = container.querySelector('#ttsPoolStats');
  const refreshEl = container.querySelector('#ttsPoolRefresh');
  const addressEl = container.querySelector('#ttsPoolAddress');
  const filterButtons = Array.from(container.querySelectorAll('[data-filter]'));
  const sortButtons = Array.from(container.querySelectorAll('[data-sort-key]'));

  let models = [];
  let gpuMemory = null;
  let activeFilter = 'all';
  let sortKey = 'model';
  let sortDirection = 'asc';
  let lastRefreshLabel = '-';
  let lastError = '';
  let activeActionModel = '';
  let activeActionKind = '';
  const expandedModels = new Set();
  let refreshToken = 0;
  let suppressRefreshUntil = 0;
  let refreshIntervalId = null;

  function setActiveFilter(nextFilter) {
    activeFilter = FILTERS.some((filter) => filter.id === nextFilter) ? nextFilter : 'all';
    render();
  }

  function render() {
    updateFilterButtons();
    updateSortButtons();
    const filtered = filterModels(models, activeFilter);
    const sorted = sortModelsByColumn(filtered, sortKey, sortDirection);
    rowsHost.innerHTML = buildRowsMarkup(sorted, expandedModels, activeActionModel, activeActionKind);
    statsEl.textContent = buildStatsText(models);
    if (addressEl) {
      addressEl.textContent = `${TTS_POOL_ADDRESS_LABEL} - ${buildGpuUsageLabel(gpuMemory)}`;
    }
    refreshEl.textContent = lastError
      ? `Last refresh: error (${lastError})`
      : `Last refresh: ${lastRefreshLabel}`;
  }

  function updateFilterButtons() {
    filterButtons.forEach((button) => {
      const isActive = button.dataset.filter === activeFilter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function updateSortButtons() {
    sortButtons.forEach((button) => {
      const key = String(button.dataset.sortKey || '');
      const isActive = key === sortKey;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      button.setAttribute(
        'aria-label',
        isActive
          ? `Sorted by ${key}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}`
          : `Sort by ${key}`
      );
      const arrow = button.querySelector('.llm-pool-sort-arrow');
      if (arrow) {
        arrow.textContent = isActive ? (sortDirection === 'asc' ? '↑' : '↓') : '';
      }
    });
  }

  function deferAutoRefresh(ms = INTERACTION_GUARD_MS) {
    suppressRefreshUntil = Math.max(suppressRefreshUntil, Date.now() + Math.max(0, ms));
  }

  function shouldSkipAutoRefresh() {
    return Boolean(activeActionModel) || Date.now() < suppressRefreshUntil;
  }

  function stopAutoRefresh() {
    if (refreshIntervalId === null) return;
    window.clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshIntervalId = window.setInterval(() => {
      if (!container.isConnected) {
        stopAutoRefresh();
        return;
      }
      if (shouldSkipAutoRefresh()) return;
      refreshModels({ auto: true });
    }, REFRESH_INTERVAL_MS);
  }

  async function refreshModels(options = {}) {
    const isAutoRefresh = options.auto === true;
    const token = ++refreshToken;
    try {
      const [modelsPayload, gpuPayload] = await Promise.all([
        api.getTtsAdminModels(),
        api.getTtsAdminGpuMemory().catch(() => null),
      ]);
      if (!container.isConnected || token !== refreshToken) return;
      if (isAutoRefresh && shouldSkipAutoRefresh()) return;
      models = normalizeModelsPayload(modelsPayload, gpuPayload);
      gpuMemory = normalizeGpuMemoryPayload(gpuPayload);
      lastError = '';
      lastRefreshLabel = formatClockTime(new Date());
      pruneExpandedModels(expandedModels, models);
    } catch (err) {
      if (!container.isConnected || token !== refreshToken) return;
      if (isAutoRefresh && shouldSkipAutoRefresh()) return;
      models = [];
      gpuMemory = null;
      lastError = formatApiError(err);
      lastRefreshLabel = formatClockTime(new Date());
      expandedModels.clear();
    }
    render();
  }

  async function runAction(modelName, kind) {
    if (!modelName || activeActionModel) return;

    deferAutoRefresh();
    activeActionModel = modelName;
    activeActionKind = kind;
    render();

    try {
      if (kind === 'load') {
        await api.loadTtsAdminModel(modelName);
      } else if (kind === 'unload') {
        await api.unloadTtsAdminModel(modelName);
      }
      lastError = '';
    } catch (err) {
      lastError = formatApiError(err);
    } finally {
      activeActionModel = '';
      activeActionKind = '';
      await refreshModels();
    }
  }

  container.addEventListener('click', (event) => {
    const sortButton = event.target.closest('button[data-sort-key]');
    if (sortButton && container.contains(sortButton)) {
      event.preventDefault();
      deferAutoRefresh(700);
      const nextSortKey = String(sortButton.dataset.sortKey || 'model');
      if (nextSortKey === sortKey) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = nextSortKey;
        sortDirection = 'asc';
      }
      render();
      return;
    }

    const filterButton = event.target.closest('button[data-filter]');
    if (filterButton && container.contains(filterButton)) {
      deferAutoRefresh(700);
      setActiveFilter(filterButton.dataset.filter || 'all');
      return;
    }

    const actionButton = event.target.closest('button[data-action][data-model]');
    if (actionButton && container.contains(actionButton)) {
      event.preventDefault();
      event.stopPropagation();
      deferAutoRefresh();
      const action = String(actionButton.dataset.action || '');
      const model = String(actionButton.dataset.model || '');
      runAction(model, action);
      return;
    }

    const row = event.target.closest('.llm-pool-row.is-expandable[data-model]');
    if (!row || !container.contains(row)) return;
    if (event.target.closest('.llm-pool-cell.actions')) return;

    const modelName = String(row.dataset.model || '');
    if (!modelName) return;
    deferAutoRefresh(700);
    if (expandedModels.has(modelName)) {
      expandedModels.delete(modelName);
    } else {
      expandedModels.add(modelName);
    }
    render();
  });

  setActiveFilter('all');
  container.__onActivate = () => {
    refreshModels();
    startAutoRefresh();
  };
  container.__onDeactivate = () => {
    stopAutoRefresh();
  };

  return container;
}

function normalizeModelsPayload(payload, gpuPayload) {
  const list = Array.isArray(payload?.models) ? payload.models : [];
  const vramByModelName = new Map();
  const gpuModels = Array.isArray(gpuPayload?.models) ? gpuPayload.models : [];
  gpuModels.forEach((model) => {
    const name = String(model?.name || '');
    if (!name) return;
    vramByModelName.set(name, {
      mib: model?.vram_estimate_mib,
      source: model?.vram_estimate_source,
    });
  });

  return list.map((model) => {
    const name = String(model?.name || '');
    const vramEntry = vramByModelName.get(name) || {};
    return {
      name,
      runtime_state: normalizeRuntimeState(model?.runtime_state),
      configured_enabled: model?.configured_enabled,
      inflight_requests: toNonNegativeInt(model?.inflight_requests),
      queue_depth: toNonNegativeInt(model?.queue_depth),
      configured_target_inflight: toNonNegativeInt(model?.configured_target_inflight),
      effective_target_inflight: toNonNegativeInt(model?.effective_target_inflight),
      resolved_backend: String(model?.resolved_backend || ''),
      last_error: model?.last_error,
      vram_estimate_mib: toNonNegativeInt(vramEntry.mib ?? model?.vram_estimate_mib),
      vram_estimate_source: String(vramEntry.source ?? model?.vram_estimate_source ?? ''),
      capabilities: asPlainObject(model?.capabilities),
      definition: asPlainObject(model?.definition),
    };
  });
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeGpuMemoryPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const gpus = Array.isArray(payload.gpus) ? payload.gpus : [];
  return { gpus };
}

function normalizeRuntimeState(state) {
  return String(state || 'unloaded').trim().toLowerCase();
}

function toNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return Math.trunc(parsed);
}

function filterModels(models, filterId) {
  if (!Array.isArray(models)) return [];
  if (filterId === 'loaded') {
    return models.filter((model) => model.runtime_state === 'loaded');
  }
  if (filterId === 'unloaded') {
    return models.filter((model) => model.runtime_state === 'unloaded');
  }
  if (filterId === 'transitioning') {
    return models.filter((model) => model.runtime_state === 'loading' || model.runtime_state === 'unloading');
  }
  if (filterId === 'problems') {
    return models.filter((model) => isProblemRuntimeState(model.runtime_state));
  }
  return models;
}

function sortModelsByColumn(models, key, direction) {
  const factor = direction === 'desc' ? -1 : 1;
  return [...models].sort((left, right) => {
    const leftValue = getSortValue(left, key);
    const rightValue = getSortValue(right, key);
    let cmp = 0;

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      cmp = leftValue - rightValue;
    } else {
      cmp = String(leftValue).localeCompare(String(rightValue), 'nl', { sensitivity: 'base' });
    }

    if (cmp === 0) {
      const leftName = String(left?.name || '');
      const rightName = String(right?.name || '');
      cmp = leftName.localeCompare(rightName, 'nl', { sensitivity: 'base' });
    }

    return cmp * factor;
  });
}

function getSortValue(model, key) {
  const runtime = normalizeRuntimeState(model?.runtime_state);
  if (key === 'runtime') return runtime;
  if (key === 'action') return actionForState(runtime)?.label || '';
  if (key === 'inflight') return toNonNegativeInt(model?.inflight_requests);
  if (key === 'queue') return toNonNegativeInt(model?.queue_depth);
  if (key === 'backend') return String(model?.resolved_backend || model?.definition?.backend || '');
  if (key === 'vram') return toNonNegativeInt(model?.vram_estimate_mib);
  return String(model?.name || '');
}

function runtimeText(state) {
  if (state === 'loading') return 'loading...';
  if (state === 'unloading') return 'unloading...';
  return state || '-';
}

function runtimeClass(state) {
  if (state === 'loaded') return 'runtime-success';
  if (state === 'loading') return 'runtime-accent';
  if (state === 'unloading') return 'runtime-warning';
  if (isProblemRuntimeState(state)) return 'runtime-danger';
  return 'runtime-muted';
}

function isProblemRuntimeState(state) {
  return state === 'failed' || state === 'error';
}

function shouldShowStatePill(state) {
  return state === 'loaded' || isProblemRuntimeState(state);
}

function pillToneForRuntime(state) {
  if (state === 'loaded') return 'pill-success';
  if (isProblemRuntimeState(state)) return 'pill-danger';
  return '';
}

function actionForState(state) {
  if (state === 'loaded') return { kind: 'unload', label: 'Unload' };
  if (state === 'unloaded') return { kind: 'load', label: 'Load' };
  if (isProblemRuntimeState(state)) return { kind: 'load', label: 'Retry' };
  return null;
}

function buildRowsMarkup(models, expandedModels, activeActionModel, activeActionKind) {
  if (!models.length) {
    return `
      <article class="llm-pool-row">
        <div class="llm-pool-cell model">
          <div class="llm-pool-model-name">No models in this view</div>
        </div>
        <div class="llm-pool-cell runtime runtime-muted">-</div>
        <div class="llm-pool-cell actions"></div>
        <div class="llm-pool-cell mono">-</div>
        <div class="llm-pool-cell mono">-</div>
        <div class="llm-pool-cell meta">-</div>
        <div class="llm-pool-cell vram vram-muted">-</div>
      </article>
    `;
  }

  return models.map((model, index) => {
    const name = model.name || '(unnamed)';
    const runtime = model.runtime_state;
    const runtimeForUi = (
      activeActionModel === name
        ? (activeActionKind === 'load'
          ? 'loading'
          : (activeActionKind === 'unload' ? 'unloading' : runtime))
        : runtime
    );
    const action = actionForState(runtime);
    const backend = String(model.resolved_backend || model.definition?.backend || '-');
    const vramMib = toNonNegativeInt(model.vram_estimate_mib);
    const vramText = vramMib > 0 ? `${vramMib}MiB` : '-';
    const vramClass = vramClassForRuntime(runtimeForUi);
    const runtimePill = shouldShowStatePill(runtimeForUi);
    const runtimePillTone = pillToneForRuntime(runtimeForUi);
    const vramPill = shouldShowStatePill(runtimeForUi);
    const vramPillTone = pillToneForRuntime(runtimeForUi);
    const runtimeValue = runtimeText(runtimeForUi);
    const runtimeHtml = runtimePill
      ? `<span class="llm-pool-pill ${escapeAttr(runtimePillTone)}">${escapeHtml(runtimeValue)}</span>`
      : escapeHtml(runtimeValue);
    const vramHtml = vramPill
      ? `<span class="llm-pool-pill ${escapeAttr(vramPillTone)}">${escapeHtml(vramText)}</span>`
      : escapeHtml(vramText);
    const detailsId = `tts-pool-details-${index}`;
    const isExpanded = expandedModels.has(name);
    const isBusyAction = activeActionModel === name && activeActionKind === action?.kind;
    const actionLabel = isBusyAction ? `${action?.label || ''}...` : action?.label || '';
    const rowClass = [
      'llm-pool-row',
      'is-expandable',
      runtime === 'loaded' ? 'is-loaded' : '',
    ].join(' ').trim();

    const modelPath = String(model.definition?.model_path || '-');
    const configuredEnabled = (
      typeof model.configured_enabled === 'boolean'
        ? String(model.configured_enabled)
        : '-'
    );
    const lastError = model.last_error == null || model.last_error === ''
      ? 'none'
      : String(model.last_error);
    const targetInflight = `${model.configured_target_inflight} configured / ${model.effective_target_inflight} effective`;
    const outputFormats = formatList(model.capabilities?.output_formats);
    const capabilities = buildCapabilitiesSummary(model.capabilities);
    const vramSource = String(model.vram_estimate_source || 'unavailable');

    return `
      <article
        class="${rowClass}"
        data-model="${escapeAttr(name)}"
        aria-expanded="${String(isExpanded)}"
      >
        <div class="llm-pool-cell model">
          <div class="llm-pool-model-name">${escapeHtml(name)}</div>
        </div>
        <div class="llm-pool-cell runtime ${runtimeClass(runtimeForUi)}">${runtimeHtml}</div>
        <div class="llm-pool-cell actions">
          ${action ? `
            <button
              type="button"
              data-action="${escapeAttr(action.kind)}"
              data-model="${escapeAttr(name)}"
              ${isBusyAction ? 'disabled' : ''}
            >
              ${escapeHtml(actionLabel)}
            </button>
          ` : ''}
        </div>
        <div class="llm-pool-cell mono">${escapeHtml(String(model.inflight_requests))}</div>
        <div class="llm-pool-cell mono">${escapeHtml(String(model.queue_depth))}</div>
        <div class="llm-pool-cell meta">${escapeHtml(backend)}</div>
        <div class="llm-pool-cell vram ${vramClass}">${vramHtml}</div>
      </article>
      <article
        class="llm-pool-row-details${isExpanded ? ' is-open' : ''}"
        id="${detailsId}"
        ${isExpanded ? '' : 'hidden'}
      >
        <div class="llm-pool-definition-grid">
          <div><span>Path</span><code>${escapeHtml(modelPath)}</code></div>
          <div><span>Backend</span><strong>${escapeHtml(backend)}</strong></div>
          <div><span>Configured enabled</span><strong>${escapeHtml(configuredEnabled)}</strong></div>
          <div><span>Target inflight</span><strong>${escapeHtml(targetInflight)}</strong></div>
          <div><span>Output formats</span><strong>${escapeHtml(outputFormats)}</strong></div>
          <div><span>Capabilities</span><strong>${escapeHtml(capabilities)}</strong></div>
          <div><span>Last error</span><strong>${escapeHtml(lastError)}</strong></div>
          <div><span>VRAM source</span><strong>${escapeHtml(vramSource)}</strong></div>
        </div>
      </article>
    `;
  }).join('');
}

function formatList(value) {
  if (!Array.isArray(value) || !value.length) return '-';
  return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(', ') || '-';
}

function buildCapabilitiesSummary(capabilities) {
  const parts = [];
  if (capabilities?.streaming === true) {
    parts.push('streaming');
  }
  if (capabilities?.voice_presets === true) {
    parts.push('voice presets');
  }
  if (capabilities?.voice_instructions === true) {
    parts.push('voice instructions');
  }
  if (capabilities?.reference_audio === true) {
    parts.push('reference audio');
  }
  const languages = Array.isArray(capabilities?.languages) ? capabilities.languages.length : 0;
  if (languages > 0) {
    parts.push(`${languages} languages`);
  }
  const requestGeneration = capabilities?.request_generation;
  if (requestGeneration && typeof requestGeneration === 'object' && !Array.isArray(requestGeneration)) {
    const controlCount = Object.keys(requestGeneration).length;
    if (controlCount > 0) {
      parts.push(`${controlCount} generation controls`);
    }
  }
  return parts.join(', ') || '-';
}

function isActiveVramState(runtimeState) {
  return runtimeState === 'loaded' || runtimeState === 'loading' || runtimeState === 'unloading';
}

function vramClassForRuntime(runtimeState) {
  if (isProblemRuntimeState(runtimeState)) return 'vram-danger';
  return isActiveVramState(runtimeState) ? 'vram-active' : 'vram-muted';
}

function buildStatsText(models) {
  const total = models.length;
  const loaded = models.filter((model) => model.runtime_state === 'loaded').length;
  const failed = models.filter((model) => isProblemRuntimeState(model.runtime_state)).length;
  return `${total} models / ${loaded} loaded / ${failed} failed`;
}

function buildGpuUsageLabel(gpuMemory) {
  const firstGpu = gpuMemory?.gpus?.[0];
  if (!firstGpu) return '-';

  const usedOverTotal = String(firstGpu.used_over_total || '').trim();
  if (usedOverTotal) {
    return usedOverTotal;
  }

  const usedMib = toNonNegativeInt(firstGpu.used_mib);
  const totalMib = toNonNegativeInt(firstGpu.total_mib);
  if (usedMib > 0 || totalMib > 0) {
    return `${usedMib}MiB / ${totalMib}MiB`;
  }
  return '-';
}

function formatClockTime(now) {
  return now.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function pruneExpandedModels(expandedModels, models) {
  const known = new Set(models.map((model) => model.name));
  [...expandedModels].forEach((name) => {
    if (!known.has(name)) expandedModels.delete(name);
  });
}
