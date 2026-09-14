import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const REFRESH_INTERVAL_MS = 3000;
const INTERACTION_GUARD_MS = 1200;
const LLM_POOL_ADDRESS_LABEL = 'llm-pool';
const LOAD_SETTING_SLIDER_MAX = 65536;
const VLLM_KV_CACHE_STEP_MIB = 256;
const VLLM_KV_CACHE_MAX_MIB = 64 * 1024;
const TRTLLM_KV_CACHE_STEP_MIB = 256;
const TRTLLM_KV_CACHE_MAX_MIB = 64 * 1024;
const LLAMA_SERVER_SPEC_DRAFT_P_MIN_STEP = 0.05;
const SGLANG_WORKBENCH_KV_CACHE_DTYPES = new Set([
  'auto',
  'bf16',
  'fp8_e4m3',
  'fp8_e5m2',
]);

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
  { key: 'backend', label: 'Backend' },
  { key: 'replicas', label: 'Replicas' },
  { key: 'vram', label: 'VRAM' },
];

export function createLlmPoolView() {
  const container = document.createElement('div');
  container.className = 'llm-pool-view';

  container.innerHTML = `
    <div class="llm-pool-shell">
      <div class="llm-pool-main">
        <header class="llm-pool-top-bar">
          <div class="llm-pool-topbar">
            <div class="llm-pool-topbar-copy"></div>
          </div>

          <section class="llm-pool-toolbar">
            <div class="llm-pool-filters">
              ${FILTERS.map((f) => `
                <button type="button" data-filter="${escapeAttr(f.id)}">${escapeHtml(f.label)}</button>
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
            <div id="llmPoolRows"></div>
          </section>
        </div>

        <footer class="llm-pool-bottom-bar">
          <div class="llm-pool-footer-stats" id="llmPoolStats">0 models / 0 loaded / 0 failed</div>
          <div class="llm-pool-pool-address" id="llmPoolAddress">${LLM_POOL_ADDRESS_LABEL} - -</div>
          <div class="llm-pool-footer-refresh" id="llmPoolRefresh">Last refresh: -</div>
        </footer>
      </div>
    </div>
  `;

  const rowsHost = container.querySelector('#llmPoolRows');
  const statsEl = container.querySelector('#llmPoolStats');
  const refreshEl = container.querySelector('#llmPoolRefresh');
  const addressEl = container.querySelector('#llmPoolAddress');
  const filterButtons = Array.from(container.querySelectorAll('[data-filter]'));
  const sortButtons = Array.from(container.querySelectorAll('[data-sort-key]'));

  let models = [];
  let gpuMemory = null;
  let poolAddressLabel = LLM_POOL_ADDRESS_LABEL;
  let activeFilter = 'all';
  let sortKey = 'model';
  let sortDirection = 'asc';
  let lastRefreshLabel = '-';
  let lastError = '';
  let activeActionModel = '';
  let activeActionKind = '';
  const expandedModels = new Set();
  const loadSettingDrafts = new Map();
  let refreshToken = 0;
  let suppressRefreshUntil = 0;
  let refreshIntervalId = null;

  function setActiveFilter(nextFilter) {
    activeFilter = FILTERS.some((f) => f.id === nextFilter) ? nextFilter : 'all';
    render();
  }

  function updateFilterButtons() {
    filterButtons.forEach((button) => {
      const isActive = button.dataset.filter === activeFilter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function render() {
    updateFilterButtons();
    updateSortButtons();
    const filtered = filterModels(models, activeFilter);
    const sorted = sortModelsByColumn(filtered, sortKey, sortDirection, loadSettingDrafts);
    rowsHost.innerHTML = buildRowsMarkup(
      sorted,
      expandedModels,
      activeActionModel,
      activeActionKind,
      loadSettingDrafts
    );
    statsEl.textContent = buildStatsText(models);
    if (addressEl) {
      addressEl.textContent = `${poolAddressLabel} - ${buildGpuUsageLabel(gpuMemory)}`;
    }
    refreshEl.textContent = lastError
      ? `Last refresh: error (${lastError})`
      : `Last refresh: ${lastRefreshLabel}`;
  }

  function deferAutoRefresh(ms = INTERACTION_GUARD_MS) {
    suppressRefreshUntil = Math.max(suppressRefreshUntil, Date.now() + Math.max(0, ms));
  }

  function shouldSkipAutoRefresh() {
    return Boolean(activeActionModel) || Date.now() < suppressRefreshUntil || hasFocusedLoadSetting();
  }

  function hasFocusedLoadSetting() {
    return Boolean(container.querySelector(
      'input[data-load-setting]:focus, select[data-load-setting]:focus, select[data-load-preset-kind]:focus'
    ));
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
        api.getAdminModels(),
        api.getAdminGpuMemory().catch(() => null),
      ]);
      if (!container.isConnected || token !== refreshToken) return;
      if (isAutoRefresh && shouldSkipAutoRefresh()) return;
      models = normalizeModelsPayload(modelsPayload, gpuPayload);
      poolAddressLabel = formatPoolAddressLabel(modelsPayload?.proxy_base_url);
      gpuMemory = normalizeGpuMemoryPayload(gpuPayload);
      lastError = '';
      lastRefreshLabel = formatClockTime(new Date());
      pruneExpandedModels(expandedModels, models);
      pruneLoadSettingDrafts(loadSettingDrafts, models);
    } catch (err) {
      if (!container.isConnected || token !== refreshToken) return;
      if (isAutoRefresh && shouldSkipAutoRefresh()) return;
      models = [];
      gpuMemory = null;
      lastError = formatApiError(err);
      lastRefreshLabel = formatClockTime(new Date());
      expandedModels.clear();
      loadSettingDrafts.clear();
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
      const model = models.find((entry) => entry.name === modelName) || null;
      if (kind === 'load') {
        await api.loadAdminModel(modelName, buildLoadPayload(model, loadSettingDrafts.get(modelName)));
      } else if (kind === 'unload') {
        await api.unloadAdminModel(modelName);
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

  container.addEventListener('input', (event) => {
    const control = event.target.closest('input[data-load-setting][data-model]');
    if (!control || !container.contains(control)) return;
    const modelName = String(control.dataset.model || '');
    const settingKey = String(control.dataset.loadSetting || '');
    const value = parseLoadSettingControlValue(settingKey, control.value);
    if (!modelName || !settingKey || value === undefined) return;
    deferAutoRefresh();
    setLoadSettingDraft(loadSettingDrafts, modelName, settingKey, value);
    const valueEl = control
      .closest('.llm-pool-load-setting')
      ?.querySelector('[data-load-setting-value]');
    if (valueEl) {
      valueEl.textContent = formatSliderSettingValue(settingKey, value);
    }
  });

  container.addEventListener('change', (event) => {
    const loadSettingControl = event.target.closest('select[data-load-setting][data-model]');
    if (loadSettingControl && container.contains(loadSettingControl)) {
      const modelName = String(loadSettingControl.dataset.model || '');
      const settingKey = String(loadSettingControl.dataset.loadSetting || '');
      if (!modelName || !settingKey) return;
      deferAutoRefresh();
      setLoadSettingDraft(loadSettingDrafts, modelName, settingKey, loadSettingControl.value);
      render();
      return;
    }

    const control = event.target.closest('select[data-load-preset-kind][data-model]');
    if (!control || !container.contains(control)) return;
    const modelName = String(control.dataset.model || '');
    const presetKind = String(control.dataset.loadPresetKind || '');
    if (!modelName || !presetKind) return;
    const payload = parseLoadPresetValue(control.value);
    if (!payload) return;
    deferAutoRefresh();
    Object.entries(payload).forEach(([key, value]) => {
      setLoadSettingDraft(loadSettingDrafts, modelName, key, value);
    });
  });

  container.addEventListener('pointerdown', (event) => {
    const interactive = event.target.closest(
      'button[data-action][data-model], input[data-load-setting][data-model], select[data-load-setting][data-model], select[data-load-preset-kind][data-model]'
    );
    if (!interactive || !container.contains(interactive)) return;
    deferAutoRefresh();
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
      replicaCount: model?.vram_estimate_replica_count,
      source: model?.vram_estimate_source,
    });
  });

  return list.map((model) => ({
    name: String(model?.name || ''),
    runtime_state: normalizeRuntimeState(model?.runtime_state),
    replicas: toPositiveInt(model?.replicas) ?? 1,
    replica_max: toPositiveInt(model?.replica_max) ?? 1,
    loaded_replicas: toNonNegativeInt(model?.loaded_replicas),
    inflight_requests: toNonNegativeInt(model?.inflight_requests),
    configured_target_inflight: toPositiveInt(model?.configured_target_inflight),
    effective_target_inflight: toPositiveInt(model?.effective_target_inflight),
    resolved_backend: String(model?.resolved_backend || ''),
    configured_enabled: model?.configured_enabled,
    last_error: model?.last_error,
    vram_estimate_mib: toNonNegativeInt(
      vramByModelName.get(String(model?.name || ''))?.mib ?? model?.vram_estimate_mib
    ),
    vram_estimate_replica_count: toPositiveInt(
      vramByModelName.get(String(model?.name || ''))?.replicaCount ?? model?.vram_estimate_replica_count
    ) ?? null,
    vram_estimate_source: String(
      vramByModelName.get(String(model?.name || ''))?.source ?? model?.vram_estimate_source ?? ''
    ),
    load_constraints: asPlainObject(model?.load_constraints),
    load_recommendations: asPlainObject(model?.load_recommendations),
    load_override: asPlainObject(model?.load_override),
    definition: asPlainObject(model?.definition),
  }));
}

function formatPoolAddressLabel(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) return LLM_POOL_ADDRESS_LABEL;
  return `@${value.replace(/^https?:\/\//, '')}`;
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
    return models.filter((m) => m.runtime_state === 'loaded');
  }
  if (filterId === 'unloaded') {
    return models.filter((m) => m.runtime_state === 'unloaded');
  }
  if (filterId === 'transitioning') {
    return models.filter((m) => m.runtime_state === 'loading' || m.runtime_state === 'unloading');
  }
  if (filterId === 'problems') {
    return models.filter((m) => m.runtime_state === 'failed' || m.runtime_state === 'error');
  }
  return models;
}

function sortModelsByColumn(models, key, direction, loadSettingDrafts) {
  const factor = direction === 'desc' ? -1 : 1;
  return [...models].sort((left, right) => {
    const leftValue = getSortValue(left, key, loadSettingDrafts?.get(left?.name || ''));
    const rightValue = getSortValue(right, key, loadSettingDrafts?.get(right?.name || ''));
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

function getSortValue(model, key, draft) {
  const runtime = normalizeRuntimeState(model?.runtime_state);
  if (key === 'runtime') {
    return runtime;
  }
  if (key === 'action') {
    return actionForState(runtime)?.label || '';
  }
  if (key === 'inflight') {
    return toNonNegativeInt(model?.inflight_requests);
  }
  if (key === 'backend') {
    return String(model?.resolved_backend || model?.definition?.backend || '');
  }
  if (key === 'replicas') {
    return getDisplayReplicaCount(model, draft, runtime) ?? 0;
  }
  if (key === 'vram') {
    return getDisplayVramEstimateMib(model, draft, runtime);
  }
  return String(model?.name || '');
}

function isRemoteModel(model) {
  return normalizeBackend(model?.resolved_backend || model?.definition?.backend) === 'openai_remote';
}

function normalizeBackend(value) {
  return String(value || '').trim().toLowerCase();
}

function formatBackendLabel(value) {
  const normalized = normalizeBackend(value);
  return normalized || '-';
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
  if (state === 'failed' || state === 'error') return 'runtime-danger';
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
  if (state === 'failed' || state === 'error') return { kind: 'load', label: 'Retry' };
  return null;
}

function buildRowsMarkup(models, expandedModels, activeActionModel, activeActionKind, loadSettingDrafts) {
  if (!models.length) {
    return `
      <article class="llm-pool-row">
        <div class="llm-pool-cell model">
          <div class="llm-pool-model-name">No models in this view</div>
        </div>
        <div class="llm-pool-cell runtime runtime-muted">-</div>
        <div class="llm-pool-cell actions"></div>
        <div class="llm-pool-cell mono">-</div>
        <div class="llm-pool-cell meta">-</div>
        <div class="llm-pool-cell replicas">-</div>
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
    const inflight = toNonNegativeInt(model.inflight_requests);
    const backend = String(model.resolved_backend || model.definition?.backend || '-');
    const backendLabel = formatBackendLabel(backend);
    const isRemote = isRemoteModel(model);
    const draft = loadSettingDrafts.get(name);
    const displayReplicaCount = getDisplayReplicaCount(model, draft, runtime);
    const replicaText = displayReplicaCount == null ? '' : String(displayReplicaCount);
    const vramMib = getDisplayVramEstimateMib(model, draft, runtime);
    const vramText = isRemote ? 'remote' : (vramMib > 0 ? `${vramMib}MiB` : '-');
    const vramClass = isRemote ? 'vram-muted' : vramClassForRuntime(runtimeForUi);
    const runtimePill = shouldShowStatePill(runtimeForUi);
    const runtimePillTone = pillToneForRuntime(runtimeForUi);
    const vramPill = !isRemote && shouldShowStatePill(runtimeForUi);
    const vramPillTone = pillToneForRuntime(runtimeForUi);
    const runtimeValue = runtimeText(runtimeForUi);
    const runtimeHtml = runtimePill
      ? `<span class="llm-pool-pill ${escapeAttr(runtimePillTone)}">${escapeHtml(runtimeValue)}</span>`
      : escapeHtml(runtimeValue);
    const vramHtml = vramPill
      ? `<span class="llm-pool-pill ${escapeAttr(vramPillTone)}">${escapeHtml(vramText)}</span>`
      : escapeHtml(vramText);
    const detailsId = `llm-pool-details-${index}`;
    const isExpanded = expandedModels.has(name);
    const isBusyAction = activeActionModel === name && activeActionKind === action?.kind;
    const actionLabel = isBusyAction ? `${action?.label || ''}...` : action?.label || '';
    const rowClass = [
      'llm-pool-row',
      'is-expandable',
      runtime === 'loaded' ? 'is-loaded' : '',
      isRemote ? 'is-remote' : '',
    ].join(' ').trim();

    const loadSettingsHtml = buildLoadSettingsMarkup(
      model,
      draft,
      runtimeForUi
    );
    const definitionGridClass = loadSettingsHtml
      ? 'llm-pool-definition-grid llm-pool-definition-grid-with-divider'
      : 'llm-pool-definition-grid';

    return `
      <article
        class="${rowClass}"
        data-model="${escapeAttr(name)}"
        aria-expanded="${String(isExpanded)}"
      >
        <div class="llm-pool-cell model">
          <div class="llm-pool-model-title">
            <div class="llm-pool-model-name">${escapeHtml(name)}</div>
            ${isRemote ? '<span class="llm-pool-model-badge">Remote</span>' : ''}
          </div>
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
        <div class="llm-pool-cell mono">${escapeHtml(String(inflight))}</div>
        <div class="llm-pool-cell meta">${escapeHtml(backendLabel)}</div>
        <div class="llm-pool-cell replicas">${escapeHtml(replicaText)}</div>
        <div class="llm-pool-cell vram ${vramClass}">${vramHtml}</div>
      </article>
      <article
        class="llm-pool-row-details${isExpanded ? ' is-open' : ''}"
        id="${detailsId}"
        ${isExpanded ? '' : 'hidden'}
      >
        ${loadSettingsHtml}
        ${buildDefinitionGridMarkup(model, definitionGridClass)}
      </article>
    `;
  }).join('');
}

function buildDefinitionGridMarkup(model, definitionGridClass) {
  const definition = model?.definition || {};
  const backend = String(model?.resolved_backend || definition.backend || '-');
  const fields = isRemoteModel(model)
    ? [
      { label: 'Backend', value: formatBackendLabel(backend) },
      { label: 'Upstream model', value: definition.remote_model, code: true },
      { label: 'Base URL', value: definition.remote_base_url, code: true },
      { label: 'API key env', value: definition.remote_api_key_env, code: true },
      { label: 'Timeout', value: formatSecondsValue(definition.remote_timeout_s) },
      { label: 'Thinking', value: definition.remote_thinking || 'default' },
      { label: 'Target inflight', value: configuredTargetInflightForDisplay(model) },
      { label: 'Effective inflight', value: model.effective_target_inflight },
      { label: 'Health check', value: definition.remote_health_check },
      { label: 'Retries', value: definition.remote_max_retries },
      { label: 'Prompt format', value: definition.prompt_format },
      { label: 'Configured enabled', value: model.configured_enabled },
      { label: 'Last error', value: model.last_error || 'none' },
    ]
    : [
      ...buildLocalDefinitionFields(model, definition, backend),
      { label: 'Target inflight', value: configuredTargetInflightForDisplay(model) },
      { label: 'Effective inflight', value: model.effective_target_inflight },
    ];
  const visibleFields = fields.filter(shouldShowDefinitionField);

  return `
    <div class="${definitionGridClass}">
      ${visibleFields.map((field) => buildDefinitionItemMarkup(field)).join('')}
    </div>
  `;
}

function buildLocalDefinitionFields(model, definition, backend) {
  const normalizedBackend = normalizeBackend(backend);
  if (normalizedBackend === 'llama_server') {
    return [
      { label: 'Path', value: definition.model_path, code: true },
      { label: 'Backend', value: formatBackendLabel(backend) },
      { label: 'Binary', value: definition.llama_server_binary, code: true },
      {
        label: 'Library path',
        value: formatLibraryPath(definition.llama_server_library_path),
        code: true,
        optional: true,
        clamp: true,
      },
      { label: 'MMProj', value: definition.llama_server_mmproj_path, code: true, optional: true },
      { label: 'Draft model', value: definition.llama_server_draft_model_path, code: true, optional: true },
      { label: 'Total context tokens', value: definition.llama_server_n_ctx },
      { label: 'Image tokens', value: definition.llama_server_image_max_tokens, optional: true },
      { label: 'Spec type', value: definition.llama_server_spec_type, optional: true },
      { label: 'Draft tokens', value: definition.llama_server_spec_draft_n_max, optional: true },
      { label: 'Draft p min', value: definition.llama_server_spec_draft_p_min, optional: true },
      { label: 'GPU layers', value: definition.llama_server_n_gpu_layers },
      { label: 'Draft GPU layers', value: definition.llama_server_spec_draft_ngl, optional: true },
      { label: 'Flash attn', value: definition.llama_server_flash_attn },
      { label: 'Reasoning', value: definition.llama_server_reasoning, optional: true },
      { label: 'Host', value: definition.llama_server_host },
      { label: 'Port', value: definition.llama_server_port },
      { label: 'Alias', value: definition.llama_server_model_alias, optional: true },
      { label: 'Timeout', value: formatSecondsValue(definition.llama_server_timeout_s) },
      { label: 'Prompt format', value: definition.prompt_format },
      { label: 'Configured enabled', value: model.configured_enabled },
      { label: 'Last error', value: model.last_error, optional: true },
      { label: 'VRAM source', value: model.vram_estimate_source || 'unavailable' },
    ];
  }

  if (normalizedBackend === 'vllm' || normalizedBackend === 'vllm_serve') {
    const fields = [
      { label: 'Path', value: definition.model_path, code: true, optional: true },
      { label: 'Backend', value: formatBackendLabel(backend) },
      { label: 'vLLM model', value: definition.vllm_model, code: true },
    ];
    if (normalizedBackend === 'vllm_serve') {
      fields.push(
        { label: 'Binary', value: definition.vllm_serve_binary, code: true },
        {
          label: 'Library path',
          value: formatLibraryPath(definition.vllm_serve_library_path),
          code: true,
          optional: true,
          clamp: true,
        },
      );
    }
    if (shouldShowVllmSpeculativeControls(model)) {
      fields.push(
        { label: 'Spec method', value: definition.vllm_speculative_method, optional: true },
        { label: 'Spec model', value: definition.vllm_speculative_model, code: true, optional: true },
        { label: 'Spec MoE backend', value: definition.vllm_speculative_moe_backend, optional: true },
        { label: 'Spec attn backend', value: definition.vllm_speculative_attention_backend, optional: true },
        { label: 'Spec tokens', value: definition.vllm_num_speculative_tokens, optional: true },
      );
    }
    fields.push(
      { label: 'Prompt format', value: definition.prompt_format },
      { label: 'Configured enabled', value: model.configured_enabled },
      { label: 'Last error', value: model.last_error, optional: true },
      { label: 'VRAM source', value: model.vram_estimate_source || 'unavailable' },
    );
    return fields;
  }

  if (normalizedBackend === 'trtllm_serve') {
    return [
      { label: 'Path', value: definition.model_path, code: true, optional: true },
      { label: 'Backend', value: formatBackendLabel(backend) },
      { label: 'TensorRT-LLM model', value: definition.trtllm_model, code: true },
      { label: 'Max sequence length', value: definition.trtllm_max_seq_len },
      {
        label: 'KV cache',
        value: formatBytesAsMib(definition.trtllm_kv_cache_memory_bytes),
      },
      { label: 'Max batched tokens', value: definition.trtllm_max_num_tokens },
      { label: 'Chunked prefill', value: definition.trtllm_enable_chunked_prefill },
      { label: 'KV cache dtype', value: definition.trtllm_kv_cache_dtype },
      { label: 'Binary', value: definition.trtllm_serve_binary, code: true },
      { label: 'Prompt format', value: definition.prompt_format },
      { label: 'Configured enabled', value: model.configured_enabled },
      { label: 'Last error', value: model.last_error, optional: true },
      { label: 'VRAM source', value: model.vram_estimate_source || 'unavailable' },
    ];
  }

  if (normalizedBackend === 'sglang_serve') {
    return [
      { label: 'Path', value: definition.model_path, code: true, optional: true },
      { label: 'Backend', value: formatBackendLabel(backend) },
      { label: 'SGLang model', value: definition.sglang_model, code: true },
      { label: 'Context length', value: definition.sglang_context_length },
      { label: 'GPU memory fraction', value: definition.sglang_mem_fraction_static },
      { label: 'KV cache tokens', value: definition.sglang_max_total_tokens },
      { label: 'Prefill chunk tokens', value: definition.sglang_chunked_prefill_size },
      { label: 'KV cache dtype', value: definition.sglang_kv_cache_dtype },
      { label: 'Quantization', value: definition.sglang_quantization },
      { label: 'Attention backend', value: definition.sglang_attention_backend },
      { label: 'FP4 GEMM backend', value: definition.sglang_fp4_gemm_backend },
      { label: 'MTP algorithm', value: definition.sglang_speculative_algorithm, optional: true },
      { label: 'MTP assistant', value: definition.sglang_speculative_draft_model, code: true, optional: true },
      { label: 'MTP steps', value: definition.sglang_speculative_num_steps, optional: true },
      { label: 'MTP draft tokens', value: definition.sglang_speculative_num_draft_tokens, optional: true },
      { label: 'MTP top-k', value: definition.sglang_speculative_eagle_topk, optional: true },
      { label: 'Binary', value: definition.sglang_serve_binary, code: true },
      { label: 'Prompt format', value: definition.prompt_format },
      { label: 'Configured enabled', value: model.configured_enabled },
      { label: 'Last error', value: model.last_error, optional: true },
      { label: 'VRAM source', value: model.vram_estimate_source || 'unavailable' },
    ];
  }

  return [
    { label: 'Path', value: definition.model_path, code: true },
    { label: 'Backend', value: formatBackendLabel(backend) },
    { label: 'Device', value: definition.device },
    { label: 'Prompt format', value: definition.prompt_format },
    { label: 'Configured enabled', value: model.configured_enabled },
    { label: 'Last error', value: model.last_error, optional: true },
    { label: 'VRAM source', value: model.vram_estimate_source || 'unavailable' },
  ];
}

function shouldShowDefinitionField(field) {
  if (!field?.optional) return true;
  return !isEmptyDefinitionValue(field.value);
}

function isEmptyDefinitionValue(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function buildDefinitionItemMarkup({label, value, code = false, clamp = false, title}) {
  const normalizedValue = formatDefinitionValue(value);
  const tag = code ? 'code' : 'strong';
  const classAttr = clamp ? ' class="llm-pool-definition-value-clamped"' : '';
  const titleValue = title ?? (clamp ? normalizedValue : '');
  const titleAttr = titleValue ? ` title="${escapeAttr(titleValue)}"` : '';
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <${tag}${classAttr}${titleAttr}>${escapeHtml(normalizedValue)}</${tag}>
    </div>
  `;
}

function formatDefinitionValue(value) {
  if (value == null || value === '') return '-';
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

function formatLibraryPath(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(':');
  return value;
}

function configuredTargetInflightForDisplay(model) {
  return (
    toPositiveInt(model?.configured_target_inflight)
    ?? toPositiveInt(model?.definition?.target_inflight)
  );
}

function formatSecondsValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return `${numeric}s`;
}

function formatBytesAsMib(value) {
  const bytes = toPositiveInt(value);
  if (bytes == null) return '-';
  return `${Math.round(bytes / MIB)} MiB`;
}

function buildLoadSettingsMarkup(model, draft, runtimeState) {
  const wideControls = [];
  const compactControls = [];
  const notes = [];
  const canConfigure = canConfigureLoadSettings(runtimeState);
  const normalizedBackend = normalizeBackend(
    model?.resolved_backend || model?.definition?.backend
  );
  let hasGgufConfigControls = false;
  const replicaMax = toPositiveInt(model?.replica_max) ?? 1;
  let replicaControlMarkup = '';

  const targetInflightConstraint = getIntegerConstraint(model, 'target_inflight');
  if (targetInflightConstraint) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'target_inflight',
      label: 'Target inflight',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'target_inflight',
        targetInflightConstraint.minimum,
      ),
      minimum: targetInflightConstraint.minimum,
      maximum: targetInflightConstraint.maximum,
      step: targetInflightConstraint.step,
      disabled: !canConfigure,
    }));
    const nativeConcurrencySetting = {
      llama_server: 'llama-server --parallel',
      vllm_serve: 'vLLM --max-num-seqs',
      trtllm_serve: 'TensorRT-LLM max_batch_size',
      sglang_serve: 'SGLang --max-running-requests',
    }[normalizedBackend];
    if (nativeConcurrencySetting) {
      notes.push(buildLoadSettingNoteMarkup(
        `Target inflight sets both llm-pool admission and ${nativeConcurrencySetting} for this load.`
      ));
    }
  }

  if (replicaMax > 1) {
    const currentReplicaCount = canConfigure
      ? getDraftOrEffectiveReplicaCount(model, draft)
      : String(toPositiveInt(model?.replicas) ?? 1);
    replicaControlMarkup = buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'replicas',
      label: 'Replica count',
      options: buildReplicaCountOptions(replicaMax),
      value: currentReplicaCount,
      disabled: !canConfigure,
    });
  }

  const ggufConstraint = getIntegerConstraint(model, 'gguf_n_ctx');
  if (ggufConstraint) {
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'gguf_n_ctx',
      label: 'Context size',
      value: getDraftOrEffectiveIntegerValue(model, draft, 'gguf_n_ctx', ggufConstraint.minimum),
      minimum: ggufConstraint.minimum,
      step: ggufConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const ggufFlashAttnConstraint = getEnumConstraint(model, 'gguf_flash_attn');
  if (ggufFlashAttnConstraint) {
    hasGgufConfigControls = true;
    compactControls.push(buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'gguf_flash_attn',
      label: 'Flash attn',
      options: ggufFlashAttnConstraint.allowedValues,
      value: getDraftOrEffectiveEnumValue(
        model,
        draft,
        'gguf_flash_attn',
        ggufFlashAttnConstraint.defaultValue,
      ),
      disabled: !canConfigure,
    }));
  }

  const ggufRecommendations = getPairPresetRecommendations(model, 'gguf_cache_type_pairs');
  if (hasLoadConstraint(model, 'gguf_type_k') && hasLoadConstraint(model, 'gguf_type_v')) {
    hasGgufConfigControls = true;
    if (ggufRecommendations.length > 0) {
      compactControls.push(buildPresetSelectSettingMarkup({
        modelName: model.name,
        presetKind: 'gguf_cache_type_pairs',
        label: 'Cache preset',
        fields: ['gguf_type_k', 'gguf_type_v'],
        options: ggufRecommendations,
        currentPair: getCurrentGgufCachePair(model, draft),
        wide: false,
        disabled: !canConfigure,
      }));
    } else {
      compactControls.push(buildReadOnlySettingMarkup(
        'K type',
        getEffectiveGgufCacheTypeForDisplay(model, 'gguf_type_k')
      ));
      compactControls.push(buildReadOnlySettingMarkup(
        'V type',
        getEffectiveGgufCacheTypeForDisplay(model, 'gguf_type_v')
      ));
    }
  }

  if (hasGgufConfigControls) {
    notes.push(buildLoadSettingNoteMarkup(
      'Not every GGUF model supports every flash-attention and KV-cache combination.'
    ));
  }

  const exllamaCacheConstraint = getIntegerConstraint(model, 'exllama_cache_size');
  if (exllamaCacheConstraint) {
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'exllama_cache_size',
      label: 'Cache size',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'exllama_cache_size',
        exllamaCacheConstraint.minimum
      ),
      minimum: exllamaCacheConstraint.minimum,
      step: exllamaCacheConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const exllamaRecommendations = getPairPresetRecommendations(model, 'exllama_cache_bit_pairs');
  if (hasLoadConstraint(model, 'exllama_cache_quant')) {
    if (exllamaRecommendations.length > 0) {
      compactControls.push(buildPresetSelectSettingMarkup({
        modelName: model.name,
        presetKind: 'exllama_cache_bit_pairs',
        label: 'Cache type',
        fields: ['exllama_cache_quant'],
        options: exllamaRecommendations.map((option) => ({
          label: formatExllamaCacheTypeLabel(option.payload),
          payload: {exllama_cache_quant: toExllamaCacheQuant(option.payload)},
        })),
        currentPair: getCurrentExllamaCacheQuantPayload(model, draft),
        disabled: !canConfigure,
      }));
    } else {
      compactControls.push(buildReadOnlySettingMarkup(
        'Cache type',
        formatExllamaCacheTypeValue(getDraftOrEffectiveValue(
          draft,
          model,
          'exllama_cache_quant',
          (value) => normalizeExllamaCacheQuantValue(value),
        ))
      ));
    }
  }

  const vllmMaxLenConstraint = getIntegerConstraint(model, 'vllm_max_model_len');
  if (vllmMaxLenConstraint) {
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'vllm_max_model_len',
      label: 'Max model len',
      value: getDraftOrEffectiveIntegerValue(model, draft, 'vllm_max_model_len', vllmMaxLenConstraint.minimum),
      minimum: vllmMaxLenConstraint.minimum,
      step: vllmMaxLenConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const vllmKvBytesConstraint = getIntegerConstraint(model, 'vllm_kv_cache_memory_bytes');
  if (vllmKvBytesConstraint) {
    const minimumMib = bytesToKvCacheMibStep(vllmKvBytesConstraint.minimum);
    const kvCacheMib = getDraftOrEffectiveKvCacheMib(model, draft, minimumMib);
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'vllm_kv_cache_mib',
      label: 'KV cache (MiB)',
      value: kvCacheMib,
      valueLabel: formatSliderSettingValue('vllm_kv_cache_mib', kvCacheMib),
      minimum: minimumMib,
      step: VLLM_KV_CACHE_STEP_MIB,
      maximum: VLLM_KV_CACHE_MAX_MIB,
      disabled: !canConfigure,
    }));
  }

  const vllmMaxPixelsConstraint = getIntegerConstraint(model, 'vllm_max_pixels');
  if (vllmMaxPixelsConstraint && shouldShowVllmMaxPixelsControl(model)) {
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'vllm_max_pixels',
      label: 'Max pixels (image)',
      value: getDraftOrEffectiveMaxPixels(model, draft, vllmMaxPixelsConstraint.minimum),
      minimum: vllmMaxPixelsConstraint.minimum,
      step: vllmMaxPixelsConstraint.step,
      maximum: 12845056,
      disabled: !canConfigure,
    }));
  }

  const vllmKvDtypeConstraint = getEnumConstraint(model, 'vllm_kv_cache_dtype');
  if (vllmKvDtypeConstraint) {
    compactControls.push(buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'vllm_kv_cache_dtype',
      label: 'KV cache dtype',
      options: vllmKvDtypeConstraint.allowedValues,
      value: getDraftOrEffectiveEnumValue(model, draft, 'vllm_kv_cache_dtype', vllmKvDtypeConstraint.defaultValue),
      disabled: !canConfigure,
    }));
    notes.push(buildLoadSettingNoteMarkup(
      'fp8 KV-cache dtype needs CUDA toolkit 12.9+ on Blackwell GPUs; otherwise the model load fails. Leave it on auto if unsure.'
    ));
  }

  const vllmSpeculativeMethodConstraint = getStringConstraint(model, 'vllm_speculative_method');
  if (vllmSpeculativeMethodConstraint && shouldShowVllmSpeculativeMethodControl(model)) {
    compactControls.push(buildTextSettingMarkup({
      modelName: model.name,
      key: 'vllm_speculative_method',
      label: 'Spec method',
      value: getDraftOrEffectiveStringValue(
        model,
        draft,
        'vllm_speculative_method',
        vllmSpeculativeMethodConstraint.defaultValue,
      ),
      placeholder: vllmSpeculativeMethodConstraint.examples[0] || '',
      disabled: !canConfigure,
    }));
  }

  const vllmSpeculativeModelConstraint = getStringConstraint(model, 'vllm_speculative_model');
  if (vllmSpeculativeModelConstraint && shouldShowVllmSpeculativeModelControl(model)) {
    wideControls.push(buildTextSettingMarkup({
      modelName: model.name,
      key: 'vllm_speculative_model',
      label: 'Spec model',
      value: getDraftOrEffectiveStringValue(
        model,
        draft,
        'vllm_speculative_model',
        vllmSpeculativeModelConstraint.defaultValue,
      ),
      placeholder: vllmSpeculativeModelConstraint.examples[0] || '',
      disabled: !canConfigure,
      wide: true,
    }));
  }

  const vllmSpeculativeMoeBackendConstraint = getStringConstraint(model, 'vllm_speculative_moe_backend');
  if (vllmSpeculativeMoeBackendConstraint && shouldShowVllmSpeculativeMoeBackendControl(model)) {
    compactControls.push(buildTextSettingMarkup({
      modelName: model.name,
      key: 'vllm_speculative_moe_backend',
      label: 'Spec MoE backend',
      value: getDraftOrEffectiveStringValue(
        model,
        draft,
        'vllm_speculative_moe_backend',
        vllmSpeculativeMoeBackendConstraint.defaultValue,
      ),
      placeholder: vllmSpeculativeMoeBackendConstraint.examples[0] || '',
      disabled: !canConfigure,
    }));
  }

  const vllmSpeculativeAttentionBackendConstraint = getStringConstraint(model, 'vllm_speculative_attention_backend');
  if (vllmSpeculativeAttentionBackendConstraint && shouldShowVllmSpeculativeAttentionBackendControl(model)) {
    compactControls.push(buildTextSettingMarkup({
      modelName: model.name,
      key: 'vllm_speculative_attention_backend',
      label: 'Spec attn backend',
      value: getDraftOrEffectiveStringValue(
        model,
        draft,
        'vllm_speculative_attention_backend',
        vllmSpeculativeAttentionBackendConstraint.defaultValue,
      ),
      placeholder: vllmSpeculativeAttentionBackendConstraint.examples[0] || '',
      disabled: !canConfigure,
    }));
  }

  const vllmNumSpeculativeTokensConstraint = getIntegerConstraint(model, 'vllm_num_speculative_tokens');
  if (vllmNumSpeculativeTokensConstraint && shouldShowVllmSpeculativeTokenControl(model)) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'vllm_num_speculative_tokens',
      label: 'Spec tokens',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'vllm_num_speculative_tokens',
        vllmNumSpeculativeTokensConstraint.minimum,
      ),
      minimum: vllmNumSpeculativeTokensConstraint.minimum,
      maximum: vllmNumSpeculativeTokensConstraint.maximum,
      step: vllmNumSpeculativeTokensConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const trtllmMaxSeqLenConstraint = getIntegerConstraint(model, 'trtllm_max_seq_len');
  if (trtllmMaxSeqLenConstraint) {
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'trtllm_max_seq_len',
      label: 'Max sequence length',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'trtllm_max_seq_len',
        trtllmMaxSeqLenConstraint.minimum,
      ),
      minimum: trtllmMaxSeqLenConstraint.minimum,
      step: trtllmMaxSeqLenConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const trtllmKvBytesConstraint = getIntegerConstraint(model, 'trtllm_kv_cache_memory_bytes');
  if (trtllmKvBytesConstraint) {
    const minimumMib = bytesToKvCacheMibStep(trtllmKvBytesConstraint.minimum);
    const kvCacheMib = getDraftOrEffectiveTrtllmKvCacheMib(model, draft, minimumMib);
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'trtllm_kv_cache_mib',
      label: 'KV cache (MiB)',
      value: kvCacheMib,
      valueLabel: formatSliderSettingValue('trtllm_kv_cache_mib', kvCacheMib),
      minimum: minimumMib,
      step: TRTLLM_KV_CACHE_STEP_MIB,
      maximum: TRTLLM_KV_CACHE_MAX_MIB,
      disabled: !canConfigure,
    }));
  }

  const trtllmMaxTokensConstraint = getIntegerConstraint(model, 'trtllm_max_num_tokens');
  if (trtllmMaxTokensConstraint) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'trtllm_max_num_tokens',
      label: 'TRT token budget',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'trtllm_max_num_tokens',
        trtllmMaxTokensConstraint.minimum,
      ),
      minimum: trtllmMaxTokensConstraint.minimum,
      step: trtllmMaxTokensConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const trtllmChunkedPrefillConstraint = getBooleanConstraint(
    model,
    'trtllm_enable_chunked_prefill',
  );
  if (trtllmChunkedPrefillConstraint) {
    compactControls.push(buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'trtllm_enable_chunked_prefill',
      label: 'Chunked prefill',
      options: ['false', 'true'],
      value: String(getDraftOrEffectiveBooleanValue(
        model,
        draft,
        'trtllm_enable_chunked_prefill',
        trtllmChunkedPrefillConstraint.defaultValue,
      )),
      disabled: !canConfigure,
    }));
  }

  const trtllmKvDtypeConstraint = getEnumConstraint(model, 'trtllm_kv_cache_dtype');
  if (trtllmKvDtypeConstraint) {
    compactControls.push(buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'trtllm_kv_cache_dtype',
      label: 'KV cache dtype',
      options: trtllmKvDtypeConstraint.allowedValues,
      value: getDraftOrEffectiveEnumValue(
        model,
        draft,
        'trtllm_kv_cache_dtype',
        trtllmKvDtypeConstraint.defaultValue,
      ),
      disabled: !canConfigure,
    }));
  }

  if (
    trtllmMaxSeqLenConstraint
    || trtllmKvBytesConstraint
    || trtllmMaxTokensConstraint
  ) {
    notes.push(buildLoadSettingNoteMarkup(
      'TensorRT-LLM applies these settings when its server starts; unload before changing them.'
    ));
  }

  const sglangContextConstraint = getIntegerConstraint(model, 'sglang_context_length');
  if (sglangContextConstraint) {
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'sglang_context_length',
      label: 'Context length',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'sglang_context_length',
        sglangContextConstraint.minimum,
      ),
      minimum: sglangContextConstraint.minimum,
      step: sglangContextConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const sglangMaxTotalTokensConstraint = getIntegerConstraint(model, 'sglang_max_total_tokens');
  if (sglangMaxTotalTokensConstraint) {
    wideControls.push(buildSliderSettingMarkup({
      modelName: model.name,
      key: 'sglang_max_total_tokens',
      label: 'KV cache tokens',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'sglang_max_total_tokens',
        sglangMaxTotalTokensConstraint.minimum,
      ),
      minimum: sglangMaxTotalTokensConstraint.minimum,
      step: sglangMaxTotalTokensConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const sglangMemFractionConstraint = getFloatConstraint(model, 'sglang_mem_fraction_static');
  if (sglangMemFractionConstraint) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'sglang_mem_fraction_static',
      label: 'GPU memory fraction',
      value: getDraftOrEffectiveNumberValue(
        model,
        draft,
        'sglang_mem_fraction_static',
        sglangMemFractionConstraint.defaultValue,
      ),
      minimum: sglangMemFractionConstraint.minimum,
      maximum: sglangMemFractionConstraint.maximum,
      step: 0.01,
      disabled: !canConfigure,
    }));
  }

  const sglangChunkedPrefillConstraint = getSignedIntegerConstraint(
    model,
    'sglang_chunked_prefill_size',
  );
  if (sglangChunkedPrefillConstraint) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'sglang_chunked_prefill_size',
      label: 'Prefill chunk tokens',
      value: getDraftOrEffectiveSignedIntegerValue(
        model,
        draft,
        'sglang_chunked_prefill_size',
        sglangChunkedPrefillConstraint.minimum,
      ),
      minimum: sglangChunkedPrefillConstraint.minimum,
      maximum: sglangChunkedPrefillConstraint.maximum,
      step: sglangChunkedPrefillConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const sglangKvDtypeConstraint = getEnumConstraint(model, 'sglang_kv_cache_dtype');
  if (sglangKvDtypeConstraint) {
    const currentKvCacheDtype = getDraftOrEffectiveEnumValue(
      model,
      draft,
      'sglang_kv_cache_dtype',
      sglangKvDtypeConstraint.defaultValue,
    );
    const kvCacheDtypeOptions = sglangKvDtypeConstraint.allowedValues.filter(
      (value) => SGLANG_WORKBENCH_KV_CACHE_DTYPES.has(value) || value === currentKvCacheDtype
    );
    compactControls.push(buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'sglang_kv_cache_dtype',
      label: 'KV cache dtype',
      options: kvCacheDtypeOptions,
      value: currentKvCacheDtype,
      disabled: !canConfigure,
    }));
  }

  const sglangSpecAlgorithmConstraint = getStringConstraint(
    model,
    'sglang_speculative_algorithm',
  );
  if (sglangSpecAlgorithmConstraint) {
    const currentSpecAlgorithm = getDraftOrEffectiveStringValue(
      model,
      draft,
      'sglang_speculative_algorithm',
      sglangSpecAlgorithmConstraint.defaultValue,
    );
    const configuredSpecAlgorithm = (
      normalizeNullableStringValue(model?.definition?.sglang_speculative_algorithm)
      ?? normalizeNullableStringValue(sglangSpecAlgorithmConstraint.examples[0])
    );
    const specAlgorithmOptions = configuredSpecAlgorithm
      ? ['', configuredSpecAlgorithm]
      : [''];
    const specAlgorithmOptionLabels = {'': 'Off'};
    if (configuredSpecAlgorithm) {
      specAlgorithmOptionLabels[configuredSpecAlgorithm] = `On (${configuredSpecAlgorithm})`;
    }
    compactControls.push(buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'sglang_speculative_algorithm',
      label: 'MTP',
      options: specAlgorithmOptions,
      optionLabels: specAlgorithmOptionLabels,
      value: currentSpecAlgorithm,
      disabled: !canConfigure,
    }));
  }

  const sglangSpeculativeTopk = toPositiveInt(
    getEffectiveLoadValue(model, 'sglang_speculative_eagle_topk')
  );
  const sglangSpecIntegerFields = [
    ['sglang_speculative_num_steps', 'MTP steps'],
  ];
  if (sglangSpeculativeTopk !== 1) {
    sglangSpecIntegerFields.push([
      'sglang_speculative_num_draft_tokens',
      'MTP draft tokens',
    ]);
  }
  sglangSpecIntegerFields.forEach(([key, label]) => {
    const constraint = getIntegerConstraint(model, key);
    if (!constraint) return;
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key,
      label,
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        key,
        constraint.minimum,
      ),
      minimum: constraint.minimum,
      maximum: constraint.maximum,
      step: constraint.step,
      disabled: !canConfigure,
    }));
  });

  if (
    sglangContextConstraint
    || sglangMaxTotalTokensConstraint
    || sglangMemFractionConstraint
    || sglangSpecAlgorithmConstraint
  ) {
    notes.push(buildLoadSettingNoteMarkup(
      'SGLang applies these settings at server startup.'
    ));
    notes.push(buildLoadSettingNoteMarkup(
      'Weights and KV cache must fit the GPU memory pool. Unload another large backend before loading SGLang; raising the fraction does not create free VRAM.'
    ));
    notes.push(buildLoadSettingNoteMarkup(
      'MTP uses the configured assistant model. NEXTN is promoted to Gemma 4 FROZEN_KV_MTP; the assistant and top-k remain fixed in the model definition.'
    ));
    if (sglangSpeculativeTopk === 1) {
      notes.push(buildLoadSettingNoteMarkup(
        'With top-k 1, SGLang derives MTP draft tokens as MTP steps + 1.'
      ));
    }
  }

  const llamaServerNctxConstraint = getIntegerConstraint(model, 'llama_server_n_ctx');
  if (llamaServerNctxConstraint) {
    wideControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'llama_server_n_ctx',
      label: 'Total context tokens',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'llama_server_n_ctx',
        llamaServerNctxConstraint.minimum
      ),
      minimum: llamaServerNctxConstraint.minimum,
      step: llamaServerNctxConstraint.step,
      disabled: !canConfigure,
      wide: true,
    }));
  }

  const llamaServerImageTokensConstraint = getIntegerConstraint(model, 'llama_server_image_max_tokens');
  if (llamaServerImageTokensConstraint) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'llama_server_image_max_tokens',
      label: 'Image tokens',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'llama_server_image_max_tokens',
        llamaServerImageTokensConstraint.minimum
      ),
      minimum: llamaServerImageTokensConstraint.minimum,
      step: llamaServerImageTokensConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const llamaServerSpecTypeConstraint = getEnumConstraint(model, 'llama_server_spec_type');
  if (llamaServerSpecTypeConstraint) {
    compactControls.push(buildEnumSelectSettingMarkup({
      modelName: model.name,
      key: 'llama_server_spec_type',
      label: 'MTP type',
      options: llamaServerSpecTypeConstraint.allowedValues,
      value: getDraftOrEffectiveEnumValue(
        model,
        draft,
        'llama_server_spec_type',
        llamaServerSpecTypeConstraint.defaultValue,
      ),
      disabled: !canConfigure,
    }));
  }

  const llamaServerDraftMaxConstraint = getIntegerConstraint(model, 'llama_server_spec_draft_n_max');
  if (llamaServerDraftMaxConstraint) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'llama_server_spec_draft_n_max',
      label: 'Draft tokens',
      value: getDraftOrEffectiveIntegerValue(
        model,
        draft,
        'llama_server_spec_draft_n_max',
        llamaServerDraftMaxConstraint.minimum
      ),
      minimum: llamaServerDraftMaxConstraint.minimum,
      maximum: llamaServerDraftMaxConstraint.maximum,
      step: llamaServerDraftMaxConstraint.step,
      disabled: !canConfigure,
    }));
  }

  const llamaServerDraftPMinConstraint = getFloatConstraint(model, 'llama_server_spec_draft_p_min');
  if (llamaServerDraftPMinConstraint) {
    compactControls.push(buildNumberSettingMarkup({
      modelName: model.name,
      key: 'llama_server_spec_draft_p_min',
      label: 'Draft p min',
      value: getDraftOrEffectiveNumberValue(
        model,
        draft,
        'llama_server_spec_draft_p_min',
        llamaServerDraftPMinConstraint.defaultValue
      ),
      minimum: llamaServerDraftPMinConstraint.minimum,
      maximum: llamaServerDraftPMinConstraint.maximum,
      step: LLAMA_SERVER_SPEC_DRAFT_P_MIN_STEP,
      disabled: !canConfigure,
    }));
  }

  if (
    llamaServerSpecTypeConstraint
    || llamaServerDraftMaxConstraint
    || llamaServerDraftPMinConstraint
  ) {
    notes.push(buildLoadSettingNoteMarkup(
      'llama_server MTP settings are native server startup flags; unload before changing them.'
    ));
  }
  if (llamaServerNctxConstraint && targetInflightConstraint) {
    notes.push(buildLoadSettingNoteMarkup(
      'llama-server shares total context tokens across its parallel slots. Approximate context per request is total context tokens divided by target inflight.'
    ));
  }

  if (replicaControlMarkup) {
    compactControls.push(replicaControlMarkup);
  }

  if (!wideControls.length && !compactControls.length && !notes.length) return '';
  const compactColumnCount = Math.min(Math.max(compactControls.length, 1), 3);

  return `
    <div class="llm-pool-load-settings">
      ${wideControls.join('')}
      ${compactControls.length ? `
        <div class="llm-pool-load-settings-compact llm-pool-load-settings-compact-${compactColumnCount}">
          ${compactControls.join('')}
        </div>
      ` : ''}
      ${notes.join('')}
    </div>
  `;
}

function buildSliderSettingMarkup({modelName, key, label, value, valueLabel, minimum, step, disabled, maximum}) {
  const sliderMax = toPositiveInt(maximum) ?? LOAD_SETTING_SLIDER_MAX;
  const displayValue = valueLabel ?? String(value);
  return `
    <div class="llm-pool-load-setting llm-pool-load-setting-wide">
      <span>${escapeHtml(label)}</span>
      <div class="llm-pool-load-slider-row">
        <input
          type="range"
          min="${escapeAttr(String(minimum))}"
          max="${escapeAttr(String(sliderMax))}"
          step="${escapeAttr(String(step))}"
          value="${escapeAttr(String(value))}"
          data-load-setting="${escapeAttr(key)}"
          data-model="${escapeAttr(modelName)}"
          ${disabled ? 'disabled' : ''}
        />
        <output class="llm-pool-load-slider-value" data-load-setting-value>${escapeHtml(displayValue)}</output>
      </div>
    </div>
  `;
}

function buildEnumSelectSettingMarkup({
  modelName,
  key,
  label,
  options,
  optionLabels = {},
  value,
  disabled,
  wide = false,
}) {
  return `
    <div class="llm-pool-load-setting${wide ? ' llm-pool-load-setting-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <select
        class="llm-pool-load-select"
        data-load-setting="${escapeAttr(key)}"
        data-model="${escapeAttr(modelName)}"
        ${disabled ? 'disabled' : ''}
      >
        ${options.map((option) => {
          const selected = option === value ? ' selected' : '';
          const optionLabel = Object.prototype.hasOwnProperty.call(optionLabels, option)
            ? optionLabels[option]
            : option;
          return `<option value="${escapeAttr(option)}"${selected}>${escapeHtml(optionLabel)}</option>`;
        }).join('')}
      </select>
    </div>
  `;
}

function buildNumberSettingMarkup({
  modelName,
  key,
  label,
  value,
  minimum,
  maximum,
  step,
  disabled,
  wide = false,
}) {
  const maxAttr = maximum == null ? '' : ` max="${escapeAttr(String(maximum))}"`;
  return `
    <div class="llm-pool-load-setting${wide ? ' llm-pool-load-setting-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <input
        class="llm-pool-load-input"
        type="number"
        min="${escapeAttr(String(minimum))}"
        ${maxAttr}
        step="${escapeAttr(String(step))}"
        value="${escapeAttr(String(value))}"
        data-load-setting="${escapeAttr(key)}"
        data-model="${escapeAttr(modelName)}"
        ${disabled ? 'disabled' : ''}
      />
    </div>
  `;
}

function buildTextSettingMarkup({
  modelName,
  key,
  label,
  value,
  placeholder,
  disabled,
  wide = false,
}) {
  const placeholderAttr = placeholder == null || placeholder === ''
    ? ''
    : ` placeholder="${escapeAttr(String(placeholder))}"`;
  return `
    <div class="llm-pool-load-setting${wide ? ' llm-pool-load-setting-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <input
        class="llm-pool-load-input"
        type="text"
        value="${escapeAttr(String(value ?? ''))}"
        ${placeholderAttr}
        data-load-setting="${escapeAttr(key)}"
        data-model="${escapeAttr(modelName)}"
        autocomplete="off"
        spellcheck="false"
        ${disabled ? 'disabled' : ''}
      />
    </div>
  `;
}

function buildPresetSelectSettingMarkup({modelName, presetKind, label, fields, options, currentPair, disabled, wide = true}) {
  const optionList = [...options];
  const selectedValue = serializeLoadPresetValue(currentPair);
  const hasSelectedOption = optionList.some((option) => serializeLoadPresetValue(option.payload) === selectedValue);
  if (!hasSelectedOption) {
    optionList.unshift({
      label: `Current (${formatPairPresetLabel(currentPair, fields)})`,
      payload: currentPair,
    });
  }

  return `
    <div class="llm-pool-load-setting${wide ? ' llm-pool-load-setting-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <select
        class="llm-pool-load-select"
        data-load-preset-kind="${escapeAttr(presetKind)}"
        data-model="${escapeAttr(modelName)}"
        ${disabled ? 'disabled' : ''}
      >
        ${optionList.map((option) => {
          const value = serializeLoadPresetValue(option.payload);
          const selected = value === selectedValue ? ' selected' : '';
          return `<option value="${escapeAttr(value)}"${selected}>${escapeHtml(option.label)}</option>`;
        }).join('')}
      </select>
    </div>
  `;
}

function buildLoadSettingNoteMarkup(text) {
  return `
    <div class="llm-pool-load-note">${escapeHtml(text)}</div>
  `;
}

function buildReadOnlySettingMarkup(label, value) {
  return `
    <div class="llm-pool-load-setting">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function hasLoadConstraint(model, key) {
  return Object.prototype.hasOwnProperty.call(model?.load_constraints || {}, key);
}

function getIntegerConstraint(model, key) {
  const raw = model?.load_constraints?.[key];
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'integer') return null;
  const minimum = toPositiveInt(raw.minimum);
  const step = toPositiveInt(raw.step);
  if (minimum == null || step == null) return null;
  const maximum = toPositiveInt(raw.maximum);
  return { minimum, step, maximum };
}

function getSignedIntegerConstraint(model, key) {
  const raw = model?.load_constraints?.[key];
  if (!raw || typeof raw !== 'object' || raw.kind !== 'integer') return null;
  const minimum = toFiniteNumber(raw.minimum);
  const step = toPositiveInt(raw.step);
  if (minimum == null || step == null) return null;
  const maximum = toFiniteNumber(raw.maximum);
  return {
    minimum: Math.trunc(minimum),
    step,
    maximum: maximum == null ? null : Math.trunc(maximum),
  };
}

function getFloatConstraint(model, key) {
  const raw = model?.load_constraints?.[key];
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'float') return null;
  const minimum = toFiniteNumber(raw.minimum);
  const maximum = toFiniteNumber(raw.maximum);
  const defaultValue = toFiniteNumber(raw.default) ?? minimum ?? 0;
  if (minimum == null || maximum == null) return null;
  return { minimum, maximum, defaultValue };
}

function getEnumConstraint(model, key) {
  const raw = model?.load_constraints?.[key];
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'enum') return null;
  const allowedValues = Array.isArray(raw.allowed_values)
    ? raw.allowed_values.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (!allowedValues.length) return null;
  const defaultValue = String(raw.default || '').trim() || allowedValues[0];
  return { allowedValues, defaultValue };
}

function getBooleanConstraint(model, key) {
  const raw = model?.load_constraints?.[key];
  if (!raw || typeof raw !== 'object' || raw.kind !== 'boolean') return null;
  return { defaultValue: raw.default === true };
}

function getStringConstraint(model, key) {
  const raw = model?.load_constraints?.[key];
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind !== 'string_or_null') return null;
  const examples = Array.isArray(raw.examples)
    ? raw.examples.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return {
    defaultValue: normalizeNullableStringValue(raw.default) ?? '',
    examples,
  };
}

function getDraftOrEffectiveIntegerValue(model, draft, key, fallbackMinimum) {
  const draftValue = toPositiveInt(draft?.[key]);
  if (draftValue != null) return draftValue;
  const effectiveValue = toPositiveInt(getEffectiveLoadValue(model, key));
  if (effectiveValue != null) return effectiveValue;
  return fallbackMinimum;
}

function getDraftOrEffectiveSignedIntegerValue(model, draft, key, fallbackMinimum) {
  const draftValue = toFiniteNumber(draft?.[key]);
  if (draftValue != null) return Math.trunc(draftValue);
  const effectiveValue = toFiniteNumber(getEffectiveLoadValue(model, key));
  if (effectiveValue != null) return Math.trunc(effectiveValue);
  return fallbackMinimum;
}

function getDraftOrEffectiveEnumValue(model, draft, key, fallbackDefault) {
  const draftValue = draft?.[key];
  if (draftValue != null && String(draftValue).trim() !== '') {
    return String(draftValue).trim();
  }
  const effectiveValue = getEffectiveLoadValue(model, key);
  if (effectiveValue != null && String(effectiveValue).trim() !== '') {
    return String(effectiveValue).trim();
  }
  return fallbackDefault;
}

function getDraftOrEffectiveBooleanValue(model, draft, key, fallbackDefault) {
  const draftValue = normalizeBooleanValue(draft?.[key]);
  if (draftValue != null) return draftValue;
  const effectiveValue = normalizeBooleanValue(getEffectiveLoadValue(model, key));
  if (effectiveValue != null) return effectiveValue;
  return fallbackDefault;
}

function getDraftOrEffectiveNumberValue(model, draft, key, fallbackDefault) {
  const draftValue = toFiniteNumber(draft?.[key]);
  if (draftValue != null) return draftValue;
  const effectiveValue = toFiniteNumber(getEffectiveLoadValue(model, key));
  if (effectiveValue != null) return effectiveValue;
  return fallbackDefault;
}

function getDraftOrEffectiveStringValue(model, draft, key, fallbackDefault) {
  if (draft && Object.prototype.hasOwnProperty.call(draft, key)) {
    return normalizeNullableStringValue(draft[key]) ?? '';
  }
  const effectiveValue = normalizeNullableStringValue(getEffectiveLoadValue(model, key));
  if (effectiveValue != null) return effectiveValue;
  return fallbackDefault;
}

function getEffectiveLoadValue(model, key) {
  if (Object.prototype.hasOwnProperty.call(model?.load_override || {}, key)) {
    return model.load_override[key];
  }
  return model?.definition?.[key];
}

function hasEffectiveStringLoadValue(model, key) {
  return normalizeNullableStringValue(getEffectiveLoadValue(model, key)) != null;
}

function shouldShowVllmMaxPixelsControl(model) {
  return getMmProcessorMaxPixels(model) != null;
}

function shouldShowVllmSpeculativeControls(model) {
  return (
    shouldShowVllmSpeculativeMethodControl(model)
    || shouldShowVllmSpeculativeModelControl(model)
    || shouldShowVllmSpeculativeMoeBackendControl(model)
    || shouldShowVllmSpeculativeAttentionBackendControl(model)
  );
}

function shouldShowVllmSpeculativeMethodControl(model) {
  return hasEffectiveStringLoadValue(model, 'vllm_speculative_method');
}

function shouldShowVllmSpeculativeModelControl(model) {
  const method = normalizeNullableStringValue(getEffectiveLoadValue(model, 'vllm_speculative_method'));
  return (
    hasEffectiveStringLoadValue(model, 'vllm_speculative_model')
    || (method != null && method !== 'mtp')
  );
}

function shouldShowVllmSpeculativeMoeBackendControl(model) {
  return hasEffectiveStringLoadValue(model, 'vllm_speculative_moe_backend');
}

function shouldShowVllmSpeculativeAttentionBackendControl(model) {
  return hasEffectiveStringLoadValue(model, 'vllm_speculative_attention_backend');
}

function shouldShowVllmSpeculativeTokenControl(model) {
  return shouldShowVllmSpeculativeControls(model);
}

const MIB = 1024 * 1024;

function bytesToKvCacheMibStep(bytes) {
  const value = toPositiveInt(bytes);
  if (value == null) return VLLM_KV_CACHE_STEP_MIB;
  const mib = Math.round(value / MIB / VLLM_KV_CACHE_STEP_MIB) * VLLM_KV_CACHE_STEP_MIB;
  return Math.max(VLLM_KV_CACHE_STEP_MIB, mib);
}

function getDraftOrEffectiveKvCacheMib(model, draft, fallbackMib) {
  const draftValue = toPositiveInt(draft?.vllm_kv_cache_mib);
  if (draftValue != null) return draftValue;
  const effectiveBytes = toPositiveInt(getEffectiveLoadValue(model, 'vllm_kv_cache_memory_bytes'));
  if (effectiveBytes != null) return bytesToKvCacheMibStep(effectiveBytes);
  return fallbackMib;
}

function getDraftOrEffectiveTrtllmKvCacheMib(model, draft, fallbackMib) {
  const draftValue = toPositiveInt(draft?.trtllm_kv_cache_mib);
  if (draftValue != null) return draftValue;
  const effectiveBytes = toPositiveInt(getEffectiveLoadValue(model, 'trtllm_kv_cache_memory_bytes'));
  if (effectiveBytes != null) return bytesToKvCacheMibStep(effectiveBytes);
  return fallbackMib;
}

function formatSliderSettingValue(key, value) {
  if (key === 'vllm_kv_cache_mib' || key === 'trtllm_kv_cache_mib') {
    return `${value} MiB`;
  }
  return String(value);
}

function getMmProcessorMaxPixels(model) {
  // load_override carries vllm_max_pixels directly; definition carries the
  // merged vllm_mm_processor_kwargs as a list of [key, value] pairs.
  const override = model?.load_override;
  if (override && Object.prototype.hasOwnProperty.call(override, 'vllm_max_pixels')) {
    return toPositiveInt(override.vllm_max_pixels);
  }
  return getConfiguredMmProcessorMaxPixels(model);
}

function getConfiguredMmProcessorMaxPixels(model) {
  const mmKwargs = model?.definition?.vllm_mm_processor_kwargs;
  if (Array.isArray(mmKwargs)) {
    const entry = mmKwargs.find((pair) => Array.isArray(pair) && pair[0] === 'max_pixels');
    if (entry) return toPositiveInt(entry[1]);
  }
  return null;
}

function getDraftOrEffectiveMaxPixels(model, draft, fallbackMinimum) {
  const draftValue = toPositiveInt(draft?.vllm_max_pixels);
  if (draftValue != null) return draftValue;
  const effective = getMmProcessorMaxPixels(model);
  if (effective != null) return effective;
  return fallbackMinimum;
}

function getPairPresetRecommendations(model, key) {
  const recommendation = model?.load_recommendations?.[key];
  if (!recommendation || typeof recommendation !== 'object') return [];
  if (recommendation.kind !== 'pair_presets') return [];
  const fields = Array.isArray(recommendation.fields) ? recommendation.fields.map((field) => String(field || '')) : [];
  const recommendedPairs = Array.isArray(recommendation.recommended_pairs) ? recommendation.recommended_pairs : [];
  return recommendedPairs
    .map((pair) => {
      const payload = {};
      fields.forEach((field) => {
        payload[field] = Object.prototype.hasOwnProperty.call(pair || {}, field) ? pair[field] : null;
      });
      const label = String(pair?.label || '').trim() || formatPairPresetLabel(payload, fields);
      return { label, payload };
    })
    .filter((option) => Object.keys(option.payload).length > 0);
}

function getCurrentGgufCachePair(model, draft) {
  return {
    gguf_type_k: getDraftOrEffectiveValue(draft, model, 'gguf_type_k', (value) => {
      if (value != null && String(value).trim() !== '') return String(value);
      return getEffectiveGgufCacheTypeForDisplay(model, 'gguf_type_k');
    }),
    gguf_type_v: getDraftOrEffectiveValue(draft, model, 'gguf_type_v', (value) => {
      if (value != null && String(value).trim() !== '') return String(value);
      return getEffectiveGgufCacheTypeForDisplay(model, 'gguf_type_v');
    }),
  };
}

function getCurrentExllamaCacheQuantPayload(model, draft) {
  return {
    exllama_cache_quant: getDraftOrEffectiveValue(
      draft,
      model,
      'exllama_cache_quant',
      (value) => normalizeExllamaCacheQuantValue(value),
    ),
  };
}

function getDraftOrEffectiveValue(draft, model, key, formatter) {
  if (draft && Object.prototype.hasOwnProperty.call(draft, key)) {
    return formatter(draft[key]);
  }
  return formatter(getEffectiveLoadValue(model, key));
}

function getEffectiveGgufCacheTypeForDisplay(model, key) {
  const effectiveValue = getEffectiveLoadValue(model, key);
  if (effectiveValue != null && String(effectiveValue).trim() !== '') {
    return String(effectiveValue);
  }
  const constraintDefault = model?.load_constraints?.[key]?.default;
  if (constraintDefault != null && String(constraintDefault).trim() !== '') {
    return String(constraintDefault);
  }
  return 'f16';
}

function normalizeExllamaCacheQuantValue(value) {
  if (value == null || value === '') {
    return null;
  }
  const parts = String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    const bits = toNullablePositiveInt(parts[0]);
    return bits == null ? null : String(bits);
  }
  if (parts.length >= 2) {
    const kBits = toNullablePositiveInt(parts[0]);
    const vBits = toNullablePositiveInt(parts[1]);
    if (kBits == null || vBits == null) return null;
    return `${kBits},${vBits}`;
  }
  return null;
}

function normalizeNullableStringValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function normalizeBooleanValue(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function toExllamaCacheQuant(payload) {
  const kBits = toNullablePositiveInt(payload?.exllama_cache_k_bits);
  const vBits = toNullablePositiveInt(payload?.exllama_cache_v_bits);
  if (kBits == null && vBits == null) {
    return null;
  }
  if (kBits != null && vBits != null && kBits === vBits) {
    return String(kBits);
  }
  if (kBits != null && vBits != null) {
    return `${kBits},${vBits}`;
  }
  return null;
}

function formatExllamaCacheTypeLabel(payload) {
  return formatExllamaCacheTypeValue(toExllamaCacheQuant(payload));
}

function formatExllamaCacheTypeValue(value) {
  const normalized = normalizeExllamaCacheQuantValue(value);
  if (normalized == null) {
    return 'fp16';
  }
  if (!normalized.includes(',')) {
    return `q${normalized}`;
  }
  const [kBits, vBits] = normalized.split(',');
  return `q${kBits}_q${vBits}`;
}

function serializeLoadPresetValue(payload) {
  return JSON.stringify(payload || {});
}

function parseLoadPresetValue(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatPairPresetLabel(payload, fields) {
  const values = Array.isArray(fields)
    ? fields.map((field) => formatPairPresetValue(payload?.[field]))
    : [];
  return values.join('/');
}

function formatPairPresetValue(value) {
  return value == null || value === '' ? 'fp16' : String(value);
}

function canConfigureLoadSettings(runtimeState) {
  return runtimeState === 'unloaded' || runtimeState === 'failed';
}

function buildLoadPayload(model, draft) {
  if (!model) return null;

  const payload = {};
  if (draft && typeof draft === 'object') {
    const replicaCount = toPositiveInt(draft.replicas);
    const defaultReplicaCount = toPositiveInt(model.definition?.replicas) ?? 1;
    const replicaMax = toPositiveInt(model.replica_max) ?? 1;
    if (replicaMax > 1 && replicaCount != null && replicaCount !== defaultReplicaCount) {
      payload.replicas = replicaCount;
    }
  }

  if (!draft || typeof draft !== 'object') {
    return Object.keys(payload).length ? payload : null;
  }
  const targetInflight = toPositiveInt(draft.target_inflight);
  if (
    targetInflight != null
    && hasLoadConstraint(model, 'target_inflight')
    && targetInflight !== toPositiveInt(model.definition?.target_inflight)
  ) {
    payload.target_inflight = targetInflight;
  }

  const ggufNctx = toPositiveInt(draft.gguf_n_ctx);
  if (
    ggufNctx != null
    && hasLoadConstraint(model, 'gguf_n_ctx')
    && ggufNctx !== toPositiveInt(model.definition?.gguf_n_ctx)
  ) {
    payload.gguf_n_ctx = ggufNctx;
  }

  if (Object.prototype.hasOwnProperty.call(draft, 'gguf_type_k') && hasLoadConstraint(model, 'gguf_type_k')) {
    payload.gguf_type_k = draft.gguf_type_k;
  }

  if (Object.prototype.hasOwnProperty.call(draft, 'gguf_type_v') && hasLoadConstraint(model, 'gguf_type_v')) {
    payload.gguf_type_v = draft.gguf_type_v;
  }

  if (Object.prototype.hasOwnProperty.call(draft, 'gguf_flash_attn') && hasLoadConstraint(model, 'gguf_flash_attn')) {
    payload.gguf_flash_attn = draft.gguf_flash_attn;
  }

  const exllamaCacheSize = toPositiveInt(draft.exllama_cache_size);
  if (
    exllamaCacheSize != null
    && hasLoadConstraint(model, 'exllama_cache_size')
    && exllamaCacheSize !== toPositiveInt(model.definition?.exllama_cache_size)
  ) {
    payload.exllama_cache_size = exllamaCacheSize;
  }

  if (Object.prototype.hasOwnProperty.call(draft, 'exllama_cache_quant') && hasLoadConstraint(model, 'exllama_cache_quant')) {
    payload.exllama_cache_quant = normalizeExllamaCacheQuantValue(draft.exllama_cache_quant);
  }

  const vllmMaxLen = toPositiveInt(draft.vllm_max_model_len);
  if (
    vllmMaxLen != null
    && hasLoadConstraint(model, 'vllm_max_model_len')
    && vllmMaxLen !== toPositiveInt(model.definition?.vllm_max_model_len)
  ) {
    payload.vllm_max_model_len = vllmMaxLen;
  }

  if (Object.prototype.hasOwnProperty.call(draft, 'vllm_kv_cache_dtype') && hasLoadConstraint(model, 'vllm_kv_cache_dtype')) {
    payload.vllm_kv_cache_dtype = draft.vllm_kv_cache_dtype;
  }

  const vllmKvMib = toPositiveInt(draft.vllm_kv_cache_mib);
  if (vllmKvMib != null && hasLoadConstraint(model, 'vllm_kv_cache_memory_bytes')) {
    const bytes = vllmKvMib * MIB;
    if (bytes !== toPositiveInt(model.definition?.vllm_kv_cache_memory_bytes)) {
      payload.vllm_kv_cache_memory_bytes = bytes;
    }
  }

  const vllmMaxPixels = toPositiveInt(draft.vllm_max_pixels);
  if (
    vllmMaxPixels != null
    && hasLoadConstraint(model, 'vllm_max_pixels')
    && shouldShowVllmMaxPixelsControl(model)
    && vllmMaxPixels !== getConfiguredMmProcessorMaxPixels(model)
  ) {
    payload.vllm_max_pixels = vllmMaxPixels;
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'vllm_speculative_method')
    && hasLoadConstraint(model, 'vllm_speculative_method')
    && shouldShowVllmSpeculativeMethodControl(model)
  ) {
    const draftSpeculativeMethod = normalizeNullableStringValue(draft.vllm_speculative_method);
    const configuredSpeculativeMethod = normalizeNullableStringValue(model.definition?.vllm_speculative_method);
    if (draftSpeculativeMethod !== configuredSpeculativeMethod) {
      payload.vllm_speculative_method = draftSpeculativeMethod;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'vllm_speculative_model')
    && hasLoadConstraint(model, 'vllm_speculative_model')
    && shouldShowVllmSpeculativeModelControl(model)
  ) {
    const draftSpeculativeModel = normalizeNullableStringValue(draft.vllm_speculative_model);
    const configuredSpeculativeModel = normalizeNullableStringValue(model.definition?.vllm_speculative_model);
    if (draftSpeculativeModel !== configuredSpeculativeModel) {
      payload.vllm_speculative_model = draftSpeculativeModel;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'vllm_speculative_moe_backend')
    && hasLoadConstraint(model, 'vllm_speculative_moe_backend')
    && shouldShowVllmSpeculativeMoeBackendControl(model)
  ) {
    const draftSpeculativeMoeBackend = normalizeNullableStringValue(draft.vllm_speculative_moe_backend);
    const configuredSpeculativeMoeBackend = normalizeNullableStringValue(
      model.definition?.vllm_speculative_moe_backend
    );
    if (draftSpeculativeMoeBackend !== configuredSpeculativeMoeBackend) {
      payload.vllm_speculative_moe_backend = draftSpeculativeMoeBackend;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'vllm_speculative_attention_backend')
    && hasLoadConstraint(model, 'vllm_speculative_attention_backend')
    && shouldShowVllmSpeculativeAttentionBackendControl(model)
  ) {
    const draftSpeculativeAttentionBackend = normalizeNullableStringValue(draft.vllm_speculative_attention_backend);
    const configuredSpeculativeAttentionBackend = normalizeNullableStringValue(
      model.definition?.vllm_speculative_attention_backend
    );
    if (draftSpeculativeAttentionBackend !== configuredSpeculativeAttentionBackend) {
      payload.vllm_speculative_attention_backend = draftSpeculativeAttentionBackend;
    }
  }

  const vllmNumSpeculativeTokens = toPositiveInt(draft.vllm_num_speculative_tokens);
  if (
    vllmNumSpeculativeTokens != null
    && hasLoadConstraint(model, 'vllm_num_speculative_tokens')
    && shouldShowVllmSpeculativeTokenControl(model)
    && vllmNumSpeculativeTokens !== toPositiveInt(model.definition?.vllm_num_speculative_tokens)
  ) {
    payload.vllm_num_speculative_tokens = vllmNumSpeculativeTokens;
  }

  const trtllmMaxSeqLen = toPositiveInt(draft.trtllm_max_seq_len);
  if (
    trtllmMaxSeqLen != null
    && hasLoadConstraint(model, 'trtllm_max_seq_len')
    && trtllmMaxSeqLen !== toPositiveInt(model.definition?.trtllm_max_seq_len)
  ) {
    payload.trtllm_max_seq_len = trtllmMaxSeqLen;
  }

  const trtllmKvMib = toPositiveInt(draft.trtllm_kv_cache_mib);
  if (trtllmKvMib != null && hasLoadConstraint(model, 'trtllm_kv_cache_memory_bytes')) {
    const bytes = trtllmKvMib * MIB;
    if (bytes !== toPositiveInt(model.definition?.trtllm_kv_cache_memory_bytes)) {
      payload.trtllm_kv_cache_memory_bytes = bytes;
    }
  }

  const trtllmMaxNumTokens = toPositiveInt(draft.trtllm_max_num_tokens);
  if (
    trtllmMaxNumTokens != null
    && hasLoadConstraint(model, 'trtllm_max_num_tokens')
    && trtllmMaxNumTokens !== toPositiveInt(model.definition?.trtllm_max_num_tokens)
  ) {
    payload.trtllm_max_num_tokens = trtllmMaxNumTokens;
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'trtllm_enable_chunked_prefill')
    && hasLoadConstraint(model, 'trtllm_enable_chunked_prefill')
  ) {
    const chunkedPrefill = normalizeBooleanValue(draft.trtllm_enable_chunked_prefill);
    const configuredChunkedPrefill = normalizeBooleanValue(
      model.definition?.trtllm_enable_chunked_prefill
    );
    if (chunkedPrefill != null && chunkedPrefill !== configuredChunkedPrefill) {
      payload.trtllm_enable_chunked_prefill = chunkedPrefill;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'trtllm_kv_cache_dtype')
    && hasLoadConstraint(model, 'trtllm_kv_cache_dtype')
  ) {
    const kvCacheDtype = String(draft.trtllm_kv_cache_dtype || '').trim();
    const configuredKvCacheDtype = String(
      model.definition?.trtllm_kv_cache_dtype || ''
    ).trim();
    if (kvCacheDtype && kvCacheDtype !== configuredKvCacheDtype) {
      payload.trtllm_kv_cache_dtype = kvCacheDtype;
    }
  }

  [
    'sglang_context_length',
    'sglang_max_total_tokens',
    'sglang_speculative_num_steps',
  ].forEach((key) => {
    const value = toPositiveInt(draft[key]);
    if (
      value != null
      && hasLoadConstraint(model, key)
      && value !== toPositiveInt(model.definition?.[key])
    ) {
      payload[key] = value;
    }
  });

  const sglangMemFraction = toFiniteNumber(draft.sglang_mem_fraction_static);
  if (
    sglangMemFraction != null
    && hasLoadConstraint(model, 'sglang_mem_fraction_static')
    && sglangMemFraction !== toFiniteNumber(model.definition?.sglang_mem_fraction_static)
  ) {
    payload.sglang_mem_fraction_static = sglangMemFraction;
  }

  const sglangChunkedPrefillSize = toFiniteNumber(draft.sglang_chunked_prefill_size);
  if (
    sglangChunkedPrefillSize != null
    && hasLoadConstraint(model, 'sglang_chunked_prefill_size')
    && Math.trunc(sglangChunkedPrefillSize) !== toFiniteNumber(
      model.definition?.sglang_chunked_prefill_size
    )
  ) {
    payload.sglang_chunked_prefill_size = Math.trunc(sglangChunkedPrefillSize);
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'sglang_kv_cache_dtype')
    && hasLoadConstraint(model, 'sglang_kv_cache_dtype')
  ) {
    const draftValue = String(draft.sglang_kv_cache_dtype || '').trim();
    const configuredValue = String(
      model.definition?.sglang_kv_cache_dtype || ''
    ).trim();
    if (draftValue && draftValue !== configuredValue) {
      payload.sglang_kv_cache_dtype = draftValue;
    }
  }

  ['sglang_speculative_algorithm'].forEach((key) => {
    if (
      !Object.prototype.hasOwnProperty.call(draft, key)
      || !hasLoadConstraint(model, key)
    ) return;
    const draftValue = normalizeNullableStringValue(draft[key]);
    const configuredValue = normalizeNullableStringValue(model.definition?.[key]);
    if (draftValue !== configuredValue) {
      payload[key] = draftValue;
    }
  });

  const llamaServerNctx = toPositiveInt(draft.llama_server_n_ctx);
  if (
    llamaServerNctx != null
    && hasLoadConstraint(model, 'llama_server_n_ctx')
    && llamaServerNctx !== toPositiveInt(model.definition?.llama_server_n_ctx)
  ) {
    payload.llama_server_n_ctx = llamaServerNctx;
  }

  const llamaServerImageTokens = toPositiveInt(draft.llama_server_image_max_tokens);
  if (
    llamaServerImageTokens != null
    && hasLoadConstraint(model, 'llama_server_image_max_tokens')
    && llamaServerImageTokens !== toPositiveInt(model.definition?.llama_server_image_max_tokens)
  ) {
    payload.llama_server_image_max_tokens = llamaServerImageTokens;
  }

  if (
    Object.prototype.hasOwnProperty.call(draft, 'llama_server_spec_type')
    && hasLoadConstraint(model, 'llama_server_spec_type')
  ) {
    const draftSpecType = String(draft.llama_server_spec_type || '').trim();
    if (draftSpecType && draftSpecType !== String(model.definition?.llama_server_spec_type || '')) {
      payload.llama_server_spec_type = draftSpecType;
    }
  }

  const llamaServerDraftMax = toPositiveInt(draft.llama_server_spec_draft_n_max);
  if (
    llamaServerDraftMax != null
    && hasLoadConstraint(model, 'llama_server_spec_draft_n_max')
    && llamaServerDraftMax !== toPositiveInt(model.definition?.llama_server_spec_draft_n_max)
  ) {
    payload.llama_server_spec_draft_n_max = llamaServerDraftMax;
  }

  const llamaServerDraftPMin = toFiniteNumber(draft.llama_server_spec_draft_p_min);
  if (
    llamaServerDraftPMin != null
    && hasLoadConstraint(model, 'llama_server_spec_draft_p_min')
    && llamaServerDraftPMin !== toFiniteNumber(model.definition?.llama_server_spec_draft_p_min)
  ) {
    payload.llama_server_spec_draft_p_min = llamaServerDraftPMin;
  }

  return Object.keys(payload).length ? payload : null;
}

function buildReplicaCountOptions(replicaMax) {
  return Array.from({length: replicaMax}, (_, index) => String(index + 1));
}

function getDraftOrEffectiveReplicaCount(model, draft) {
  const draftValue = toPositiveInt(draft?.replicas);
  if (draftValue != null) return String(draftValue);
  const currentValue = toPositiveInt(model?.replicas);
  if (currentValue != null) return String(currentValue);
  const definitionValue = toPositiveInt(model?.definition?.replicas);
  if (definitionValue != null) return String(definitionValue);
  return '1';
}

function getDisplayReplicaCount(model, draft, runtimeState) {
  const replicaMax = toPositiveInt(model?.replica_max) ?? 1;
  if (replicaMax <= 1) return null;
  if (canConfigureLoadSettings(runtimeState)) {
    return toPositiveInt(getDraftOrEffectiveReplicaCount(model, draft)) ?? 1;
  }
  return (
    toPositiveInt(model?.loaded_replicas)
    ?? toPositiveInt(model?.replicas)
    ?? toPositiveInt(model?.definition?.replicas)
    ?? 1
  );
}

function getDisplayVramEstimateMib(model, draft, runtimeState) {
  const baseMib = toNonNegativeInt(model?.vram_estimate_mib);
  if (baseMib <= 0) return 0;
  const desiredReplicaCount = getDisplayReplicaCount(model, draft, runtimeState) ?? 1;
  const estimateReplicaCount = toPositiveInt(model?.vram_estimate_replica_count) ?? 1;
  return Math.max(0, Math.round((baseMib / estimateReplicaCount) * desiredReplicaCount));
}

function setLoadSettingDraft(loadSettingDrafts, modelName, key, value) {
  const current = loadSettingDrafts.get(modelName) || {};
  loadSettingDrafts.set(modelName, {
    ...current,
    [key]: value,
  });
}

function pruneLoadSettingDrafts(loadSettingDrafts, models) {
  const known = new Set(models.map((model) => model.name));
  [...loadSettingDrafts.keys()].forEach((name) => {
    if (!known.has(name)) loadSettingDrafts.delete(name);
  });
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
  const loaded = models.filter((m) => m.runtime_state === 'loaded').length;
  const failed = models.filter((m) => m.runtime_state === 'failed' || m.runtime_state === 'error').length;
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
  const known = new Set(models.map((m) => m.name));
  [...expandedModels].forEach((name) => {
    if (!known.has(name)) expandedModels.delete(name);
  });
}

function toPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return Math.trunc(parsed);
}

function toNullablePositiveInt(value) {
  if (value == null || value === '') return null;
  return toPositiveInt(value);
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseLoadSettingControlValue(key, rawValue) {
  if (isStringLoadSettingKey(key)) {
    return normalizeNullableStringValue(rawValue);
  }
  if (
    key === 'llama_server_spec_draft_p_min'
    || key === 'sglang_mem_fraction_static'
  ) {
    return toFiniteNumber(rawValue) ?? undefined;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(parsed);
}

function isStringLoadSettingKey(key) {
  return (
    key === 'vllm_speculative_method'
    || key === 'vllm_speculative_model'
    || key === 'vllm_speculative_moe_backend'
    || key === 'vllm_speculative_attention_backend'
  );
}
