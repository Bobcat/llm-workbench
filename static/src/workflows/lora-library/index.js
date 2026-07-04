import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const FAMILY_LABELS = {
  'flux2-klein': 'FLUX.2 klein',
  'z-image': 'Z-Image',
  sdxl: 'SDXL',
  sd15: 'SD 1.5',
};

const SOURCE_LABELS = {
  training_run: 'Trained',
  imported: 'Imported',
};

const FORMAT_LABELS = {
  diffusers: 'Diffusers',
  'diffusers-transformer': 'Diffusers transformer',
  kohya: 'Kohya',
  'kohya-sgm': 'Kohya / SGM',
  'textual-inversion': 'Textual inversion',
  unknown: 'Unknown',
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
              ${['LoRA', 'Family', 'Source', 'Default', 'Trigger', 'Compatible', 'Path', 'Actions'].map((label) => `
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
  let deleteBusySlug = '';
  let editSchema = normalizeEditSchema(null);
  let editingLoraId = '';
  let editDraft = null;
  let editStatus = '';
  let editBusySlug = '';
  const expandedLoras = new Set();

  function render() {
    renderFilterOptions();
    const filtered = filteredLoras();
    rowsHost.innerHTML = buildRowsMarkup(filtered, expandedLoras, editSchema, {
      deleteBusySlug,
      editBusySlug,
      editingLoraId,
      editDraft,
      editStatus,
      actionsDisabled: isLoading || importBusy || Boolean(editBusySlug),
    });
    statsEl.textContent = `${filtered.length} shown / ${loras.length} LoRAs`;
    refreshStatusEl.textContent = lastError
      ? `Last refresh: error (${lastError})`
      : `Last refresh: ${lastRefreshLabel}`;
    refreshBtn.disabled = isLoading || importBusy || Boolean(deleteBusySlug) || Boolean(editBusySlug);
    importBtn.disabled = importBusy || Boolean(deleteBusySlug) || Boolean(editBusySlug);
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
      editSchema = normalizeEditSchema(payload?.edit_schema);
      pruneExpandedLoras(expandedLoras, loras);
      if (editingLoraId && !loras.some((lora) => lora.id === editingLoraId)) {
        editingLoraId = '';
        editDraft = null;
        editStatus = '';
      }
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

  async function deleteImportedLora(lora) {
    if (!lora || !lora.deletable || !lora.deleteSlug || deleteBusySlug || editBusySlug) return;
    const confirmed = window.confirm(`Delete imported LoRA "${lora.name || lora.id}"?`);
    if (!confirmed) return;

    deleteBusySlug = lora.deleteSlug;
    render();
    try {
      await api.deleteImagePoolLora(lora.deleteSlug);
      if (!container.isConnected) return;
      loras = loras.filter((item) => item.id !== lora.id);
      expandedLoras.delete(lora.id);
      lastError = '';
      lastRefreshLabel = formatClockTime(new Date());
    } catch (err) {
      if (!container.isConnected) return;
      lastError = `Delete failed: ${formatApiError(err)}`;
    } finally {
      if (container.isConnected) {
        deleteBusySlug = '';
        render();
      }
    }
  }

  function startEditLora(lora) {
    if (!lora || !lora.editable || !lora.updateSlug || editBusySlug) return;
    editingLoraId = lora.id;
    editDraft = editDraftFromLora(lora);
    editStatus = '';
    expandedLoras.add(lora.id);
    render();
  }

  function cancelEditLora() {
    if (editBusySlug) return;
    editingLoraId = '';
    editDraft = null;
    editStatus = '';
    render();
  }

  async function saveEditDraft() {
    if (!editDraft || editBusySlug) return;
    const lora = loras.find((item) => item.id === editingLoraId && item.editable);
    if (!lora || !lora.updateSlug) return;

    editBusySlug = lora.updateSlug;
    editStatus = 'Saving...';
    render();
    try {
      const response = await api.updateImagePoolLora(lora.updateSlug, {
        name: editDraft.name,
        family: editDraft.family,
        compatible_models: editDraft.compatibleModels,
        trained_on_model_id: editDraft.trainedOnModelId,
        trigger_words: splitCommaList(editDraft.triggerWordsText),
        default_strength: finiteNumberOrNull(editDraft.defaultStrength),
        description: editDraft.description,
        source_url: editDraft.sourceUrl,
      });
      if (!container.isConnected) return;
      const updated = normalizeLora(response?.lora);
      if (updated.id) {
        loras = loras.map((item) => (item.id === updated.id ? updated : item));
      }
      editingLoraId = '';
      editDraft = null;
      editStatus = '';
      lastError = '';
      lastRefreshLabel = formatClockTime(new Date());
    } catch (err) {
      if (!container.isConnected) return;
      editStatus = `Save failed: ${formatApiError(err)}`;
    } finally {
      if (container.isConnected) {
        editBusySlug = '';
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

  function updateEditDraftField(field, value) {
    if (!editDraft) return;
    editDraft = { ...editDraft, [field]: value };
    if (field === 'family') {
      const available = compatibleModelsForFamily(editSchema, value);
      editDraft.compatibleModels = editDraft.compatibleModels.filter((modelId) => available.includes(modelId));
      if (editDraft.trainedOnModelId && !available.includes(editDraft.trainedOnModelId)) {
        editDraft.trainedOnModelId = '';
      }
      render();
    }
  }

  function toggleEditCompatibleModel(modelId, checked) {
    if (!editDraft) return;
    const next = new Set(editDraft.compatibleModels);
    if (checked) {
      next.add(modelId);
    } else {
      next.delete(modelId);
    }
    editDraft = { ...editDraft, compatibleModels: Array.from(next) };
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
  rowsHost.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-lora-edit]');
    if (editButton && rowsHost.contains(editButton)) {
      event.preventDefault();
      event.stopPropagation();
      const slug = String(editButton.dataset.loraEdit || '');
      const lora = loras.find((item) => item.updateSlug === slug && item.editable);
      startEditLora(lora);
      return;
    }

    const button = event.target.closest('[data-lora-delete]');
    if (button && rowsHost.contains(button)) {
      event.preventDefault();
      event.stopPropagation();
      const slug = String(button.dataset.loraDelete || '');
      const lora = loras.find((item) => item.deleteSlug === slug && item.deletable);
      deleteImportedLora(lora);
      return;
    }

    const editAction = event.target.closest('[data-edit-action]');
    if (editAction && rowsHost.contains(editAction)) {
      event.preventDefault();
      event.stopPropagation();
      if (editAction.dataset.editAction === 'cancel') {
        cancelEditLora();
      } else if (editAction.dataset.editAction === 'save') {
        saveEditDraft();
      }
      return;
    }

    const row = event.target.closest('.llm-pool-row.is-expandable[data-lora-id]');
    if (!row || !rowsHost.contains(row)) return;
    const loraId = String(row.dataset.loraId || '');
    if (!loraId) return;
    if (expandedLoras.has(loraId)) {
      expandedLoras.delete(loraId);
    } else {
      expandedLoras.add(loraId);
    }
    render();
  });

  rowsHost.addEventListener('input', (event) => {
    const field = event.target.closest('[data-edit-field]');
    if (!field || !rowsHost.contains(field)) return;
    updateEditDraftField(String(field.dataset.editField || ''), field.value);
  });

  rowsHost.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[data-edit-compatible-model]');
    if (checkbox && rowsHost.contains(checkbox)) {
      toggleEditCompatibleModel(String(checkbox.dataset.editCompatibleModel || ''), checkbox.checked);
      return;
    }
    const field = event.target.closest('[data-edit-field]');
    if (!field || !rowsHost.contains(field)) return;
    updateEditDraftField(String(field.dataset.editField || ''), field.value);
  });

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
  const id = String(lora?.id || '');
  const deletable = Boolean(lora?.deletable);
  const deleteSlug = deletable
    ? String(lora?.delete_slug || id.replace(/^imported\//, '') || '').trim()
    : '';
  const editable = Boolean(lora?.editable);
  const updateSlug = editable
    ? String(lora?.update_slug || id.replace(/^imported\//, '') || '').trim()
    : '';
  return {
    id,
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
    inspection: normalizeInspection(lora?.inspection),
    deletable,
    deleteSlug,
    editable,
    updateSlug,
  };
}

function normalizeEditSchema(value) {
  const fields = value?.fields && typeof value.fields === 'object' && !Array.isArray(value.fields)
    ? value.fields
    : {};
  const compatibleField = fields.compatible_models && typeof fields.compatible_models === 'object'
    ? fields.compatible_models
    : {};
  const byFamily = compatibleField.allowed_values_by_family
    && typeof compatibleField.allowed_values_by_family === 'object'
    && !Array.isArray(compatibleField.allowed_values_by_family)
    ? compatibleField.allowed_values_by_family
    : {};
  return {
    families: stringList(fields.family?.allowed_values),
    trainedOnModels: stringList(fields.trained_on_model_id?.allowed_values),
    compatibleModelsByFamily: Object.fromEntries(
      Object.entries(byFamily).map(([family, models]) => [String(family), stringList(models)])
    ),
  };
}

function normalizeInspection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      formatGuess: '',
      familyGuess: '',
      confidence: null,
      detectedModules: [],
      componentCounts: {},
      targetCounts: {},
      keyCount: null,
      sampleKeys: [],
      triggerWords: [],
      metadata: {},
      metadataKeys: [],
    };
  }
  const metadata = value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
    ? value.metadata
    : {};
  return {
    formatGuess: String(value.format_guess || ''),
    familyGuess: String(value.family_guess || ''),
    confidence: numberOrNull(value.confidence),
    detectedModules: stringList(value.detected_modules),
    componentCounts: normalizeCountMap(value.component_counts),
    targetCounts: normalizeCountMap(value.target_counts),
    keyCount: numberOrNull(value.key_count),
    sampleKeys: stringList(value.sample_keys),
    triggerWords: stringList(value.trigger_words),
    metadata,
    metadataKeys: stringList(value.metadata_keys),
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
    formatGuess: String(payload?.format_guess || ''),
    keyCount: Number.parseInt(payload?.key_count, 10),
    detectedModules: stringList(payload?.detected_modules),
    confidence: Number(payload?.confidence),
  };
}

function editDraftFromLora(lora) {
  return {
    name: lora.name || '',
    family: lora.family || '',
    trainedOnModelId: lora.trainedOnModelId || '',
    compatibleModels: [...lora.compatibleModels],
    triggerWordsText: lora.triggerWords.join(', '),
    defaultStrength: lora.defaultStrength == null ? '' : lora.defaultStrength.toFixed(2),
    description: lora.description || '',
    sourceUrl: lora.sourceUrl || '',
  };
}

function familyOptions(draft) {
  return uniqueStrings([
    draft.family,
    ...draft.modelOptions.map((model) => model.family),
    'flux2-klein',
    'z-image',
    'sdxl',
    'sd15',
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

function compatibleModelsForFamily(editSchema, family) {
  const models = editSchema?.compatibleModelsByFamily?.[String(family || '')];
  return Array.isArray(models) ? models : [];
}

function importWarningsMarkup(draft) {
  const facts = [
    draft.formatGuess ? `format: ${formatGuessLabel(draft.formatGuess)}` : '',
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

function buildRowsMarkup(
  loras,
  expandedLoras,
  editSchema,
  { deleteBusySlug = '', editBusySlug = '', editingLoraId = '', editDraft = null, editStatus = '', actionsDisabled = false } = {}
) {
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
        <div class="llm-pool-cell meta">-</div>
      </article>
    `;
  }

  return loras.map((lora, index) => {
    const isExpanded = expandedLoras.has(lora.id);
    const detailsId = `image-lora-library-details-${index}`;
    const mismatch = familyMismatch(lora);
    const actionButtons = [
      lora.editable && lora.updateSlug ? `
        <button
          type="button"
          class="image-lora-library-edit-button"
          data-lora-edit="${escapeAttr(lora.updateSlug)}"
          ${actionsDisabled || editBusySlug === lora.updateSlug ? ' disabled' : ''}
        >${editingLoraId === lora.id ? 'Editing' : 'Edit'}</button>
      ` : '',
      lora.deletable && lora.deleteSlug ? `
        <button
          type="button"
          class="image-lora-library-delete-button"
          data-lora-delete="${escapeAttr(lora.deleteSlug)}"
          ${actionsDisabled || deleteBusySlug === lora.deleteSlug || editingLoraId === lora.id ? ' disabled' : ''}
        >${deleteBusySlug === lora.deleteSlug ? 'Deleting...' : 'Delete'}</button>
      ` : '',
    ].filter(Boolean).join('');
    return `
    <article
      class="llm-pool-row image-lora-library-row is-expandable"
      data-lora-id="${escapeAttr(lora.id)}"
      aria-expanded="${String(isExpanded)}"
      aria-controls="${escapeAttr(detailsId)}"
    >
      <div class="llm-pool-cell model">
        <div class="llm-pool-model-name">${escapeHtml(lora.name || lora.id)}</div>
        <div class="image-lora-library-subline">${escapeHtml(lora.description || lora.id)}</div>
      </div>
      <div class="llm-pool-cell meta">
        <div>${escapeHtml(familyLabel(lora.family))}</div>
        ${mismatch ? `<div class="image-lora-library-subline image-lora-library-warning">detected ${escapeHtml(familyLabel(lora.inspection.familyGuess))}</div>` : ''}
      </div>
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
      <div class="llm-pool-cell meta image-lora-library-actions">
        ${actionButtons || '<span class="image-lora-library-muted">-</span>'}
      </div>
    </article>
    <article
      class="llm-pool-row-details image-lora-library-details${isExpanded ? ' is-open' : ''}"
      id="${escapeAttr(detailsId)}"
      ${isExpanded ? '' : 'hidden'}
    >
      ${buildLoraDetailsMarkup(
        lora,
        editSchema,
        editingLoraId === lora.id ? editDraft : null,
        editingLoraId === lora.id ? editStatus : '',
        editBusySlug === lora.updateSlug
      )}
    </article>
  `;
  }).join('');
}

function buildLoraDetailsMarkup(lora, editSchema, editDraft, editStatus, editBusy) {
  const inspection = lora.inspection || normalizeInspection(null);
  const mismatch = familyMismatch(lora);
  const metadataEntries = Object.entries(inspection.metadata || {})
    .map(([key, value]) => [String(key), String(value)])
    .sort(([left], [right]) => left.localeCompare(right, 'en'));
  const detailFields = [
    { label: 'ID', value: lora.id, code: true },
    { label: 'File', value: lora.displayPath || lora.path || '-', code: true },
    { label: 'Absolute path', value: lora.path || '-', code: true },
    { label: 'Size', value: formatBytes(lora.sizeBytes) },
    { label: 'Format guess', value: formatGuessLabel(inspection.formatGuess) },
    { label: 'Detected family', value: familyLabel(inspection.familyGuess) },
    { label: 'Configured family', value: familyLabel(lora.family) },
    { label: 'Compatibility note', value: mismatch ? `Configured as ${familyLabel(lora.family)}, detected as ${familyLabel(inspection.familyGuess)}` : '-' },
    { label: 'Confidence', value: formatConfidence(inspection.confidence) },
    { label: 'Tensor keys', value: Number.isFinite(inspection.keyCount) ? String(inspection.keyCount) : '-' },
    { label: 'Detected modules', value: inspection.detectedModules.join(', ') || '-' },
    { label: 'Components', value: formatCountMap(inspection.componentCounts) },
    { label: 'Targets', value: formatCountMap(inspection.targetCounts) },
    { label: 'Metadata triggers', value: inspection.triggerWords.join(', ') || '-' },
    { label: 'Configured triggers', value: lora.triggerWords.join(', ') || '-' },
    { label: 'Trained on', value: lora.trainedOnModelId || '-' },
    { label: 'Compatible models', value: lora.compatibleModels.join(', ') || '-' },
    { label: 'Default strength', value: formatStrength(lora.defaultStrength) },
    { label: 'Source URL', value: lora.sourceUrl || '-', code: Boolean(lora.sourceUrl) },
    { label: 'Run', value: lora.runId || '-' },
    { label: 'Dataset', value: lora.dataset || '-' },
    { label: 'Checkpoint', value: Number.isFinite(lora.checkpointStep) ? String(lora.checkpointStep) : '-' },
  ];

  return `
    <div class="llm-pool-definition-grid image-lora-library-detail-grid">
      ${detailFields.map((field) => buildDetailFieldMarkup(field)).join('')}
    </div>
    ${editDraft ? buildLoraEditMarkup(lora, editSchema, editDraft, editStatus, editBusy) : ''}
    <div class="image-lora-library-metadata">
      <div class="image-lora-library-metadata-title">Sample tensor keys</div>
      ${inspection.sampleKeys.length ? `
        <div class="image-lora-library-key-list">
          ${inspection.sampleKeys.map((key) => `<code>${escapeHtml(key)}</code>`).join('')}
        </div>
      ` : '<div class="image-lora-library-muted">No tensor keys available.</div>'}
    </div>
    <div class="image-lora-library-metadata">
      <div class="image-lora-library-metadata-title">Safetensors metadata</div>
      ${metadataEntries.length ? `
        <div class="image-lora-library-metadata-grid">
          ${metadataEntries.map(([key, value]) => `
            <div class="image-lora-library-metadata-key" title="${escapeAttr(key)}">${escapeHtml(key)}</div>
            <code>${escapeHtml(value)}</code>
          `).join('')}
        </div>
      ` : '<div class="image-lora-library-muted">No safetensors metadata found.</div>'}
    </div>
  `;
}

function buildLoraEditMarkup(lora, editSchema, draft, status, busy) {
  const familyOptions = uniqueStrings([draft.family, ...editSchema.families, lora.inspection.familyGuess]).filter(Boolean);
  const trainedOnOptions = uniqueStrings([draft.trainedOnModelId, ...editSchema.trainedOnModels, ...compatibleModelsForFamily(editSchema, draft.family)]).filter(Boolean);
  const compatibleModels = compatibleModelsForFamily(editSchema, draft.family);
  const canSave = Boolean(draft.name.trim() && draft.family.trim() && draft.compatibleModels.length && !busy);
  return `
    <div class="image-lora-edit-panel">
      <div class="image-lora-edit-head">
        <strong>Edit metadata</strong>
        <span class="translation-prompts-inline-status">${escapeHtml(status || '')}</span>
      </div>
      <div class="image-lora-import-grid image-lora-edit-grid">
        <label class="translation-prompts-field">
          <span>Name</span>
          <input data-edit-field="name" type="text" value="${escapeAttr(draft.name)}">
        </label>
        <label class="translation-prompts-field">
          <span>Family</span>
          <select data-edit-field="family">
            ${familyOptions.map((family) => `
              <option value="${escapeAttr(family)}"${family === draft.family ? ' selected' : ''}>${escapeHtml(familyLabel(family))}</option>
            `).join('')}
          </select>
        </label>
        <label class="translation-prompts-field">
          <span>Default strength</span>
          <input data-edit-field="defaultStrength" type="number" min="0" max="2" step="0.05" value="${escapeAttr(draft.defaultStrength)}">
        </label>
        <label class="translation-prompts-field">
          <span>Trigger words</span>
          <input data-edit-field="triggerWordsText" type="text" value="${escapeAttr(draft.triggerWordsText)}">
        </label>
        <label class="translation-prompts-field">
          <span>Source URL</span>
          <input data-edit-field="sourceUrl" type="url" value="${escapeAttr(draft.sourceUrl)}">
        </label>
        <label class="translation-prompts-field">
          <span>Trained on</span>
          <select data-edit-field="trainedOnModelId">
            <option value="">Unknown</option>
            ${trainedOnOptions.map((modelId) => `
              <option value="${escapeAttr(modelId)}"${modelId === draft.trainedOnModelId ? ' selected' : ''}>${escapeHtml(modelId)}</option>
            `).join('')}
          </select>
        </label>
        <label class="translation-prompts-field image-lora-import-description">
          <span>Description</span>
          <textarea data-edit-field="description" rows="3">${escapeHtml(draft.description)}</textarea>
        </label>
        <fieldset class="image-lora-import-compatible">
          <legend>Compatible models</legend>
          ${compatibleModels.length ? compatibleModels.map((modelId) => `
            <label class="image-lora-import-model-option">
              <input
                type="checkbox"
                data-edit-compatible-model="${escapeAttr(modelId)}"
                ${draft.compatibleModels.includes(modelId) ? 'checked' : ''}
              >
              <span>${escapeHtml(modelId)}</span>
            </label>
          `).join('') : '<span class="image-lora-library-muted">No compatible runtime models</span>'}
        </fieldset>
      </div>
      <div class="image-lora-edit-actions">
        <button type="button" data-edit-action="cancel"${busy ? ' disabled' : ''}>Cancel</button>
        <button type="button" data-edit-action="save"${canSave ? '' : ' disabled'}>${busy ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  `;
}

function buildDetailFieldMarkup(field) {
  const value = field.value == null || field.value === '' ? '-' : String(field.value);
  return `
    <div>
      <span>${escapeHtml(field.label)}</span>
      ${field.code ? `<code>${escapeHtml(value)}</code>` : `<strong>${escapeHtml(value)}</strong>`}
    </div>
  `;
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

function normalizeCountMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [String(key), Number.parseInt(count, 10)])
      .filter(([key, count]) => key && Number.isFinite(count) && count > 0)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
  );
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

function familyMismatch(lora) {
  const configured = String(lora?.family || '').trim();
  const detected = String(lora?.inspection?.familyGuess || '').trim();
  return Boolean(configured && detected && configured !== detected);
}

function formatGuessLabel(format) {
  const value = String(format || '').trim();
  return FORMAT_LABELS[value] || value || 'Unknown';
}

function artifactLabel(lora) {
  if (lora.sourceType === 'imported') return 'imported file';
  if (Number.isFinite(lora.checkpointStep)) return `checkpoint ${lora.checkpointStep}`;
  return lora.artifactType || '-';
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let size = value / 1024;
  for (const unit of units) {
    if (size < 1024 || unit === units[units.length - 1]) {
      return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
    }
    size /= 1024;
  }
  return `${value} B`;
}

function formatConfidence(value) {
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : '-';
}

function formatCountMap(value) {
  const entries = Object.entries(value || {});
  if (!entries.length) return '-';
  return entries.map(([key, count]) => `${key}: ${count}`).join(', ');
}

function formatStrength(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function formatClockTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function pruneExpandedLoras(expandedLoras, loras) {
  const known = new Set(loras.map((lora) => lora.id));
  [...expandedLoras].forEach((id) => {
    if (!known.has(id)) expandedLoras.delete(id);
  });
}
