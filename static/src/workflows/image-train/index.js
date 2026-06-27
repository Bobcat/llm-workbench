import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const DEFAULT_TRIGGER_WORD = 'GFX_IMPR5N';
const DEFAULT_CAPTION_SYSTEM_PROMPT = 'You write factual captions for image model training. A caption containing an invalid word fails the task.';
const SAMPLE_DATASET_SLUG = 'bfl-graphic-impressions';
const SELECTED_DATASET_STORAGE_KEY = 'llm-workbench.image-train.dataset';

export function createImageTrainView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view image-train-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <header class="image-train-topbar">
          <div class="image-train-actions">
            <select id="imageTrainDatasetSelect" class="image-train-dataset-select" aria-label="Dataset" disabled>
              <option value="">Loading datasets...</option>
            </select>
            <button type="button" id="imageTrainSyncFolderBtn" aria-label="Sync local folder">
              <span class="material-symbols-outlined" aria-hidden="true">drive_folder_upload</span>
              <span id="imageTrainSyncFolderLabel">Sync folder</span>
            </button>
            <button type="button" id="imageTrainDeleteDatasetBtn" class="image-train-danger-button" aria-label="Delete dataset">
              <span class="material-symbols-outlined" aria-hidden="true">delete</span>
              <span>Delete</span>
            </button>
            <button type="button" id="imageTrainRefreshBtn">
              <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
              <span>Refresh</span>
            </button>
            <button type="button" id="imageTrainDownloadBtn" class="image-train-sample-button" aria-label="Download sample dataset">
              <span class="material-symbols-outlined" aria-hidden="true">download</span>
              <span>Download sample</span>
            </button>
            <input id="imageTrainFolderInput" type="file" webkitdirectory directory multiple hidden>
          </div>
        </header>

        <div class="image-train-tabs" role="tablist" aria-label="Train workflow sections">
          <button
            type="button"
            class="image-train-tab"
            id="imageTrainDatasetTabBtn"
            data-image-train-tab="dataset"
            role="tab"
            aria-controls="imageTrainDatasetTab"
            aria-selected="true"
          >
            <span class="material-symbols-outlined" aria-hidden="true">dataset</span>
            <span>Dataset preparation</span>
          </button>
          <button
            type="button"
            class="image-train-tab"
            id="imageTrainTrainingTabBtn"
            data-image-train-tab="training"
            role="tab"
            aria-controls="imageTrainTrainingTab"
            aria-selected="false"
            tabindex="-1"
          >
            <span class="material-symbols-outlined" aria-hidden="true">model_training</span>
            <span>Training</span>
          </button>
        </div>

        <div class="translation-prompts-inline-status image-train-status" id="imageTrainStatus">Loading training workflow...</div>

        <section
          class="image-train-tab-panel is-active"
          id="imageTrainDatasetTab"
          data-image-train-panel="dataset"
          role="tabpanel"
          aria-labelledby="imageTrainDatasetTabBtn"
        >
          <div class="image-train-layout image-train-dataset-layout">
            <section class="image-train-panel image-train-dataset-panel">
              <div class="image-train-grid" id="imageTrainGrid"></div>
            </section>

            <section class="image-train-panel image-train-work-panel image-train-prep-panel">
              <div class="image-train-caption-controls">
                <label class="translation-prompts-field">
                  <span>LLM model</span>
                  <select id="imageTrainLlmModel" disabled>
                    <option value="">Loading models...</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Trigger word</span>
                  <input id="imageTrainTriggerWord" type="text" value="${escapeAttr(DEFAULT_TRIGGER_WORD)}">
                </label>
              </div>

              <details class="translation-prompts-system-details image-train-prompts-details">
                <summary>Caption prompts</summary>
                <label class="translation-prompts-field">
                  <span>System prompt</span>
                  <textarea id="imageTrainSystemPrompt" rows="3"></textarea>
                </label>
                <label class="translation-prompts-field">
                  <span>User prompt</span>
                  <textarea id="imageTrainPromptText" rows="6"></textarea>
                </label>
                <label class="translation-prompts-field">
                  <span>Decoding</span>
                  <textarea id="imageTrainPromptDecoding" rows="3" readonly></textarea>
                </label>
              </details>

              <div class="image-train-button-row">
                <button type="button" id="imageTrainCaptionSelectedBtn">
                  <span class="material-symbols-outlined" aria-hidden="true">subtitles</span>
                  <span>Caption selected</span>
                </button>
                <button type="button" id="imageTrainCaptionAllBtn">
                  <span class="material-symbols-outlined" aria-hidden="true">playlist_add_check</span>
                  <span>Caption all</span>
                </button>
              </div>

              <div class="image-train-selected" id="imageTrainSelected"></div>

              <label class="translation-prompts-field image-train-caption-field">
                <span>Caption</span>
                <textarea id="imageTrainCaptionText" rows="8" readonly></textarea>
              </label>
            </section>
          </div>
        </section>

        <section
          class="image-train-tab-panel"
          id="imageTrainTrainingTab"
          data-image-train-panel="training"
          role="tabpanel"
          aria-labelledby="imageTrainTrainingTabBtn"
          hidden
        >
          <section class="image-train-panel image-train-training-panel">
            <section class="image-train-run-panel">
              <div class="image-train-run-head">
                <div>
                  <h2>Image-pool training</h2>
                  <p id="imageTrainRunSubtitle">-</p>
                </div>
                <div class="image-train-run-actions">
                  <button type="button" id="imageTrainRunRefreshBtn">
                    <span class="material-symbols-outlined" aria-hidden="true">sync</span>
                    <span>Status</span>
                  </button>
                  <button type="button" id="imageTrainStartBtn">
                    <span class="material-symbols-outlined" aria-hidden="true">play_arrow</span>
                    <span>Start training</span>
                  </button>
                  <button type="button" id="imageTrainStopBtn">
                    <span class="material-symbols-outlined" aria-hidden="true">stop</span>
                    <span>Stop</span>
                  </button>
                </div>
              </div>
              <div class="image-train-training-controls">
                <label class="translation-prompts-field">
                  <span>Training model</span>
                  <select id="imageTrainTrainingModel">
                    <option value="">Loading training models...</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Steps</span>
                  <input id="imageTrainSteps" type="number" min="1" step="1" inputmode="numeric">
                </label>
                <label class="translation-prompts-field">
                  <span>Steps per checkpoint</span>
                  <input id="imageTrainCheckpointInterval" type="number" min="1" step="1" inputmode="numeric">
                </label>
              </div>
              <div class="image-train-run-summary" id="imageTrainRunSummary"></div>
            </section>

            <div class="image-train-training-grid">
              <details class="translation-prompts-system-details image-train-config-details" open>
                <summary>Training request</summary>
                <textarea id="imageTrainConfigText" rows="19" readonly></textarea>
              </details>

              <details class="translation-prompts-system-details image-train-log-details" open>
                <summary>Training log</summary>
                <textarea id="imageTrainLogText" rows="10" readonly></textarea>
              </details>
            </div>
          </section>
        </section>
      </div>
    </div>
  `;

  const gridEl = container.querySelector('#imageTrainGrid');
  const modelSelect = container.querySelector('#imageTrainLlmModel');
  const triggerWordEl = container.querySelector('#imageTrainTriggerWord');
  const systemPromptEl = container.querySelector('#imageTrainSystemPrompt');
  const captionPromptEl = container.querySelector('#imageTrainPromptText');
  const captionDecodingEl = container.querySelector('#imageTrainPromptDecoding');
  const statusEl = container.querySelector('#imageTrainStatus');
  const trainingModelSelect = container.querySelector('#imageTrainTrainingModel');
  const trainingStepsInput = container.querySelector('#imageTrainSteps');
  const checkpointIntervalInput = container.querySelector('#imageTrainCheckpointInterval');
  const runSubtitleEl = container.querySelector('#imageTrainRunSubtitle');
  const runSummaryEl = container.querySelector('#imageTrainRunSummary');
  const selectedEl = container.querySelector('#imageTrainSelected');
  const captionTextEl = container.querySelector('#imageTrainCaptionText');
  const configTextEl = container.querySelector('#imageTrainConfigText');
  const logTextEl = container.querySelector('#imageTrainLogText');
  const tabButtons = Array.from(container.querySelectorAll('[data-image-train-tab]'));
  const tabPanels = Array.from(container.querySelectorAll('[data-image-train-panel]'));
  const refreshBtn = container.querySelector('#imageTrainRefreshBtn');
  const downloadBtn = container.querySelector('#imageTrainDownloadBtn');
  const captionSelectedBtn = container.querySelector('#imageTrainCaptionSelectedBtn');
  const captionAllBtn = container.querySelector('#imageTrainCaptionAllBtn');
  const runRefreshBtn = container.querySelector('#imageTrainRunRefreshBtn');
  const startTrainingBtn = container.querySelector('#imageTrainStartBtn');
  const stopTrainingBtn = container.querySelector('#imageTrainStopBtn');
  const datasetSelect = container.querySelector('#imageTrainDatasetSelect');
  const syncFolderBtn = container.querySelector('#imageTrainSyncFolderBtn');
  const syncFolderLabel = container.querySelector('#imageTrainSyncFolderLabel');
  const deleteDatasetBtn = container.querySelector('#imageTrainDeleteDatasetBtn');
  const folderInput = container.querySelector('#imageTrainFolderInput');

  let datasets = [];
  let dataset = null;
  let trainingRun = null;
  let llmModels = [];
  let selectedDatasetSlug = window.localStorage.getItem(SELECTED_DATASET_STORAGE_KEY) || '';
  let selectedImageId = '01';
  let selectedModelId = '';
  let selectedTrainingModelId = '';
  let trainingSteps = 3000;
  let checkpointInterval = 500;
  let trainingParamsDirty = false;
  let statusMessage = '';
  let activeAction = '';
  let activeTab = 'dataset';
  let systemPromptDirty = false;
  let captionPromptDirty = false;
  const captioningImageIds = new Set();
  let loadToken = 0;
  let runLoadToken = 0;
  let runPollId = 0;

  function images() {
    return Array.isArray(dataset?.images) ? dataset.images : [];
  }

  function currentDatasetSlug() {
    return String(dataset?.slug || selectedDatasetSlug || '');
  }

  function selectedImage() {
    return images().find((image) => image.id === selectedImageId) || images()[0] || null;
  }

  function currentRun() {
    return trainingRun?.run && typeof trainingRun.run === 'object' ? trainingRun.run : {};
  }

  function isTrainingActive() {
    const status = String(currentRun().status || '').toLowerCase();
    return status === 'running' || status === 'stopping';
  }

  function currentTriggerWord() {
    return String(triggerWordEl.value || '').trim() || DEFAULT_TRIGGER_WORD;
  }

  function trainingModels() {
    if (Array.isArray(trainingRun?.training_models)) return trainingRun.training_models;
    if (Array.isArray(dataset?.training_models)) return dataset.training_models;
    return [];
  }

  function defaultTrainingModelId() {
    return String(trainingRun?.request?.model || dataset?.training_model || 'flux2-klein-base-4b');
  }

  function currentTrainingModelId() {
    const options = trainingModels();
    const selected = String(selectedTrainingModelId || '').trim();
    if (selected && (options.length === 0 || options.some((model) => model.id === selected))) {
      return selected;
    }
    const defaultModel = defaultTrainingModelId();
    if (options.length === 0 || options.some((model) => model.id === defaultModel)) {
      return defaultModel;
    }
    return String(options[0]?.id || '');
  }

  function currentTrainingModel() {
    const modelId = currentTrainingModelId();
    return trainingModels().find((model) => model.id === modelId) || null;
  }

  function currentTrainer() {
    return String(currentTrainingModel()?.trainer || 'flux') === 'z-image' ? 'z-image' : 'flux';
  }

  function defaultTrainingParams() {
    return currentTrainer() === 'z-image'
      ? { steps: 500, checkpointInterval: 500 }
      : { steps: 3000, checkpointInterval: 500 };
  }

  function resetTrainingParamsForModel() {
    const defaults = defaultTrainingParams();
    trainingSteps = defaults.steps;
    checkpointInterval = defaults.checkpointInterval;
  }

  function currentTrainingSteps() {
    return Math.max(1, Number.parseInt(trainingSteps, 10) || defaultTrainingParams().steps);
  }

  function currentCheckpointInterval() {
    return Math.max(1, Number.parseInt(checkpointInterval, 10) || defaultTrainingParams().checkpointInterval);
  }

  function render() {
    renderTabs();
    renderDatasetOptions();
    renderSyncFolderControl();
    renderDataset();
    renderModelOptions();
    renderTrainingModelOptions();
    renderTrainingParams();
    renderCaptionPrompts();
    renderSelectedImage();
    renderTrainingRun();
    renderConfig();
    updateButtons();
    statusEl.textContent = statusMessage || buildDefaultStatus();
    syncRunPolling();
  }

  function renderDatasetOptions() {
    const currentSlug = currentDatasetSlug();
    datasetSelect.innerHTML = `
        <option value="">New dataset from folder...</option>
        ${datasets.map((item) => `
        <option value="${escapeAttr(item.slug)}">${escapeHtml(formatDatasetOption(item))}</option>
      `).join('')}
      `;
    if (datasets.some((item) => item.slug === currentSlug)) {
      datasetSelect.value = currentSlug;
      selectedDatasetSlug = currentSlug;
    } else {
      datasetSelect.value = '';
    }
    datasetSelect.disabled = Boolean(activeAction) || isTrainingActive();
  }

  function renderSyncFolderControl() {
    const hasSelectedDataset = Boolean(currentDatasetSlug());
    syncFolderLabel.textContent = hasSelectedDataset ? 'Update dataset' : 'Import folder';
    syncFolderBtn.setAttribute(
      'aria-label',
      hasSelectedDataset
        ? 'Update selected dataset from a local folder'
        : 'Import local folder as a new dataset'
    );
    syncFolderBtn.title = hasSelectedDataset
      ? 'Choose a local folder to update this dataset. Matching filenames are overwritten; extra files already in the dataset stay there.'
      : 'Create a new dataset from a local folder.';
  }

  function renderTabs() {
    const currentTab = activeTab === 'training' ? 'training' : 'dataset';
    activeTab = currentTab;
    tabButtons.forEach((button) => {
      const selected = button.dataset.imageTrainTab === currentTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    tabPanels.forEach((panel) => {
      const selected = panel.dataset.imageTrainPanel === currentTab;
      panel.hidden = !selected;
      panel.classList.toggle('is-active', selected);
    });
  }

  function renderDataset() {
    if (!images().length) {
      gridEl.innerHTML = '<div class="image-train-empty">No dataset loaded.</div>';
      return;
    }

    gridEl.innerHTML = images().map((image) => {
      const selected = image.id === selectedImageId;
      const captioning = captioningImageIds.has(image.id);
      const classes = [
        'image-train-tile',
        selected ? 'is-selected' : '',
        image.downloaded ? 'is-downloaded' : '',
        image.captioned ? 'is-captioned' : '',
      ].filter(Boolean).join(' ');
      return `
        <button type="button" class="${classes}" data-image-id="${escapeAttr(image.id)}" aria-pressed="${String(selected)}">
          <img src="${escapeAttr(image.image_url)}" alt="${escapeAttr(image.label || image.filename)}" loading="lazy">
          <span class="image-train-tile-top">
            <span>${escapeHtml(image.id)}</span>
            ${captioning ? '<span class="image-train-spinner">Captioning</span>' : statusPill(image)}
          </span>
          <span class="image-train-tile-name">${escapeHtml(image.filename)}</span>
        </button>
      `;
    }).join('');
  }

  function renderModelOptions() {
    if (!selectedModelId && llmModels.length > 0) {
      selectedModelId = llmModels[0].id;
    }
    modelSelect.innerHTML = llmModels.length > 0
      ? llmModels.map((model) => `
        <option value="${escapeAttr(model.id)}">${escapeHtml(model.name || model.id)}</option>
      `).join('')
      : '<option value="">No loaded LLM models</option>';
    if (llmModels.some((model) => model.id === selectedModelId)) {
      modelSelect.value = selectedModelId;
    }
    modelSelect.disabled = llmModels.length === 0 || activeAction === 'caption-all';
  }

  function renderTrainingModelOptions() {
    const options = trainingModels();
    if (!selectedTrainingModelId) {
      selectedTrainingModelId = defaultTrainingModelId();
    }
    const selected = currentTrainingModelId();
    trainingModelSelect.innerHTML = options.length > 0
      ? options.map((model) => `
        <option value="${escapeAttr(model.id)}">${escapeHtml(formatTrainingModelOption(model))}</option>
      `).join('')
      : `<option value="${escapeAttr(selected)}">${escapeHtml(selected || 'No training models')}</option>`;
    if (selected) {
      trainingModelSelect.value = selected;
      selectedTrainingModelId = selected;
    }
    trainingModelSelect.disabled = options.length === 0 || Boolean(activeAction) || isTrainingActive();
  }

  function renderTrainingParams() {
    trainingStepsInput.value = String(currentTrainingSteps());
    checkpointIntervalInput.value = String(currentCheckpointInterval());
    const disabled = Boolean(activeAction) || isTrainingActive();
    trainingStepsInput.disabled = disabled;
    checkpointIntervalInput.disabled = disabled;
  }

  function renderSelectedImage() {
    const image = selectedImage();
    if (!image) {
      selectedEl.innerHTML = '<div class="image-train-empty">No image selected.</div>';
      captionTextEl.value = '';
      return;
    }

    selectedImageId = image.id;
    selectedEl.innerHTML = `
      <figure>
        <img src="${escapeAttr(image.image_url)}" alt="${escapeAttr(image.label || image.filename)}">
        <figcaption>
          <strong>${escapeHtml(image.filename)}</strong>
          <span>${escapeHtml(image.caption_path || '-')}</span>
        </figcaption>
      </figure>
    `;
    captionTextEl.value = image.caption || '';
  }

  function renderTrainingRun() {
    const trainer = trainingRun?.trainer || {};
    const readiness = trainingRun?.dataset || {};
    const run = currentRun();
    const status = String(run.status || 'idle');
    const trainerAvailable = Boolean(trainer.available);
    const ready = Boolean(readiness.ready);
    runSubtitleEl.textContent = trainer.message || 'Image-pool trainer status not loaded.';
    runSummaryEl.innerHTML = [
      runMetric('State', status),
      runMetric('Dataset', ready ? 'ready' : `${readiness.captioned_count || 0}/${readiness.image_count || 0} captioned`),
      runMetric('Trainer', trainerAvailable ? 'available' : 'unavailable'),
      runMetric('Run', run.run_id || '-'),
      runMetric('Model', currentTrainingModelId() || '-'),
      runMetric('Output', run.output_path || '-'),
    ].join('');
    logTextEl.value = String(run.log_tail || '');
  }

  function renderConfig() {
    const trainer = currentTrainer();
    const request = trainingRun?.request && typeof trainingRun.request === 'object' ? trainingRun.request : {};
    configTextEl.value = buildTrainingRequest({
      trainer,
      model: currentTrainingModelId(),
      datasetSlug: currentDatasetSlug(),
      datasetPath: dataset?.dataset_absolute_path || dataset?.dataset_path || '/path/to/graphic-impressions',
      outputPath: request.output_path || (trainer === 'z-image' ? 'data/image_pool/training/z-image/runs' : dataset?.runs_path || 'data/image_pool/training/flux2-klein/runs'),
      triggerWord: currentTriggerWord(),
      steps: currentTrainingSteps(),
      checkpointInterval: currentCheckpointInterval(),
    });
  }

  function renderCaptionPrompts() {
    if (!systemPromptDirty) {
      systemPromptEl.value = String(dataset?.caption_system_prompt || DEFAULT_CAPTION_SYSTEM_PROMPT);
    }
    if (!captionPromptDirty) {
      captionPromptEl.value = buildCaptionPrompt(currentTriggerWord());
    }
    captionDecodingEl.value = formatDecoding(dataset?.caption_decoding);
  }

  function currentCaptionPrompt() {
    return String(captionPromptEl.value || '').trim();
  }

  function currentSystemPrompt() {
    return String(systemPromptEl.value || '').trim() || DEFAULT_CAPTION_SYSTEM_PROMPT;
  }

  function updateButtons() {
    const hasDataset = images().length > 0;
    const hasModel = Boolean(selectedModelId);
    const trainingActive = isTrainingActive() || activeAction === 'start-training' || activeAction === 'stop-training';
    const datasetReady = Boolean(trainingRun?.dataset?.ready);
    const trainerAvailable = Boolean(trainingRun?.trainer?.available);
    const hasTrainingModel = Boolean(currentTrainingModelId());
    refreshBtn.disabled = Boolean(activeAction);
    datasetSelect.disabled = Boolean(activeAction) || trainingActive;
    syncFolderBtn.disabled = Boolean(activeAction) || trainingActive;
    deleteDatasetBtn.disabled = !currentDatasetSlug() || Boolean(activeAction) || trainingActive;
    downloadBtn.disabled = Boolean(activeAction) || trainingActive;
    captionSelectedBtn.disabled = !hasDataset || !hasModel || Boolean(activeAction) || trainingActive;
    captionAllBtn.disabled = !hasDataset || !hasModel || Boolean(activeAction) || trainingActive;
    runRefreshBtn.disabled = Boolean(activeAction);
    startTrainingBtn.disabled = !hasDataset || !datasetReady || !trainerAvailable || !hasTrainingModel || Boolean(activeAction) || trainingActive;
    stopTrainingBtn.disabled = !trainingActive || activeAction === 'stop-training';
    trainingModelSelect.disabled = trainingModels().length === 0 || Boolean(activeAction) || trainingActive;
    trainingStepsInput.disabled = Boolean(activeAction) || trainingActive;
    checkpointIntervalInput.disabled = Boolean(activeAction) || trainingActive;
    triggerWordEl.disabled = activeAction === 'caption-all' || captioningImageIds.size > 0 || trainingActive;
    systemPromptEl.disabled = activeAction === 'caption-all' || captioningImageIds.size > 0 || trainingActive;
    captionPromptEl.disabled = activeAction === 'caption-all' || captioningImageIds.size > 0 || trainingActive;
  }

  function runMetric(label, value) {
    return `
      <div class="image-train-run-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(String(value))}</strong>
      </div>
    `;
  }

  function statusPill(image) {
    if (image.captioned) return '<span class="image-train-pill is-captioned">caption</span>';
    if (image.downloaded) return '<span class="image-train-pill is-downloaded">local</span>';
    return '<span class="image-train-pill">missing</span>';
  }

  function buildDefaultStatus() {
    if (!dataset) return 'No dataset selected.';
    if (isTrainingActive()) return currentRun().message || 'Image-pool training is running.';
    if (llmModels.length === 0) return 'No loaded LLM models available for captioning.';
    const path = String(dataset.dataset_path || dataset.slug || 'Dataset');
    return `${path} - ${dataset.downloaded_count || 0}/${dataset.image_count || 0} images, ${dataset.captioned_count || 0} captioned, trigger ${currentTriggerWord()}.`;
  }

  function setStatus(message) {
    statusMessage = message;
    statusEl.textContent = message || buildDefaultStatus();
  }

  function mergeImage(nextImage) {
    if (!dataset || !nextImage?.id) return;
    dataset.images = images().map((image) => image.id === nextImage.id ? { ...image, ...nextImage } : image);
    dataset.downloaded_count = dataset.images.filter((image) => image.downloaded).length;
    dataset.captioned_count = dataset.images.filter((image) => image.captioned).length;
  }

  async function loadDatasets(options = {}) {
    if (!options.silent) setStatus('Loading datasets...');
    try {
      const payload = await api.getImageTrainingDatasets();
      if (!container.isConnected) return;
      datasets = Array.isArray(payload?.datasets)
        ? payload.datasets.map(normalizeDatasetSummary).filter((item) => item.slug)
        : [];
      if (!datasets.some((item) => item.slug === selectedDatasetSlug)) {
        selectedDatasetSlug = String(payload?.default_slug || datasets[0]?.slug || '');
      }
      if (selectedDatasetSlug) {
        window.localStorage.setItem(SELECTED_DATASET_STORAGE_KEY, selectedDatasetSlug);
      } else {
        window.localStorage.removeItem(SELECTED_DATASET_STORAGE_KEY);
      }
      if (!options.silent) setStatus('');
    } catch (err) {
      if (!container.isConnected) return;
      datasets = [];
      setStatus(`Failed to load datasets: ${formatApiError(err)}`);
    }
    render();
  }

  async function loadDataset(options = {}) {
    const token = ++loadToken;
    if (!selectedDatasetSlug) {
      dataset = null;
      selectedImageId = '01';
      if (!options.silent) setStatus('');
      render();
      return;
    }
    if (!options.silent) setStatus('Loading training dataset...');
    try {
      const payload = await api.getImageTrainingDataset(selectedDatasetSlug);
      if (!container.isConnected || token !== loadToken) return;
      dataset = payload && typeof payload === 'object' ? payload : null;
      selectedDatasetSlug = currentDatasetSlug();
      if (selectedDatasetSlug) {
        window.localStorage.setItem(SELECTED_DATASET_STORAGE_KEY, selectedDatasetSlug);
      } else {
        window.localStorage.removeItem(SELECTED_DATASET_STORAGE_KEY);
      }
      if (!images().some((image) => image.id === selectedImageId)) {
        selectedImageId = images()[0]?.id || '01';
      }
      if (!options.silent) setStatus('');
    } catch (err) {
      if (!container.isConnected || token !== loadToken) return;
      dataset = null;
      setStatus(`Failed to load dataset: ${formatApiError(err)}`);
    }
    render();
  }

  async function loadTrainingRun(options = {}) {
    const token = ++runLoadToken;
    const slug = currentDatasetSlug();
    if (!slug) {
      trainingRun = null;
      if (!options.silent) setStatus('');
      render();
      return;
    }
    try {
      const payload = await api.getImageTrainingRun(slug, currentTrainer());
      if (!container.isConnected || token !== runLoadToken) return;
      trainingRun = payload && typeof payload === 'object' ? payload : null;
      if (!trainingParamsDirty) {
        const request = trainingRun?.request && typeof trainingRun.request === 'object' ? trainingRun.request : {};
        trainingSteps = Number.parseInt(request.steps, 10) || defaultTrainingParams().steps;
        checkpointInterval = Number.parseInt(request.checkpoint_interval, 10) || defaultTrainingParams().checkpointInterval;
      }
      if (!options.silent) setStatus('');
    } catch (err) {
      if (!container.isConnected || token !== runLoadToken) return;
      trainingRun = null;
      if (!options.silent) setStatus(`Failed to load training status: ${formatApiError(err)}`);
    }
    render();
  }

  async function loadLlmModels() {
    try {
      const payload = await api.getModels();
      if (!container.isConnected) return;
      llmModels = Array.isArray(payload)
        ? payload.map((model) => ({
          id: String(model?.id || model?.name || ''),
          name: String(model?.name || model?.id || ''),
        })).filter((model) => model.id)
        : [];
      if (!llmModels.some((model) => model.id === selectedModelId)) {
        selectedModelId = llmModels[0]?.id || '';
      }
    } catch (err) {
      if (!container.isConnected) return;
      llmModels = [];
      selectedModelId = '';
      setStatus(`Failed to load LLM models: ${formatApiError(err)}`);
    }
    render();
  }

  async function startTraining() {
    if (activeAction) return;
    activeAction = 'start-training';
    setStatus('Starting image-pool training...');
    render();
    try {
      const payload = await api.startImageTrainingRun(currentDatasetSlug(), {
        trainer: currentTrainer(),
        model: currentTrainingModelId(),
        trigger_word: currentTriggerWord(),
        steps: currentTrainingSteps(),
        checkpoint_interval: currentCheckpointInterval(),
      });
      trainingRun = payload && typeof payload === 'object' ? payload : trainingRun;
      setStatus(currentRun().message || 'Image-pool training started.');
    } catch (err) {
      setStatus(`Training start failed: ${formatApiError(err)}`);
    } finally {
      activeAction = '';
      await loadTrainingRun({ silent: true });
      render();
    }
  }

  async function stopTraining() {
    if (activeAction) return;
    activeAction = 'stop-training';
    setStatus('Stopping image-pool training...');
    render();
    try {
      const payload = await api.stopImageTrainingRun(currentDatasetSlug(), currentTrainer());
      trainingRun = payload && typeof payload === 'object' ? payload : trainingRun;
      setStatus(currentRun().message || 'Stop requested.');
    } catch (err) {
      setStatus(`Training stop failed: ${formatApiError(err)}`);
    } finally {
      activeAction = '';
      render();
    }
  }

  async function downloadDataset() {
    if (activeAction) return;
    activeAction = 'download';
    selectedDatasetSlug = SAMPLE_DATASET_SLUG;
    setStatus('Downloading sample dataset...');
    render();
    try {
      const payload = await api.downloadImageTrainingSampleDataset(SAMPLE_DATASET_SLUG);
      dataset = payload && typeof payload === 'object' ? payload : dataset;
      await loadDatasets({ silent: true });
      setStatus(`Downloaded ${payload.downloaded_now || 0} image(s), ${payload.existing || 0} already local.`);
    } catch (err) {
      setStatus(`Download failed: ${formatApiError(err)}`);
    } finally {
      activeAction = '';
      render();
    }
  }

  async function captionImage(imageId, options = {}) {
    if (!selectedModelId) {
      setStatus('No LLM model selected.');
      return false;
    }
    captioningImageIds.add(imageId);
    if (!options.batch) setStatus(`Captioning image ${imageId}...`);
    render();
    try {
      const payload = await api.captionImageTrainingImage(currentDatasetSlug(), {
        model: selectedModelId,
        image_id: imageId,
        trigger_word: currentTriggerWord(),
        caption_prompt: currentCaptionPrompt(),
        system_prompt: currentSystemPrompt(),
        overwrite: true,
      });
      mergeImage(payload?.image);
      if (!options.batch) setStatus('');
      return true;
    } catch (err) {
      setStatus(`Caption failed for ${imageId}: ${formatApiError(err)}`);
      return false;
    } finally {
      captioningImageIds.delete(imageId);
      render();
    }
  }

  async function captionSelectedImage() {
    const image = selectedImage();
    if (!image || activeAction) return;
    await captionImage(image.id);
  }

  async function captionAllImages() {
    if (activeAction) return;
    activeAction = 'caption-all';
    let completed = 0;
    const queue = images().map((image) => image.id);
    for (const imageId of queue) {
      if (!container.isConnected) break;
      setStatus(`Captioning ${completed + 1}/${queue.length}...`);
      if (await captionImage(imageId, { batch: true })) {
        completed += 1;
      }
    }
    activeAction = '';
    await loadDataset({ silent: true });
    await loadTrainingRun({ silent: true });
    setStatus('');
  }

  async function createDatasetFromPrompt(defaultName = '') {
    if (activeAction) return null;
    const name = window.prompt('Dataset name', defaultName || 'my-training-dataset');
    if (!name || !String(name).trim()) return null;
    activeAction = 'create-dataset';
    setStatus('Creating dataset...');
    render();
    try {
      const payload = await api.createImageTrainingDataset({
        name: String(name).trim(),
        trigger_word: currentTriggerWord(),
      });
      const created = payload?.dataset && typeof payload.dataset === 'object' ? payload.dataset : null;
      datasets = Array.isArray(payload?.datasets)
        ? payload.datasets.map(normalizeDatasetSummary).filter((item) => item.slug)
        : datasets;
      if (created?.slug) {
        selectedDatasetSlug = String(created.slug);
        dataset = created;
        selectedImageId = images()[0]?.id || '01';
        window.localStorage.setItem(SELECTED_DATASET_STORAGE_KEY, selectedDatasetSlug);
      }
      setStatus(created?.slug ? `Created dataset ${created.title || created.slug}.` : 'Dataset created.');
      return created;
    } catch (err) {
      setStatus(`Create dataset failed: ${formatApiError(err)}`);
      return null;
    } finally {
      activeAction = '';
      render();
    }
  }

  async function syncLocalFolder(fileList) {
    const files = Array.from(fileList || []);
    if (activeAction || files.length === 0) return;
    let targetSlug = currentDatasetSlug();
    if (!targetSlug) {
      const created = await createDatasetFromPrompt(inferFolderName(files));
      if (!created?.slug) return;
      targetSlug = String(created.slug);
    } else {
      const targetTitle = String(dataset?.title || targetSlug);
      if (!window.confirm(
        `Sync selected folder into dataset "${targetTitle}"?\n\n` +
        'Files with the same name are overwritten. Extra files already in the dataset stay there.'
      )) {
        return;
      }
    }
    activeAction = 'sync-folder';
    setStatus(`Syncing ${files.length} file(s)...`);
    render();
    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file, file.webkitRelativePath || file.name);
      });
      const payload = await api.uploadImageTrainingDatasetFiles(targetSlug, formData);
      selectedDatasetSlug = targetSlug;
      dataset = payload && typeof payload === 'object' ? payload : dataset;
      selectedImageId = images()[0]?.id || '01';
      window.localStorage.setItem(SELECTED_DATASET_STORAGE_KEY, selectedDatasetSlug);
      await loadDatasets({ silent: true });
      await loadTrainingRun({ silent: true });
      setStatus(`Synced ${payload.imported || 0} new, ${payload.updated || 0} updated, ${payload.skipped || 0} unchanged.`);
    } catch (err) {
      setStatus(`Folder sync failed: ${formatApiError(err)}`);
    } finally {
      activeAction = '';
      render();
    }
  }

  async function deleteSelectedDataset() {
    if (activeAction) return;
    const slug = currentDatasetSlug();
    if (!slug) {
      setStatus('No dataset selected.');
      return;
    }
    const title = String(dataset?.title || slug);
    if (!window.confirm(`Delete dataset "${title}" and its local images/captions?`)) return;

    activeAction = 'delete-dataset';
    setStatus('Deleting dataset...');
    render();
    try {
      const payload = await api.deleteImageTrainingDataset(slug);
      datasets = Array.isArray(payload?.datasets)
        ? payload.datasets.map(normalizeDatasetSummary).filter((item) => item.slug)
        : [];
      selectedDatasetSlug = String(payload?.default_slug || datasets[0]?.slug || '');
      selectedImageId = '01';
      systemPromptDirty = false;
      captionPromptDirty = false;
      if (selectedDatasetSlug) {
        window.localStorage.setItem(SELECTED_DATASET_STORAGE_KEY, selectedDatasetSlug);
        await loadDataset({ silent: true });
        await loadTrainingRun({ silent: true });
      } else {
        window.localStorage.removeItem(SELECTED_DATASET_STORAGE_KEY);
        dataset = null;
        trainingRun = null;
      }
      setStatus(`Deleted dataset ${title}.`);
    } catch (err) {
      setStatus(`Delete dataset failed: ${formatApiError(err)}`);
    } finally {
      activeAction = '';
      render();
    }
  }

  async function refreshWorkflow() {
    await loadDatasets();
    await loadDataset();
    await loadLlmModels();
    await loadTrainingRun();
  }

  function syncRunPolling() {
    const shouldPoll = container.isConnected && isTrainingActive();
    if (shouldPoll && !runPollId) {
      runPollId = window.setInterval(() => {
        if (!container.isConnected) {
          syncRunPolling();
          return;
        }
        loadTrainingRun({ silent: true });
      }, 3000);
    }
    if (!shouldPoll && runPollId) {
      window.clearInterval(runPollId);
      runPollId = 0;
    }
  }

  refreshBtn.addEventListener('click', () => {
    refreshWorkflow();
  });
  datasetSelect.addEventListener('change', async () => {
    selectedDatasetSlug = String(datasetSelect.value || '');
    if (selectedDatasetSlug) {
      window.localStorage.setItem(SELECTED_DATASET_STORAGE_KEY, selectedDatasetSlug);
    } else {
      window.localStorage.removeItem(SELECTED_DATASET_STORAGE_KEY);
    }
    selectedImageId = '01';
    systemPromptDirty = false;
    captionPromptDirty = false;
    await loadDataset();
    await loadTrainingRun();
  });
  syncFolderBtn.addEventListener('click', () => {
    folderInput.value = '';
    folderInput.click();
  });
  deleteDatasetBtn.addEventListener('click', deleteSelectedDataset);
  folderInput.addEventListener('change', () => {
    syncLocalFolder(folderInput.files);
  });
  downloadBtn.addEventListener('click', downloadDataset);
  captionSelectedBtn.addEventListener('click', captionSelectedImage);
  captionAllBtn.addEventListener('click', captionAllImages);
  runRefreshBtn.addEventListener('click', () => loadTrainingRun());
  startTrainingBtn.addEventListener('click', startTraining);
  stopTrainingBtn.addEventListener('click', stopTraining);
  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.imageTrainTab || 'dataset';
      renderTabs();
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const nextButton = tabButtons[(index + direction + tabButtons.length) % tabButtons.length];
      nextButton.click();
      nextButton.focus();
    });
  });
  modelSelect.addEventListener('change', () => {
    selectedModelId = String(modelSelect.value || '');
    render();
  });
  trainingModelSelect.addEventListener('change', async () => {
    selectedTrainingModelId = String(trainingModelSelect.value || '');
    trainingParamsDirty = false;
    resetTrainingParamsForModel();
    await loadTrainingRun({ silent: true });
    render();
  });
  trainingStepsInput.addEventListener('input', () => {
    trainingParamsDirty = true;
    trainingSteps = Math.max(1, Number.parseInt(trainingStepsInput.value, 10) || defaultTrainingParams().steps);
    renderConfig();
  });
  checkpointIntervalInput.addEventListener('input', () => {
    trainingParamsDirty = true;
    checkpointInterval = Math.max(1, Number.parseInt(checkpointIntervalInput.value, 10) || defaultTrainingParams().checkpointInterval);
    renderConfig();
  });
  triggerWordEl.addEventListener('input', () => {
    renderDataset();
    renderCaptionPrompts();
    renderConfig();
  });
  systemPromptEl.addEventListener('input', () => {
    systemPromptDirty = true;
  });
  captionPromptEl.addEventListener('input', () => {
    captionPromptDirty = true;
  });

  gridEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-image-id]');
    if (!button || !gridEl.contains(button)) return;
    selectedImageId = String(button.dataset.imageId || selectedImageId);
    render();
  });

  render();
  container.__onActivate = () => {
    refreshWorkflow();
  };
  return container;
}

function buildCaptionPrompt(triggerWord) {
  return [
    'Caption the image for a style LoRA dataset. Describe what is depicted, not how it is rendered.',
    `Begin exactly: ${triggerWord}.`,
    'Use 2 or 3 complete sentences, 50 to 85 words total.',
    'Describe camera distance, viewing angle, subject orientation, pose or action, important body parts or objects, frame placement, and real physical ground or setting.',
    'Omit style and rendering details, including colors, lighting, shadows, texture, brushwork, linework, graphic marks, speckles, particles, fragments, streaks, rays, decorative effects, mood, and background color.',
    'Never describe floating, suspended, scattered, abstract, or decorative background elements. If the background has no real place or objects, write against an open background.',
    'The words dark, black, red, white, blue, purple, textured, texture, fragments, particles, streaks, rays, glow, and shadow make the caption invalid.',
    'Use neutral object nouns instead: ground surface, shirt, pants, bridge, flowers, tunnel, open background.',
    'Before returning, check the caption and rewrite it if any invalid word appears.',
    'Return only the caption.',
  ].join('\n');
}

function formatDecoding(decoding) {
  const values = decoding && typeof decoding === 'object' ? decoding : {};
  return [
    `max_tokens: ${values.max_tokens ?? 700}`,
    `temperature: ${values.temperature ?? 0}`,
    `top_p: ${values.top_p ?? 0.95}`,
  ].join('\n');
}

function buildTrainingRequest({ trainer, model, datasetSlug, datasetPath, outputPath, triggerWord, steps, checkpointInterval }) {
  const zImage = trainer === 'z-image';
  return JSON.stringify({
    trainer,
    model,
    dataset_path: datasetPath,
    output_path: outputPath,
    trigger_word: triggerWord,
    steps,
    checkpoint_interval: checkpointInterval,
    learning_rate: zImage ? 0.0001 : 0.000095,
    rank: zImage ? 4 : 128,
    alpha: zImage ? 4 : 64,
    batch_size: 1,
    resolution: zImage ? 1024 : [256, 512, 768, 1024, 1280, 1536],
    metadata: { dataset: datasetSlug, trainer },
  }, null, 2);
}

function normalizeDatasetSummary(item) {
  return {
    slug: String(item?.slug || ''),
    title: String(item?.title || item?.slug || ''),
    source: String(item?.source || ''),
    imageCount: Number(item?.image_count || 0),
    captionedCount: Number(item?.captioned_count || 0),
  };
}

function formatDatasetOption(item) {
  const title = item.title || item.slug;
  const suffix = item.imageCount > 0 ? ` (${item.captionedCount}/${item.imageCount})` : '';
  return `${title}${suffix}`;
}

function inferFolderName(files) {
  const first = files.find((file) => file?.webkitRelativePath) || files[0];
  const relativePath = String(first?.webkitRelativePath || first?.name || '').trim();
  const folder = relativePath.includes('/') ? relativePath.split('/')[0] : '';
  return folder || 'my-training-dataset';
}

function formatTrainingModelOption(model) {
  const labels = [];
  if (model.trainer === 'z-image') labels.push('z-image');
  if (model.base) labels.push('base');
  if (model.loaded) labels.push('loaded');
  if (model.ready === false) labels.push('missing path');
  const suffix = labels.length ? ` (${labels.join(', ')})` : '';
  return `${model.name || model.id}${suffix}`;
}
