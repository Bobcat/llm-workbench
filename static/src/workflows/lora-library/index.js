import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const FAMILY_LABELS = {
  'flux2-klein': 'FLUX.2 klein',
  'z-image': 'Z-Image',
  sdxl: 'SDXL',
};

const SOURCE_LABELS = {
  training_run: 'Trained',
  imported: 'Imported',
};

export function createLoraLibraryView() {
  const container = document.createElement('div');
  container.className = 'llm-pool-view image-lora-library-view';

  container.innerHTML = `
    <div class="llm-pool-shell">
      <div class="llm-pool-main">
        <header class="llm-pool-top-bar">
          <div class="llm-pool-topbar">
            <div class="llm-pool-topbar-copy"></div>
          </div>
          <section class="llm-pool-toolbar">
            <div class="llm-pool-filters image-lora-library-filters">
              <input id="imageLoraSearch" type="search" placeholder="Search" aria-label="Search LoRAs">
              <select id="imageLoraFamilyFilter" aria-label="Family filter">
                <option value="">All families</option>
              </select>
              <select id="imageLoraCompatibleFilter" aria-label="Compatible model filter">
                <option value="">All models</option>
              </select>
              <select id="imageLoraSourceFilter" aria-label="Source filter">
                <option value="">All sources</option>
              </select>
              <button type="button" id="imageLoraImportBtn">Import LoRA</button>
              <button type="button" id="imageLoraRefreshBtn">Refresh</button>
              <input id="imageLoraImportFile" type="file" accept=".safetensors" hidden>
            </div>
          </section>
        </header>

        <section class="image-lora-import-panel" id="imageLoraImportPanel" hidden></section>

        <div class="llm-pool-content-area">
          <section class="llm-pool-table-shell">
            <div class="llm-pool-table-header">
              ${['LoRA', 'Family', 'Source', 'Default', 'Trigger', 'Compatible', 'Path'].map((label) => `
                <div class="llm-pool-header-cell">
                  <span class="llm-pool-sort-label">${escapeHtml(label)}</span>
                </div>
              `).join('')}
            </div>
            <div id="imageLoraRows"></div>
          </section>
        </div>

        <footer class="llm-pool-bottom-bar">
          <div class="llm-pool-footer-stats" id="imageLoraStats">0 LoRAs</div>
          <div class="llm-pool-pool-address" id="imageLoraAddress">image-pool LoRA registry</div>
          <div class="llm-pool-footer-refresh" id="imageLoraRefreshStatus">Last refresh: -</div>
        </footer>
      </div>
    </div>
  `;

  const searchEl = container.querySelector('#imageLoraSearch');
  const familyFilterEl = container.querySelector('#imageLoraFamilyFilter');
  const compatibleFilterEl = container.querySelector('#imageLoraCompatibleFilter');
  const sourceFilterEl = container.querySelector('#imageLoraSourceFilter');
  const importBtn = container.querySelector('#imageLoraImportBtn');
  const importFileEl = container.querySelector('#imageLoraImportFile');
  const importPanelEl = container.querySelector('#imageLoraImportPanel');
  const refreshBtn = container.querySelector('#imageLoraRefreshBtn');
  const rowsHost = container.querySelector('#imageLoraRows');
  const statsEl = container.querySelector('#imageLoraStats');
  const refreshStatusEl = container.querySelector('#imageLoraRefreshStatus');

  let loras = [];
  let isLoading = false;
  let lastError = '';
  let lastRefreshLabel = '-';
  let refreshToken = 0;
  let importDraft = null;
  let importStatus = '';
  let importBusy = false;

  function render() {
    renderFilterOptions();
    const filtered = filteredLoras();
    rowsHost.innerHTML = buildRowsMarkup(filtered);
    statsEl.textContent = `${filtered.length} shown / ${loras.length} LoRAs`;
    refreshStatusEl.textContent = lastError
      ? `Last refresh: error (${lastError})`
      : `Last refresh: ${lastRefreshLabel}`;
    refreshBtn.disabled = isLoading || importBusy;
    importBtn.disabled = importBusy;
    renderImportPanel();
  }

  function renderFilterOptions() {
    renderSelectOptions(
      familyFilterEl,
      [{ value: '', label: 'All families' }, ...uniqueFamilies(loras).map((family) => ({
        value: family,
        label: familyLabel(family),
      }))]
    );
    renderSelectOptions(
      compatibleFilterEl,
      [{ value: '', label: 'All models' }, ...uniqueCompatibleModels(loras).map((model) => ({
        value: model,
        label: model,
      }))]
    );
    renderSelectOptions(
      sourceFilterEl,
      [{ value: '', label: 'All sources' }, ...uniqueSources(loras).map((source) => ({
        value: source,
        label: sourceLabel(source),
      }))]
    );
  }

  function renderSelectOptions(select, options) {
    const previous = String(select.value || '');
    select.innerHTML = options.map((option) => `
      <option value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</option>
    `).join('');
    select.value = options.some((option) => option.value === previous) ? previous : '';
  }

  function filteredLoras() {
    const search = String(searchEl.value || '').trim().toLowerCase();
    const family = String(familyFilterEl.value || '');
    const compatibleModel = String(compatibleFilterEl.value || '');
    const source = String(sourceFilterEl.value || '');
    return loras.filter((lora) => {
      if (family && lora.family !== family) return false;
      if (source && lora.sourceType !== source) return false;
      if (compatibleModel && !lora.compatibleModels.includes(compatibleModel)) return false;
      if (!search) return true;
      return [
        lora.name,
        lora.id,
        lora.description,
        lora.trainedOnModelId,
        lora.displayPath,
        ...lora.triggerWords,
        ...lora.compatibleModels,
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }

  async function refreshLoras() {
    const token = ++refreshToken;
    isLoading = true;
    render();
    try {
      const payload = await api.getImagePoolLoras();
      if (!container.isConnected || token !== refreshToken) return;
      const rawLoras = Array.isArray(payload?.loras) ? payload.loras : [];
      loras = rawLoras.map(normalizeLora).filter((lora) => lora.id && lora.path);
      lastError = '';
      lastRefreshLabel = formatClockTime(new Date());
    } catch (err) {
      if (!container.isConnected || token !== refreshToken) return;
      loras = [];
      lastError = formatApiError(err);
      lastRefreshLabel = formatClockTime(new Date());
    } finally {
      if (container.isConnected && token === refreshToken) {
        isLoading = false;
        render();
      }
    }
  }

  async function inspectImportFile(file) {
    if (!file) return;
    importBusy = true;
    importStatus = 'Inspecting LoRA...';
    importDraft = null;
    render();
    try {
      const formData = new FormData();
      formData.append('file', file);
      const payload = await api.inspectImagePoolLora(formData);
      if (!container.isConnected) return;
      importDraft = importDraftFromInspectPayload(file, payload);
      importStatus = 'Ready to import.';
    } catch (err) {
      if (!container.isConnected) return;
      importStatus = `Inspect failed: ${formatApiError(err)}`;
      importDraft = null;
    } finally {
      if (container.isConnected) {
        importBusy = false;
        render();
      }
    }
  }

  async function importCurrentDraft() {
    if (!importDraft || importBusy) return;
    importBusy = true;
    importStatus = 'Importing LoRA...';
    render();
    try {
      await api.importImagePoolLora({
        upload_id: importDraft.uploadId,
        name: importDraft.name,
        family: importDraft.family,
        compatible_models: importDraft.compatibleModels,
        trained_on_model_id: importDraft.trainedOnModelId,
        trigger_words: splitCommaList(importDraft.triggerWordsText),
        default_strength: finiteNumberOrNull(importDraft.defaultStrength),
        description: importDraft.description,
        source_url: importDraft.sourceUrl,
      });
      if (!container.isConnected) return;
      importDraft = null;
      importStatus = 'LoRA imported.';
      await refreshLoras();
    } catch (err) {
      if (!container.isConnected) return;
      importStatus = `Import failed: ${formatApiError(err)}`;
    } finally {
      if (container.isConnected) {
        importBusy = false;
        render();
      }
    }
  }

  function renderImportPanel() {
    if (!importDraft && !importStatus) {
      importPanelEl.hidden = true;
      importPanelEl.innerHTML = '';
      return;
    }
    importPanelEl.hidden = false;
    const draft = importDraft;
    if (!draft) {
      importPanelEl.innerHTML = `
        <div class="image-lora-import-head">
          <strong>Import LoRA</strong>
          <button type="button" data-import-action="cancel">Close</button>
        </div>
        <div class="translation-prompts-inline-status">${escapeHtml(importStatus)}</div>
      `;
      return;
    }
    const canImport = Boolean(
      draft.name.trim()
      && draft.family.trim()
      && draft.compatibleModels.length > 0
      && !importBusy
    );
    importPanelEl.innerHTML = `
      <div class="image-lora-import-head">
        <div>
          <strong>Import LoRA</strong>
          <span>${escapeHtml(draft.filename)}</span>
        </div>
        <button type="button" data-import-action="cancel">Cancel</button>
      </div>
      <div class="image-lora-import-grid">
        <label class="translation-prompts-field">
          <span>Name</span>
          <input data-import-field="name" type="text" value="${escapeAttr(draft.name)}">
        </label>
        <label class="translation-prompts-field">
          <span>Family</span>
          <select data-import-field="family">
            ${familyOptions(draft).map((family) => `
              <option value="${escapeAttr(family)}"${family === draft.family ? ' selected' : ''}>${escapeHtml(familyLabel(family))}</option>
            `).join('')}
          </select>
        </label>
        <label class="translation-prompts-field">
          <span>Default strength</span>
          <input data-import-field="defaultStrength" type="number" min="0" max="2" step="0.05" value="${escapeAttr(draft.defaultStrength)}">
        </label>
        <label class="translation-prompts-field">
          <span>Trigger words</span>
          <input data-import-field="triggerWordsText" type="text" value="${escapeAttr(draft.triggerWordsText)}">
        </label>
        <label class="translation-prompts-field">
          <span>Source URL</span>
          <input data-import-field="sourceUrl" type="url" value="${escapeAttr(draft.sourceUrl)}">
        </label>
        <label class="translation-prompts-field">
          <span>Trained on</span>
          <select data-import-field="trainedOnModelId">
            <option value="">Unknown</option>
            ${draft.modelOptions.map((model) => `
              <option value="${escapeAttr(model.id)}"${model.id === draft.trainedOnModelId ? ' selected' : ''}>${escapeHtml(model.id)}</option>
            `).join('')}
          </select>
        </label>
        <label class="translation-prompts-field image-lora-import-description">
          <span>Description</span>
          <textarea data-import-field="description" rows="3">${escapeHtml(draft.description)}</textarea>
        </label>
        <fieldset class="image-lora-import-compatible">
          <legend>Compatible models</legend>
          ${compatibleModelOptionsMarkup(draft)}
        </fieldset>
      </div>
      ${importWarningsMarkup(draft)}
      <div class="image-lora-import-actions">
        <span class="translation-prompts-inline-status">${escapeHtml(importStatus)}</span>
        <button type="button" data-import-action="submit"${canImport ? '' : ' disabled'}>Import</button>
      </div>
    `;
  }

  function updateImportDraftField(field, value) {
    if (!importDraft) return;
    importDraft = { ...importDraft, [field]: value };
    if (field === 'family') {
      const available = importDraft.modelOptions.filter((model) => model.family === value).map((model) => model.id);
      importDraft.compatibleModels = importDraft.compatibleModels.filter((modelId) => available.includes(modelId));
      if (importDraft.trainedOnModelId && !available.includes(importDraft.trainedOnModelId)) {
        importDraft.trainedOnModelId = '';
      }
      render();
    }
  }

  function toggleCompatibleModel(modelId, checked) {
    if (!importDraft) return;
    const next = new Set(importDraft.compatibleModels);
    if (checked) {
      next.add(modelId);
    } else {
      next.delete(modelId);
    }
    importDraft = { ...importDraft, compatibleModels: Array.from(next) };
    render();
  }

  searchEl.addEventListener('input', render);
  familyFilterEl.addEventListener('change', render);
  compatibleFilterEl.addEventListener('change', render);
  sourceFilterEl.addEventListener('change', render);
  importBtn.addEventListener('click', () => {
    importFileEl.value = '';
    importFileEl.click();
  });
  importFileEl.addEventListener('change', () => {
    inspectImportFile(importFileEl.files?.[0] || null);
  });
  refreshBtn.addEventListener('click', refreshLoras);

  importPanelEl.addEventListener('input', (event) => {
    const field = event.target.closest('[data-import-field]');
    if (!field || !importPanelEl.contains(field)) return;
    updateImportDraftField(String(field.dataset.importField || ''), field.value);
  });
  importPanelEl.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[data-compatible-model]');
    if (checkbox && importPanelEl.contains(checkbox)) {
      toggleCompatibleModel(String(checkbox.dataset.compatibleModel || ''), checkbox.checked);
      return;
    }
    const field = event.target.closest('[data-import-field]');
    if (!field || !importPanelEl.contains(field)) return;
    updateImportDraftField(String(field.dataset.importField || ''), field.value);
  });
  importPanelEl.addEventListener('click', (event) => {
    const action = event.target.closest('[data-import-action]');
    if (!action || !importPanelEl.contains(action)) return;
    if (action.dataset.importAction === 'cancel') {
      importDraft = null;
      importStatus = '';
      render();
    } else if (action.dataset.importAction === 'submit') {
      importCurrentDraft();
    }
  });

  container.__onActivate = () => {
    refreshLoras();
  };

  render();
  return container;
}

function normalizeLora(lora) {
  return {
    id: String(lora?.id || ''),
    name: String(lora?.name || lora?.id || ''),
    family: String(lora?.family || ''),
    sourceType: String(lora?.source_type || ''),
    artifactType: String(lora?.artifact_type || lora?.kind || ''),
    runId: String(lora?.run_id || ''),
    dataset: String(lora?.dataset || ''),
    trainedOnModelId: String(lora?.trained_on_model_id || lora?.model || ''),
    compatibleModels: stringList(lora?.compatible_models),
    triggerWords: stringList(lora?.trigger_words),
    defaultStrength: numberOrNull(lora?.default_strength),
    description: String(lora?.description || ''),
    sourceUrl: String(lora?.source_url || ''),
    path: String(lora?.path || ''),
    displayPath: String(lora?.display_path || lora?.path || ''),
    sizeBytes: Number.parseInt(lora?.size_bytes, 10),
    checkpointStep: Number.parseInt(lora?.checkpoint_step, 10),
  };
}

function importDraftFromInspectPayload(file, payload) {
  const filename = String(payload?.filename || file?.name || 'lora.safetensors');
  const modelOptions = Array.isArray(payload?.model_options)
    ? payload.model_options.map((model) => ({
      id: String(model?.id || ''),
      family: String(model?.family || ''),
      backend: String(model?.backend || ''),
      supportsLora: Boolean(model?.supports_lora),
    })).filter((model) => model.id && model.family && model.supportsLora)
    : [];
  const family = String(payload?.family_guess || modelOptions[0]?.family || '').trim();
  const suggestions = Array.isArray(payload?.compatible_model_suggestions)
    ? payload.compatible_model_suggestions.map((item) => String(item || '')).filter(Boolean)
    : [];
  const validSuggestions = suggestions.filter((modelId) => modelOptions.some((model) => model.id === modelId));
  const compatibleModels = validSuggestions.length === 1 ? validSuggestions : [];
  const defaultStrength = numberOrNull(payload?.default_strength_suggestion);
  const triggerWords = Array.isArray(payload?.trigger_words)
    ? payload.trigger_words.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return {
    uploadId: String(payload?.upload_id || ''),
    filename,
    name: filename.replace(/\.safetensors$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported LoRA',
    family,
    trainedOnModelId: compatibleModels[0] || '',
    compatibleModels,
    modelOptions,
    triggerWordsText: triggerWords.join(', '),
    defaultStrength: defaultStrength == null ? '' : defaultStrength.toFixed(2),
    description: '',
    sourceUrl: '',
    warnings,
    keyCount: Number.parseInt(payload?.key_count, 10),
    detectedModules: stringList(payload?.detected_modules),
    confidence: Number(payload?.confidence),
  };
}

function familyOptions(draft) {
  return uniqueStrings([
    draft.family,
    ...draft.modelOptions.map((model) => model.family),
    'flux2-klein',
    'z-image',
  ]);
}

function compatibleModelOptionsMarkup(draft) {
  const models = draft.modelOptions.filter((model) => model.family === draft.family);
  if (!models.length) {
    return '<span class="image-lora-library-muted">No compatible runtime models</span>';
  }
  return models.map((model) => `
    <label class="image-lora-import-model-option">
      <input
        type="checkbox"
        data-compatible-model="${escapeAttr(model.id)}"
        ${draft.compatibleModels.includes(model.id) ? 'checked' : ''}
      >
      <span>${escapeHtml(model.id)}</span>
    </label>
  `).join('');
}

function importWarningsMarkup(draft) {
  const facts = [
    Number.isFinite(draft.confidence) && draft.confidence > 0 ? `confidence ${draft.confidence.toFixed(2)}` : '',
    Number.isFinite(draft.keyCount) ? `${draft.keyCount} keys` : '',
    draft.detectedModules.length ? `modules: ${draft.detectedModules.join(', ')}` : '',
  ].filter(Boolean);
  const warnings = [...facts, ...draft.warnings];
  if (!warnings.length) return '';
  return `
    <div class="image-lora-import-warnings">
      ${warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join('')}
    </div>
  `;
}

function buildRowsMarkup(loras) {
  if (!loras.length) {
    return `
      <article class="llm-pool-row image-lora-library-row">
        <div class="llm-pool-cell model">
          <div class="llm-pool-model-name">No LoRAs</div>
        </div>
        <div class="llm-pool-cell meta">-</div>
        <div class="llm-pool-cell meta">-</div>
        <div class="llm-pool-cell mono">-</div>
        <div class="llm-pool-cell meta">-</div>
        <div class="llm-pool-cell meta">-</div>
        <div class="llm-pool-cell meta">-</div>
      </article>
    `;
  }

  return loras.map((lora) => `
    <article class="llm-pool-row image-lora-library-row">
      <div class="llm-pool-cell model">
        <div class="llm-pool-model-name">${escapeHtml(lora.name || lora.id)}</div>
        <div class="image-lora-library-subline">${escapeHtml(lora.description || lora.id)}</div>
      </div>
      <div class="llm-pool-cell meta">${escapeHtml(familyLabel(lora.family))}</div>
      <div class="llm-pool-cell meta">
        <div>${escapeHtml(sourceLabel(lora.sourceType))}</div>
        <div class="image-lora-library-subline">${escapeHtml(artifactLabel(lora))}</div>
      </div>
      <div class="llm-pool-cell mono">${escapeHtml(formatStrength(lora.defaultStrength))}</div>
      <div class="llm-pool-cell meta">${buildBadges(lora.triggerWords, 'No trigger')}</div>
      <div class="llm-pool-cell meta">${buildBadges(lora.compatibleModels, 'Unknown')}</div>
      <div class="llm-pool-cell meta image-lora-library-path" title="${escapeAttr(lora.path)}">
        ${escapeHtml(lora.displayPath || lora.path || '-')}
      </div>
    </article>
  `).join('');
}

function buildBadges(values, emptyLabel) {
  if (!values.length) {
    return `<span class="image-lora-library-muted">${escapeHtml(emptyLabel)}</span>`;
  }
  return `
    <div class="image-lora-library-badges">
      ${values.map((value) => `<span class="image-lora-library-badge">${escapeHtml(value)}</span>`).join('')}
    </div>
  `;
}

function uniqueFamilies(loras) {
  return uniqueStrings(loras.map((lora) => lora.family)).sort((left, right) => familyLabel(left).localeCompare(familyLabel(right), 'nl'));
}

function uniqueCompatibleModels(loras) {
  return uniqueStrings(loras.flatMap((lora) => lora.compatibleModels)).sort((left, right) => left.localeCompare(right, 'nl'));
}

function uniqueSources(loras) {
  return uniqueStrings(loras.map((lora) => lora.sourceType)).sort((left, right) => sourceLabel(left).localeCompare(sourceLabel(right), 'nl'));
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function splitCommaList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function finiteNumberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function familyLabel(family) {
  const value = String(family || '').trim();
  return FAMILY_LABELS[value] || value || 'Unknown';
}

function sourceLabel(source) {
  const value = String(source || '').trim();
  return SOURCE_LABELS[value] || value || 'Unknown';
}

function artifactLabel(lora) {
  if (lora.sourceType === 'imported') return 'imported file';
  if (Number.isFinite(lora.checkpointStep)) return `checkpoint ${lora.checkpointStep}`;
  return lora.artifactType || '-';
}

function formatStrength(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function formatClockTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
