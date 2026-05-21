import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const REFRESH_INTERVAL_MS = 3000;
const INTERACTION_GUARD_MS = 1200;
const LLM_POOL_ADDRESS_LABEL = 'llm-pool';
const LOAD_SETTING_SLIDER_MAX = 65536;

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
    const value = Number(control.value);
    if (!modelName || !settingKey || !Number.isFinite(value)) return;
    deferAutoRefresh();
    setLoadSettingDraft(loadSettingDrafts, modelName, settingKey, Math.trunc(value));
    const valueEl = control
      .closest('.llm-pool-load-setting')
      ?.querySelector('[data-load-setting-value]');
    if (valueEl) {
      valueEl.textContent = String(Math.trunc(value));
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
  return normalizeBackend(model?.resolved_backend || model?.definition?.backend) === 'openai_compatible';
}

function normalizeBackend(value) {
  return String(value || '').trim().toLowerCase();
}

function formatBackendLabel(value) {
  const normalized = normalizeBackend(value);
  if (normalized === 'openai_compatible') return 'OpenAI compatible';
  return String(value || '-');
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
      { label: 'Path', value: definition.model_path, code: true },
      { label: 'Backend', value: formatBackendLabel(backend) },
      { label: 'Device', value: definition.device },
      { label: 'Prompt format', value: definition.prompt_format },
      { label: 'Configured enabled', value: model.configured_enabled },
      { label: 'Last error', value: model.last_error || 'none' },
      { label: 'VRAM source', value: model.vram_estimate_source || 'unavailable' },
    ];

  return `
    <div class="${definitionGridClass}">
      ${fields.map((field) => buildDefinitionItemMarkup(field)).join('')}
    </div>
  `;
}

function buildDefinitionItemMarkup({label, value, code = false}) {
  const normalizedValue = formatDefinitionValue(value);
  const tag = code ? 'code' : 'strong';
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <${tag}>${escapeHtml(normalizedValue)}</${tag}>
    </div>
  `;
}

function formatDefinitionValue(value) {
  if (value == null || value === '') return '-';
  if (typeof value === 'boolean') return String(value);
  return String(value);
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

function buildLoadSettingsMarkup(model, draft, runtimeState) {
  const wideControls = [];
  const compactControls = [];
  const notes = [];
  const canConfigure = canConfigureLoadSettings(runtimeState);
  let hasGgufConfigControls = false;
  const replicaMax = toPositiveInt(model?.replica_max) ?? 1;
  let replicaControlMarkup = '';

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

function buildSliderSettingMarkup({modelName, key, label, value, minimum, step, disabled}) {
  return `
    <div class="llm-pool-load-setting llm-pool-load-setting-wide">
      <span>${escapeHtml(label)}</span>
      <div class="llm-pool-load-slider-row">
        <input
          type="range"
          min="${escapeAttr(String(minimum))}"
          max="${escapeAttr(String(LOAD_SETTING_SLIDER_MAX))}"
          step="${escapeAttr(String(step))}"
          value="${escapeAttr(String(value))}"
          data-load-setting="${escapeAttr(key)}"
          data-model="${escapeAttr(modelName)}"
          ${disabled ? 'disabled' : ''}
        />
        <output class="llm-pool-load-slider-value" data-load-setting-value>${escapeHtml(String(value))}</output>
      </div>
    </div>
  `;
}

function buildEnumSelectSettingMarkup({modelName, key, label, options, value, disabled, wide = false}) {
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
          return `<option value="${escapeAttr(option)}"${selected}>${escapeHtml(option)}</option>`;
        }).join('')}
      </select>
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
  return { minimum, step };
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

function getDraftOrEffectiveIntegerValue(model, draft, key, fallbackMinimum) {
  const draftValue = toPositiveInt(draft?.[key]);
  if (draftValue != null) return draftValue;
  const effectiveValue = toPositiveInt(getEffectiveLoadValue(model, key));
  if (effectiveValue != null) return effectiveValue;
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

function getEffectiveLoadValue(model, key) {
  if (Object.prototype.hasOwnProperty.call(model?.load_override || {}, key)) {
    return model.load_override[key];
  }
  return model?.definition?.[key];
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
