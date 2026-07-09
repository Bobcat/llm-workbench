import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const REFRESH_INTERVAL_MS = 3000;
const VIDEO_POOL_ADDRESS_LABEL = '@127.0.0.1:8014';

export function createVideoPoolView() {
  const container = document.createElement('div');
  container.className = 'llm-pool-view image-pool-view video-pool-view';

  container.innerHTML = `
    <div class="llm-pool-shell">
      <div class="llm-pool-main">
        <header class="llm-pool-top-bar">
          <div class="llm-pool-topbar">
            <div class="llm-pool-topbar-copy"></div>
          </div>
          <section class="llm-pool-toolbar">
            <div class="llm-pool-filters">
              <button type="button" id="videoPoolRefreshBtn">Refresh</button>
            </div>
          </section>
        </header>

        <div class="llm-pool-content-area">
          <section class="llm-pool-table-shell">
            <div class="llm-pool-table-header">
              ${['Model', 'State', 'Action', 'Inflight', 'Queue', 'Backend', 'VRAM'].map((label) => `
                <div class="llm-pool-header-cell">
                  <span class="llm-pool-sort-label">${escapeHtml(label)}</span>
                </div>
              `).join('')}
            </div>
            <div id="videoPoolRows"></div>
          </section>
        </div>

        <footer class="llm-pool-bottom-bar">
          <div class="llm-pool-footer-stats" id="videoPoolStats">0 models / 0 loaded / 0 failed</div>
          <div class="llm-pool-pool-address" id="videoPoolAddress">${VIDEO_POOL_ADDRESS_LABEL} - -</div>
          <div class="llm-pool-footer-refresh" id="videoPoolRefresh">Last refresh: -</div>
        </footer>
      </div>
    </div>
  `;

  const rowsHost = container.querySelector('#videoPoolRows');
  const statsEl = container.querySelector('#videoPoolStats');
  const refreshEl = container.querySelector('#videoPoolRefresh');
  const addressEl = container.querySelector('#videoPoolAddress');
  const refreshBtn = container.querySelector('#videoPoolRefreshBtn');

  let models = [];
  let gpuMemory = null;
  let poolAddressLabel = VIDEO_POOL_ADDRESS_LABEL;
  let lastRefreshLabel = '-';
  let lastError = '';
  let activeActionModel = '';
  let activeActionKind = '';
  let refreshIntervalId = null;
  let refreshToken = 0;
  const expandedModels = new Set();
  const loadSettingDrafts = new Map();

  function render() {
    const sorted = [...models].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'nl'));
    rowsHost.innerHTML = buildRowsMarkup(sorted, expandedModels, activeActionModel, activeActionKind, loadSettingDrafts);
    statsEl.textContent = buildStatsText(models);
    addressEl.textContent = `${poolAddressLabel} - ${buildGpuUsageLabel(gpuMemory)}`;
    refreshEl.textContent = lastError
      ? `Last refresh: error (${lastError})`
      : `Last refresh: ${lastRefreshLabel}`;
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
      if (activeActionModel) return;
      refreshModels();
    }, REFRESH_INTERVAL_MS);
  }

  async function refreshModels() {
    const token = ++refreshToken;
    try {
      const [modelsPayload, gpuPayload] = await Promise.all([
        api.getVideoPoolAdminModels(),
        api.getVideoPoolAdminGpuMemory().catch(() => null),
      ]);
      if (!container.isConnected || token !== refreshToken) return;
      models = normalizeModelsPayload(modelsPayload, gpuPayload);
      poolAddressLabel = formatPoolAddressLabel(modelsPayload?.proxy_base_url);
      gpuMemory = normalizeGpuMemoryPayload(gpuPayload);
      lastError = '';
      lastRefreshLabel = formatClockTime(new Date());
      pruneExpandedModels(expandedModels, models);
      pruneLoadSettingDrafts(loadSettingDrafts, models);
    } catch (err) {
      if (!container.isConnected || token !== refreshToken) return;
      models = [];
      gpuMemory = null;
      poolAddressLabel = VIDEO_POOL_ADDRESS_LABEL;
      lastError = formatApiError(err);
      lastRefreshLabel = formatClockTime(new Date());
      expandedModels.clear();
      loadSettingDrafts.clear();
    }
    render();
  }

  async function runAction(modelName, kind) {
    if (!modelName || activeActionModel) return;
    activeActionModel = modelName;
    activeActionKind = kind;
    render();

    try {
      if (kind === 'load') {
        const model = models.find((entry) => entry.name === modelName) || null;
        await api.loadVideoPoolAdminModel(modelName, buildLoadPayload(model, loadSettingDrafts.get(modelName)));
      } else if (kind === 'unload') {
        await api.unloadVideoPoolAdminModel(modelName);
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

  refreshBtn.addEventListener('click', () => {
    refreshModels();
  });

  container.addEventListener('click', (event) => {
    const actionButton = event.target.closest('button[data-action][data-model]');
    if (actionButton && container.contains(actionButton)) {
      event.preventDefault();
      event.stopPropagation();
      runAction(String(actionButton.dataset.model || ''), String(actionButton.dataset.action || ''));
      return;
    }

    const row = event.target.closest('.llm-pool-row.is-expandable[data-model]');
    if (!row || !container.contains(row)) return;
    if (event.target.closest('.llm-pool-cell.actions')) return;

    const modelName = String(row.dataset.model || '');
    if (!modelName) return;
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
    const model = models.find((entry) => entry.name === modelName) || null;
    const value = parseLoadSettingControlValue(model, settingKey, control.value);
    if (!modelName || !settingKey || value === undefined) return;
    setLoadSettingDraft(loadSettingDrafts, modelName, settingKey, value);
  });

  container.addEventListener('change', (event) => {
    const control = event.target.closest('select[data-load-setting][data-model]');
    if (!control || !container.contains(control)) return;
    const modelName = String(control.dataset.model || '');
    const settingKey = String(control.dataset.loadSetting || '');
    const model = models.find((entry) => entry.name === modelName) || null;
    const value = parseLoadSettingControlValue(model, settingKey, control.value);
    if (!modelName || !settingKey || value === undefined) return;
    setLoadSettingDraft(loadSettingDrafts, modelName, settingKey, value);
  });

  container.__onActivate = () => {
    refreshModels();
    startAutoRefresh();
  };
  container.__onDeactivate = () => {
    stopAutoRefresh();
  };

  render();
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
      vram_estimate_mib: toNullableNonNegativeInt(vramEntry.mib ?? model?.vram_estimate_mib),
      vram_estimate_source: String(vramEntry.source ?? model?.vram_estimate_source ?? ''),
      capabilities: asPlainObject(model?.capabilities),
      load_constraints: asPlainObject(model?.load_constraints),
      load_recommendations: asPlainObject(model?.load_recommendations),
      load_override: asPlainObject(model?.load_override),
      definition: asPlainObject(model?.definition),
    };
  });
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
        <div class="llm-pool-cell mono">-</div>
        <div class="llm-pool-cell meta">-</div>
        <div class="llm-pool-cell vram vram-muted">-</div>
      </article>
    `;
  }

  return models.map((model, index) => {
    const name = model.name || '(unnamed)';
    const runtime = model.runtime_state;
    const runtimeForUi = activeActionModel === name
      ? (activeActionKind === 'load' ? 'loading' : (activeActionKind === 'unload' ? 'unloading' : runtime))
      : runtime;
    const action = actionForState(runtime);
    const backend = String(model.resolved_backend || model.definition?.backend || '-');
    const backendLabel = formatBackendLabel(backend);
    const vramMib = toNullableNonNegativeInt(model.vram_estimate_mib);
    const vramText = vramMib == null || vramMib === 0 ? '-' : `${vramMib}MiB`;
    const vramPill = shouldShowStatePill(runtimeForUi);
    const vramPillTone = pillToneForRuntime(runtimeForUi);
    const vramHtml = vramPill
      ? `<span class="llm-pool-pill ${escapeAttr(vramPillTone)}">${escapeHtml(vramText)}</span>`
      : escapeHtml(vramText);
    const detailsId = `video-pool-details-${index}`;
    const isExpanded = expandedModels.has(name);
    const isBusyAction = activeActionModel === name && activeActionKind === action?.kind;
    const actionLabel = isBusyAction ? `${action?.label || ''}...` : action?.label || '';
    const modelPath = String(model.definition?.model_path || '-');
    const targetInflight = `${model.configured_target_inflight} configured / ${model.effective_target_inflight} effective`;
    const capabilities = buildCapabilitiesSummary(model.capabilities);
    const lastError = model.last_error == null || model.last_error === '' ? 'none' : String(model.last_error);
    const loadSettingsHtml = buildLoadSettingsMarkup(model, loadSettingDrafts.get(name), runtimeForUi);
    const definitionGridClass = loadSettingsHtml
      ? 'llm-pool-definition-grid llm-pool-definition-grid-with-divider'
      : 'llm-pool-definition-grid';
    const rowClass = [
      'llm-pool-row',
      'is-expandable',
      runtime === 'loaded' ? 'is-loaded' : '',
    ].join(' ').trim();

    return `
      <article class="${rowClass}" data-model="${escapeAttr(name)}" aria-expanded="${String(isExpanded)}">
        <div class="llm-pool-cell model">
          <div class="llm-pool-model-name">${escapeHtml(name)}</div>
        </div>
        <div class="llm-pool-cell runtime ${runtimeClass(runtimeForUi)}">${escapeHtml(runtimeText(runtimeForUi))}</div>
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
        <div class="llm-pool-cell meta" title="${escapeAttr(backend)}">
          <span class="llm-pool-backend-label">${escapeHtml(backendLabel)}</span>
        </div>
        <div class="llm-pool-cell vram ${vramClassForRuntime(runtimeForUi)}">${vramHtml}</div>
      </article>
      <article class="llm-pool-row-details${isExpanded ? ' is-open' : ''}" id="${detailsId}" ${isExpanded ? '' : 'hidden'}>
        ${loadSettingsHtml}
        <div class="${definitionGridClass}">
          <div><span>Path</span><code>${escapeHtml(modelPath)}</code></div>
          <div><span>Backend</span><strong>${escapeHtml(backend)}</strong></div>
          <div><span>Configured enabled</span><strong>${escapeHtml(String(model.configured_enabled ?? '-'))}</strong></div>
          <div><span>Target inflight</span><strong>${escapeHtml(targetInflight)}</strong></div>
          <div><span>Capabilities</span><strong>${escapeHtml(capabilities)}</strong></div>
          <div><span>Last error</span><strong>${escapeHtml(lastError)}</strong></div>
          <div><span>VRAM source</span><strong>${escapeHtml(model.vram_estimate_source || 'unavailable')}</strong></div>
        </div>
      </article>
    `;
  }).join('');
}

function buildLoadSettingsMarkup(model, draft, runtimeState) {
  const constraints = asPlainObject(model?.load_constraints);
  const entries = Object.entries(constraints);
  if (!entries.length) return '';
  const canConfigure = runtimeState === 'unloaded' || runtimeState === 'failed' || runtimeState === 'error';
  const controls = entries.map(([key, definition]) => buildLoadSettingMarkup({
    modelName: model.name,
    key,
    definition,
    value: getDraftOrEffectiveLoadValue(model, draft, key, definition),
    disabled: !canConfigure,
  })).filter(Boolean);
  if (!controls.length) return '';
  const compactColumnCount = Math.min(Math.max(controls.length, 1), 3);
  return `
    <div class="llm-pool-load-settings">
      <div class="llm-pool-load-settings-compact llm-pool-load-settings-compact-${compactColumnCount}">
        ${controls.join('')}
      </div>
    </div>
  `;
}

function buildLoadSettingMarkup({modelName, key, definition, value, disabled}) {
  const kind = String(definition?.kind || '').trim();
  const label = parameterLabel(definition, key);
  if (kind === 'enum' || kind === 'boolean') {
    const options = kind === 'boolean' ? ['false', 'true'] : enumValues(definition);
    if (!options.length) return '';
    const selectedValue = kind === 'boolean' ? String(value === true || value === 'true') : String(value ?? '');
    return `
      <div class="llm-pool-load-setting">
        <span>${escapeHtml(label)}</span>
        <select
          class="llm-pool-load-select"
          data-load-setting="${escapeAttr(key)}"
          data-model="${escapeAttr(modelName)}"
          ${disabled ? 'disabled' : ''}
        >
          ${options.map((option) => {
            const selected = String(option) === selectedValue ? ' selected' : '';
            return `<option value="${escapeAttr(String(option))}"${selected}>${escapeHtml(String(option))}</option>`;
          }).join('')}
        </select>
      </div>
    `;
  }
  if (kind === 'integer' || kind === 'number' || kind === 'float' || kind === 'integer_or_null' || kind === 'number_or_null') {
    const minAttr = definition?.minimum == null ? '' : ` min="${escapeAttr(String(definition.minimum))}"`;
    const maxAttr = definition?.maximum == null ? '' : ` max="${escapeAttr(String(definition.maximum))}"`;
    const step = definition?.step == null ? (kind === 'integer' || kind === 'integer_or_null' ? 1 : 0.1) : definition.step;
    return `
      <div class="llm-pool-load-setting">
        <span>${escapeHtml(label)}</span>
        <input
          class="llm-pool-load-input"
          type="number"
          ${minAttr}
          ${maxAttr}
          step="${escapeAttr(String(step))}"
          value="${escapeAttr(formatLoadInputValue(value))}"
          data-load-setting="${escapeAttr(key)}"
          data-model="${escapeAttr(modelName)}"
          ${disabled ? 'disabled' : ''}
        />
      </div>
    `;
  }
  if (kind === 'string' || kind === 'string_or_null' || kind === 'integer_list') {
    return `
      <div class="llm-pool-load-setting">
        <span>${escapeHtml(label)}</span>
        <input
          class="llm-pool-load-input"
          type="text"
          value="${escapeAttr(formatLoadInputValue(value))}"
          data-load-setting="${escapeAttr(key)}"
          data-model="${escapeAttr(modelName)}"
          autocomplete="off"
          spellcheck="false"
          ${disabled ? 'disabled' : ''}
        />
      </div>
    `;
  }
  return '';
}

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function formatPoolAddressLabel(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) return VIDEO_POOL_ADDRESS_LABEL;
  return `@${value.replace(/^https?:\/\//, '')}`;
}

function normalizeGpuMemoryPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const gpus = Array.isArray(payload.gpus) ? payload.gpus : [];
  return { gpus };
}

function normalizeRuntimeState(state) {
  return String(state || 'unloaded').trim().toLowerCase();
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

function actionForState(state) {
  if (state === 'loaded') return { kind: 'unload', label: 'Unload' };
  if (state === 'unloaded') return { kind: 'load', label: 'Load' };
  if (state === 'failed' || state === 'error') return { kind: 'load', label: 'Retry' };
  return null;
}

function formatBackendLabel(value) {
  const backend = String(value || '-').trim();
  const normalized = backend.toLowerCase();
  if (normalized === 'stub') return 'Stub';
  if (normalized === 'diffusers_wan') return 'WAN';
  return backend || '-';
}

function vramClassForRuntime(runtimeState) {
  if (isProblemRuntimeState(runtimeState)) return 'vram-danger';
  return isActiveVramState(runtimeState) ? 'vram-active' : 'vram-muted';
}

function isActiveVramState(state) {
  return state === 'loaded' || state === 'loading' || state === 'unloading';
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

function buildCapabilitiesSummary(capabilities) {
  const tasks = Array.isArray(capabilities?.tasks) ? capabilities.tasks : [];
  const inputModalities = Array.isArray(capabilities?.input_modalities) ? capabilities.input_modalities : [];
  const outputModalities = Array.isArray(capabilities?.output_modalities) ? capabilities.output_modalities : [];
  const parts = [
    tasks.join(', '),
    inputModalities.length ? `in: ${inputModalities.join(', ')}` : '',
    outputModalities.length ? `out: ${outputModalities.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join(' / ') || '-';
}

function getDraftOrEffectiveLoadValue(model, draft, key, definition) {
  if (draft && Object.prototype.hasOwnProperty.call(draft, key)) {
    return draft[key];
  }
  if (Object.prototype.hasOwnProperty.call(model?.load_override || {}, key)) {
    return model.load_override[key];
  }
  if (Object.prototype.hasOwnProperty.call(model?.definition || {}, key)) {
    return model.definition[key];
  }
  return definition?.default;
}

function parseLoadSettingControlValue(model, key, rawValue) {
  const definition = model?.load_constraints?.[key];
  const kind = String(definition?.kind || '').trim();
  const text = String(rawValue ?? '').trim();
  if (!kind) return undefined;
  if (kind === 'boolean') {
    return text === 'true';
  }
  if (kind === 'integer') {
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === 'integer_or_null') {
    if (!text) return null;
    const parsed = Number.parseInt(text, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === 'number' || kind === 'float') {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === 'number_or_null') {
    if (!text) return null;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (kind === 'string_or_null') {
    return text || null;
  }
  if (kind === 'integer_list') {
    if (!text) return [];
    const values = text.split(',').map((part) => Number.parseInt(part.trim(), 10));
    return values.every((value) => Number.isFinite(value)) ? values : undefined;
  }
  return text;
}

function setLoadSettingDraft(drafts, modelName, key, value) {
  const draft = {...(drafts.get(modelName) || {})};
  draft[key] = value;
  drafts.set(modelName, draft);
}

function pruneLoadSettingDrafts(drafts, models) {
  const known = new Set(models.map((model) => model.name));
  [...drafts.keys()].forEach((name) => {
    if (!known.has(name)) drafts.delete(name);
  });
}

function buildLoadPayload(model, draft) {
  if (!model || !draft || typeof draft !== 'object') return {};
  const constraints = asPlainObject(model.load_constraints);
  const payload = {};
  Object.entries(draft).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(constraints, key)) {
      payload[key] = value;
    }
  });
  return payload;
}

function parameterLabel(definition, fallback) {
  const label = String(definition?.label || '').trim();
  return label || fallback;
}

function enumValues(definition) {
  return Array.isArray(definition?.allowed_values)
    ? definition.allowed_values.map((item) => String(item)).filter(Boolean)
    : [];
}

function formatLoadInputValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function buildStatsText(models) {
  const total = models.length;
  const loaded = models.filter((model) => model.runtime_state === 'loaded').length;
  const failed = models.filter((model) => model.runtime_state === 'failed' || model.runtime_state === 'error').length;
  return `${total} models / ${loaded} loaded / ${failed} failed`;
}

function buildGpuUsageLabel(gpuMemory) {
  const firstGpu = gpuMemory?.gpus?.[0];
  if (!firstGpu) return '-';
  const usedOverTotal = String(firstGpu.used_over_total || '').trim();
  if (usedOverTotal) return usedOverTotal;
  const usedMib = toNonNegativeInt(firstGpu.used_mib);
  const totalMib = toNonNegativeInt(firstGpu.total_mib);
  return totalMib ? `${usedMib}MiB / ${totalMib}MiB` : '-';
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

function toNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  if (parsed < 0) return 0;
  return Math.trunc(parsed);
}

function toNullableNonNegativeInt(value) {
  if (value == null) return null;
  return toNonNegativeInt(value);
}
