import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const DEFAULT_PARAMETER_LABELS = {
  size: 'Output size',
  n: 'Videos',
  duration_seconds: 'Duration',
  fps: 'FPS',
  num_frames: 'Frames',
  steps: 'Steps',
  guidance: 'Guidance',
  guidance_2: 'guidance_scale_2',
  negative_prompt: 'negative_prompt',
  max_sequence_length: 'max_sequence_length',
  use_prompt_enhancer: 'use_prompt_enhancer',
  lora_name: 'lora_name',
  lora_strength: 'lora_strength',
  seed: 'Seed',
  quality: 'Quality',
};

export function createVideoGenerationView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view image-generation-view video-generation-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <label class="translation-prompts-field">
              <span>Model</span>
              <select id="videoGenerationModelSelect" disabled>
                <option value="">Loading video models...</option>
              </select>
            </label>
            <details class="translation-prompts-system-details image-generation-parameters-details">
              <summary id="videoGenerationParametersSummary">Generation parameters</summary>
              <div class="translation-prompts-language-grid image-generation-params-grid">
                <label class="translation-prompts-field">
                  <span data-parameter-label="size">Output size</span>
                  <select id="videoGenerationSize"></select>
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="n">Videos</span>
                  <input id="videoGenerationCount" type="number" min="1" max="4" step="1" value="1">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="duration_seconds">Duration</span>
                  <input id="videoGenerationDuration" type="number" min="0.5" max="60" step="0.5" value="5">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="fps">FPS</span>
                  <input id="videoGenerationFps" type="number" min="1" max="60" step="1" value="16">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="num_frames">Frames</span>
                  <input id="videoGenerationFrames" type="number" min="1" max="600" step="1" placeholder="Auto">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="steps">Steps</span>
                  <input id="videoGenerationSteps" type="number" min="1" max="80" step="1" value="4">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="guidance">Guidance</span>
                  <input id="videoGenerationGuidance" type="number" min="0" max="20" step="0.1" value="1">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="guidance_2">guidance_scale_2</span>
                  <input id="videoGenerationGuidance2" type="number" min="0" max="20" step="0.1" placeholder="Default">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="max_sequence_length">max_sequence_length</span>
                  <input id="videoGenerationMaxSequenceLength" type="number" min="64" max="1024" step="64" value="512">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="use_prompt_enhancer">use_prompt_enhancer</span>
                  <select id="videoGenerationUsePromptEnhancer">
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="seed">Seed</span>
                  <input id="videoGenerationSeed" type="number" step="1" placeholder="Random">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="negative_prompt">negative_prompt</span>
                  <input id="videoGenerationNegativePrompt" type="text" autocomplete="off" spellcheck="false">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="lora_name">lora_name</span>
                  <input id="videoGenerationLoraName" type="text" autocomplete="off" spellcheck="false" placeholder="None">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="lora_strength">lora_strength</span>
                  <input id="videoGenerationLoraStrength" type="number" min="0" max="3" step="0.05" placeholder="Default">
                </label>
                <label class="translation-prompts-field video-generation-quality-field" hidden>
                  <span data-parameter-label="quality">Quality</span>
                  <select id="videoGenerationQuality">
                    <option value="auto">Auto</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
              </div>
              <div class="image-generation-parameter-actions">
                <button type="button" id="videoGenerationResetDefaultsBtn">Reset to defaults</button>
              </div>
            </details>
            <label class="translation-prompts-field">
              <span>Prompt</span>
              <textarea id="videoGenerationPrompt" rows="5" placeholder="<Video prompt or image-to-video instruction>"></textarea>
            </label>
            <div class="translation-prompts-run-actions">
              <button type="button" id="videoGenerationRunBtn" disabled>Run</button>
              <button type="button" id="videoGenerationAddImageBtn">Add image</button>
              <input id="videoGenerationFileInput" type="file" accept="image/*" hidden>
            </div>
            <div class="translation-prompts-inline-status" id="videoGenerationStatus">Loading video-pool models...</div>
            <div class="image-generation-reference-strip" id="videoGenerationReferences"></div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <div class="image-generation-output-shell">
              <section class="image-generation-output" id="videoGenerationOutput" aria-label="Output">
                <span class="image-generation-output-empty">No video generated.</span>
              </section>
              <label class="image-generation-output-zoom" aria-label="Output preview size">
                <input id="videoGenerationOutputZoom" type="range" min="25" max="200" step="5" value="100">
                <output id="videoGenerationOutputZoomValue">100%</output>
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  const modelSelect = container.querySelector('#videoGenerationModelSelect');
  const promptEl = container.querySelector('#videoGenerationPrompt');
  const parametersSummaryEl = container.querySelector('#videoGenerationParametersSummary');
  const parameterLabelEls = Object.fromEntries(
    Array.from(container.querySelectorAll('[data-parameter-label]')).map((element) => [
      String(element.dataset.parameterLabel || ''),
      element,
    ])
  );
  const sizeEl = container.querySelector('#videoGenerationSize');
  const countEl = container.querySelector('#videoGenerationCount');
  const durationEl = container.querySelector('#videoGenerationDuration');
  const fpsEl = container.querySelector('#videoGenerationFps');
  const framesEl = container.querySelector('#videoGenerationFrames');
  const stepsEl = container.querySelector('#videoGenerationSteps');
  const guidanceEl = container.querySelector('#videoGenerationGuidance');
  const guidance2El = container.querySelector('#videoGenerationGuidance2');
  const maxSequenceLengthEl = container.querySelector('#videoGenerationMaxSequenceLength');
  const usePromptEnhancerEl = container.querySelector('#videoGenerationUsePromptEnhancer');
  const seedEl = container.querySelector('#videoGenerationSeed');
  const negativePromptEl = container.querySelector('#videoGenerationNegativePrompt');
  const loraNameEl = container.querySelector('#videoGenerationLoraName');
  const loraStrengthEl = container.querySelector('#videoGenerationLoraStrength');
  const qualityField = container.querySelector('.video-generation-quality-field');
  const qualityEl = container.querySelector('#videoGenerationQuality');
  const outputZoomEl = container.querySelector('#videoGenerationOutputZoom');
  const outputZoomValueEl = container.querySelector('#videoGenerationOutputZoomValue');
  const resetDefaultsBtn = container.querySelector('#videoGenerationResetDefaultsBtn');
  const runBtn = container.querySelector('#videoGenerationRunBtn');
  const addImageBtn = container.querySelector('#videoGenerationAddImageBtn');
  const fileInput = container.querySelector('#videoGenerationFileInput');
  const referencesEl = container.querySelector('#videoGenerationReferences');
  const outputEl = container.querySelector('#videoGenerationOutput');
  const statusEl = container.querySelector('#videoGenerationStatus');

  let references = [];
  let models = [];
  let isRunning = false;
  let loadToken = 0;

  function selectedModelId() {
    return String(modelSelect.value || '').trim();
  }

  function selectableModels() {
    const realModels = models.filter((model) => model.backend !== 'stub');
    return realModels.length > 0 ? realModels : models;
  }

  function selectedModel() {
    const modelId = selectedModelId();
    return selectableModels().find((model) => model.id === modelId) || null;
  }

  function activeOperation() {
    return references.length > 0 ? 'image_to_video' : 'text_to_video';
  }

  function activeParameterSchema() {
    const model = selectedModel();
    if (!model) return {};
    const schema = activeOperation() === 'image_to_video'
      ? model.imageToVideoParameters
      : model.generationParameters;
    return schema && typeof schema === 'object' ? schema : {};
  }

  function modelSupportsTextToVideo(model) {
    const tasks = modelTasks(model);
    return tasks.length === 0 || tasks.includes('text_to_video') || tasks.includes('video_generation');
  }

  function modelSupportsImageToVideo(model) {
    const tasks = modelTasks(model);
    const inputModalities = Array.isArray(model?.capabilities?.input_modalities)
      ? model.capabilities.input_modalities.map((item) => String(item))
      : [];
    return inputModalities.includes('image') && tasks.includes('image_to_video');
  }

  function modelTasks(model) {
    const tasks = Array.isArray(model?.capabilities?.tasks)
      ? model.capabilities.tasks.map((item) => String(item))
      : [];
    return tasks;
  }

  function modelMaxInputImages(model) {
    const parsed = Number.parseInt(model?.capabilities?.max_images, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
  }

  function modelMaxOutputVideos(model) {
    const parsed = Number.parseInt(model?.capabilities?.max_output_videos, 10);
    return Number.isFinite(parsed) ? Math.max(1, parsed) : 4;
  }

  function applySelectedModelDefaults() {
    applyParameterSchema({ reset: true });
  }

  function applyParameterSchema({ reset = false } = {}) {
    const model = selectedModel();
    const schema = activeParameterSchema();
    parametersSummaryEl.textContent = 'Generation parameters';

    applyParameterLabels(schema);
    configureEnumControl(sizeEl, schema.size, { reset, fallbackValues: ['832x480'] });
    configureIntegerControl(countEl, schema.n, { reset, fallback: 1, hardMin: 1, hardMax: modelMaxOutputVideos(model) });
    configureNumberControl(durationEl, schema.duration_seconds, { reset, fallback: 5, hardMin: 0.5, hardMax: 60 });
    configureIntegerControl(fpsEl, schema.fps, { reset, fallback: 16, hardMin: 1, hardMax: 60 });
    configureOptionalIntegerControl(framesEl, schema.num_frames, { reset, hardMin: 1, hardMax: 600 });
    configureIntegerControl(stepsEl, schema.steps, { reset, fallback: model?.recommendedSteps || 4, hardMin: 1, hardMax: 80 });
    configureNumberControl(guidanceEl, schema.guidance, { reset, fallback: model?.recommendedGuidance ?? 1, hardMin: 0, hardMax: 20 });
    configureOptionalNumberControl(guidance2El, schema.guidance_2, { reset, hardMin: 0, hardMax: 20 });
    configureIntegerControl(maxSequenceLengthEl, schema.max_sequence_length, { reset, fallback: 512, hardMin: 64, hardMax: 1024 });
    configureBooleanControl(usePromptEnhancerEl, schema.use_prompt_enhancer, { reset });
    configureOptionalIntegerControl(seedEl, schema.seed, { reset, hardMin: 0, hardMax: Number.MAX_SAFE_INTEGER });
    configureStringControl(negativePromptEl, schema.negative_prompt, { reset });
    configureStringControl(loraNameEl, schema.lora_name, { reset });
    configureOptionalNumberControl(loraStrengthEl, schema.lora_strength, { reset, hardMin: 0, hardMax: 3 });
    configureEnumControl(qualityEl, schema.quality, {
      reset,
      fallbackValues: ['auto', 'low', 'medium', 'high'],
      hiddenField: qualityField,
    });
  }

  function applyParameterLabels(schema) {
    Object.entries(DEFAULT_PARAMETER_LABELS).forEach(([name, fallback]) => {
      const element = parameterLabelEls[name];
      if (element) {
        element.textContent = parameterLabel(schema[name], fallback);
      }
    });
  }

  function configureEnumControl(select, definition, { reset, fallbackValues, hiddenField = null }) {
    if (hiddenField) {
      hiddenField.hidden = !definition;
    }
    if (!definition && hiddenField) {
      return;
    }

    const values = enumValues(definition);
    const selectableValues = values.length > 0 ? values : fallbackValues;
    const defaultValue = enumDefault(definition, selectableValues);
    const previousValue = String(select.value || '');
    select.innerHTML = selectableValues
      .map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(formatEnumOption(definition, value))}</option>`)
      .join('');
    if (reset) {
      select.value = defaultValue;
    } else if (selectableValues.includes(previousValue)) {
      select.value = previousValue;
    } else {
      select.value = defaultValue;
    }
  }

  function configureIntegerControl(input, definition, { reset, fallback, hardMin, hardMax }) {
    const min = parameterNumber(definition?.minimum, hardMin);
    const max = parameterNumber(definition?.maximum, hardMax);
    const defaultValue = parameterNumber(definition?.default, fallback);
    input.min = String(min);
    input.max = String(max);
    input.step = String(parameterNumber(definition?.step, 1));
    input.hidden = !definition;
    input.closest('label').hidden = !definition;
    const nextValue = reset ? defaultValue : input.value;
    input.value = String(clampInt(nextValue, min, max, defaultValue));
  }

  function configureOptionalIntegerControl(input, definition, { reset, hardMin, hardMax }) {
    const min = parameterNumber(definition?.minimum, hardMin);
    const max = parameterNumber(definition?.maximum, hardMax);
    input.min = String(min);
    input.max = String(max);
    input.step = String(parameterNumber(definition?.step, 1));
    input.hidden = !definition;
    input.closest('label').hidden = !definition;
    if (reset) {
      const defaultValue = definition?.default;
      input.value = defaultValue == null ? '' : String(clampInt(defaultValue, min, max, min));
    }
  }

  function configureNumberControl(input, definition, { reset, fallback, hardMin, hardMax }) {
    const min = parameterNumber(definition?.minimum, hardMin);
    const max = parameterNumber(definition?.maximum, hardMax);
    const defaultValue = parameterNumber(definition?.default, fallback);
    input.min = String(min);
    input.max = String(max);
    input.step = String(parameterNumber(definition?.step, 0.1));
    input.hidden = !definition;
    input.closest('label').hidden = !definition;
    const nextValue = reset ? defaultValue : input.value;
    input.value = String(clampNumber(nextValue, min, max, defaultValue));
  }

  function configureOptionalNumberControl(input, definition, { reset, hardMin, hardMax }) {
    const min = parameterNumber(definition?.minimum, hardMin);
    const max = parameterNumber(definition?.maximum, hardMax);
    input.min = String(min);
    input.max = String(max);
    input.step = String(parameterNumber(definition?.step, 0.1));
    input.hidden = !definition;
    input.closest('label').hidden = !definition;
    if (reset) {
      const defaultValue = definition?.default;
      input.value = defaultValue == null ? '' : String(clampNumber(defaultValue, min, max, min));
    }
  }

  function configureBooleanControl(select, definition, { reset }) {
    select.hidden = !definition;
    select.closest('label').hidden = !definition;
    if (reset) {
      select.value = definition?.default === true ? 'true' : 'false';
    }
  }

  function configureStringControl(input, definition, { reset }) {
    input.hidden = !definition;
    input.closest('label').hidden = !definition;
    if (reset) {
      input.value = definition?.default == null ? '' : String(definition.default);
    }
  }

  function renderModelOptions() {
    const options = selectableModels();
    const previous = selectedModelId();
    if (!options.length) {
      modelSelect.innerHTML = '<option value="">No loaded video models</option>';
      modelSelect.disabled = true;
      return;
    }
    modelSelect.innerHTML = options.map((model) => `
      <option value="${escapeAttr(model.id)}">${escapeHtml(formatModelOption(model))}</option>
    `).join('');
    if (options.some((model) => model.id === previous)) {
      modelSelect.value = previous;
    } else {
      modelSelect.value = options[0].id;
    }
    modelSelect.disabled = false;
  }

  function renderReferences() {
    if (!references.length) {
      referencesEl.innerHTML = '<span class="image-generation-reference-empty">No image input.</span>';
      return;
    }
    referencesEl.innerHTML = references.map((image, index) => `
      <figure class="image-generation-reference-item">
        <img src="${escapeAttr(image.dataUrl)}" alt="">
        <figcaption>${escapeHtml(image.name)}</figcaption>
        <button type="button" class="image-generation-reference-remove" data-index="${index}" aria-label="Remove image">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </figure>
    `).join('');
  }

  function renderOutputs(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      outputEl.innerHTML = '<span class="image-generation-output-empty">No video generated.</span>';
      return;
    }

    const scale = Number(outputZoomEl.value || 100) / 100;
    outputEl.innerHTML = list.map((item, index) => {
      const url = String(item?.url || '');
      const mimeType = String(item?.mime_type || '');
      const width = Math.max(160, Math.round(toNonNegativeInt(item?.width) * scale));
      const height = toNonNegativeInt(item?.height);
      const duration = Number(item?.duration_seconds);
      const frames = toNonNegativeInt(item?.num_frames);
      const fps = toNonNegativeInt(item?.fps);
      const labelParts = [
        duration > 0 ? `${duration.toFixed(1)}s` : '',
        frames ? `${frames} frames` : '',
        fps ? `${fps} FPS` : '',
        mimeType || '',
      ].filter(Boolean);
      const caption = labelParts.join(', ') || `Video ${index + 1}`;
      const content = mimeType.startsWith('video/')
        ? `<video src="${escapeAttr(url)}" controls data-base-width="${escapeAttr(toNonNegativeInt(item?.width) || 512)}" style="width:${width}px; max-width:100%; aspect-ratio:${toAspectRatio(item)}"></video>`
        : `<a class="video-generation-artifact-link" href="${escapeAttr(url)}" target="_blank" rel="noreferrer">Open artifact</a>`;
      return `
        <figure class="image-generation-output-item">
          ${content}
          <figcaption>${escapeHtml(caption)}</figcaption>
        </figure>
      `;
    }).join('');
  }

  function updateOutputZoom() {
    const value = clampInt(outputZoomEl.value, 25, 200, 100);
    outputZoomEl.value = String(value);
    outputZoomValueEl.textContent = `${value}%`;
    const items = Array.from(outputEl.querySelectorAll('.image-generation-output-item video'));
    items.forEach((video) => {
      const baseWidth = Number(video.dataset.baseWidth || 0);
      if (Number.isFinite(baseWidth) && baseWidth > 0) {
        video.style.width = `${Math.round(baseWidth * value / 100)}px`;
      }
    });
  }

  function setStatus(message, { error = false } = {}) {
    statusEl.textContent = message || '';
    statusEl.classList.toggle('is-error', Boolean(error));
  }

  function updateRunState() {
    const model = selectedModel();
    const prompt = String(promptEl.value || '').trim();
    const operation = activeOperation();
    const canRunText = operation === 'text_to_video' && modelSupportsTextToVideo(model);
    const canRunImage = operation === 'image_to_video' && modelSupportsImageToVideo(model);
    const canRun = Boolean(model && prompt && (canRunText || canRunImage));
    runBtn.disabled = isRunning || !canRun;
    addImageBtn.disabled = isRunning || !model || modelMaxInputImages(model) < 1;
    modelSelect.disabled = isRunning || selectableModels().length === 0;

    if (isRunning) return;
    if (!model) {
      setStatus('No loaded video models.');
    } else if (operation === 'image_to_video' && !canRunImage) {
      setStatus('Selected model does not support image-to-video.', { error: true });
    } else if (!statusEl.textContent || statusEl.textContent.startsWith('Loading') || statusEl.classList.contains('is-error')) {
      setStatus('Ready.');
    }
  }

  function buildPayload() {
    const model = selectedModel();
    const schema = activeParameterSchema();
    const metadata = {};

    if (schema.steps) {
      metadata.steps = clampInt(
        stepsEl.value,
        parameterNumber(schema.steps.minimum, 1),
        parameterNumber(schema.steps.maximum, 80),
        parameterNumber(schema.steps.default, model?.recommendedSteps || 4)
      );
    }
    if (schema.guidance) {
      metadata.guidance = clampNumber(
        guidanceEl.value,
        parameterNumber(schema.guidance.minimum, 0),
        parameterNumber(schema.guidance.maximum, 20),
        parameterNumber(schema.guidance.default, model?.recommendedGuidance ?? 1)
      );
    }
    if (schema.guidance_2) {
      const value = parseOptionalNumber(guidance2El.value);
      if (value != null) {
        metadata.guidance_2 = clampNumber(
          value,
          parameterNumber(schema.guidance_2.minimum, 0),
          parameterNumber(schema.guidance_2.maximum, 20),
          value
        );
      }
    }
    if (schema.max_sequence_length) {
      metadata.max_sequence_length = clampInt(
        maxSequenceLengthEl.value,
        parameterNumber(schema.max_sequence_length.minimum, 64),
        parameterNumber(schema.max_sequence_length.maximum, 1024),
        parameterNumber(schema.max_sequence_length.default, 512)
      );
    }
    if (schema.negative_prompt) {
      metadata.negative_prompt = String(negativePromptEl.value || '');
    }
    if (schema.use_prompt_enhancer) {
      metadata.use_prompt_enhancer = usePromptEnhancerEl.value === 'true';
    }
    if (schema.lora_name) {
      const loraName = String(loraNameEl.value || '').trim();
      if (loraName) {
        metadata.lora_name = loraName;
      }
    }
    if (schema.lora_strength) {
      const loraStrength = parseOptionalNumber(loraStrengthEl.value);
      if (loraStrength != null) {
        metadata.lora_strength = clampNumber(
          loraStrength,
          parameterNumber(schema.lora_strength.minimum, 0),
          parameterNumber(schema.lora_strength.maximum, 3),
          loraStrength
        );
      }
    }

    const payload = {
      model: selectedModelId(),
      prompt: String(promptEl.value || '').trim(),
      n: clampInt(countEl.value, parameterNumber(schema.n?.minimum, 1), parameterNumber(schema.n?.maximum, 4), 1),
      size: String(sizeEl.value || '832x480'),
      duration_seconds: clampNumber(
        durationEl.value,
        parameterNumber(schema.duration_seconds?.minimum, 0.5),
        parameterNumber(schema.duration_seconds?.maximum, 60),
        parameterNumber(schema.duration_seconds?.default, 5)
      ),
      fps: clampInt(fpsEl.value, parameterNumber(schema.fps?.minimum, 1), parameterNumber(schema.fps?.maximum, 60), 16),
      metadata,
    };

    const frames = parseOptionalInt(framesEl.value);
    if (frames != null) {
      payload.num_frames = clampInt(
        frames,
        parameterNumber(schema.num_frames?.minimum, 1),
        parameterNumber(schema.num_frames?.maximum, 600),
        frames
      );
    }

    const seed = parseOptionalInt(seedEl.value);
    if (seed != null) {
      payload.seed = seed;
    }

    if (schema.quality) {
      payload.quality = String(qualityEl.value || 'auto');
    }

    return payload;
  }

  async function loadModels() {
    const token = ++loadToken;
    setStatus('Loading video-pool models...');
    try {
      const payload = await api.getVideoPoolModels();
      if (!container.isConnected || token !== loadToken) return;
      models = normalizeModelsPayload(payload);
      renderModelOptions();
      applySelectedModelDefaults();
      updateRunState();
    } catch (err) {
      if (!container.isConnected || token !== loadToken) return;
      models = [];
      renderModelOptions();
      updateRunState();
      setStatus(`Could not load video models: ${formatApiError(err)}`, { error: true });
    }
  }

  async function runGeneration() {
    if (isRunning || runBtn.disabled) return;
    const payload = buildPayload();
    const operation = activeOperation();

    isRunning = true;
    updateRunState();
    setStatus(operation === 'image_to_video' ? 'Generating video from image...' : 'Generating video...');
    try {
      const response = operation === 'image_to_video'
        ? await api.runImageToVideo({
          ...payload,
          images: references.map((image) => ({
            name: image.name,
            data_url: image.dataUrl,
          })),
        })
        : await api.runVideoGeneration(payload);
      renderOutputs(response?.data || []);
      setStatus(formatResponseStatus(response));
    } catch (err) {
      setStatus(`Video generation failed: ${formatApiError(err)}`, { error: true });
    } finally {
      isRunning = false;
      updateRunState();
    }
  }

  function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });
  }

  modelSelect.addEventListener('change', () => {
    applySelectedModelDefaults();
    renderReferences();
    updateRunState();
  });
  promptEl.addEventListener('input', updateRunState);
  resetDefaultsBtn.addEventListener('click', () => {
    applySelectedModelDefaults();
    updateRunState();
  });
  runBtn.addEventListener('click', runGeneration);
  outputZoomEl.addEventListener('input', updateOutputZoom);

  addImageBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  referencesEl.addEventListener('click', (event) => {
    const button = event.target.closest('.image-generation-reference-remove');
    if (!button) return;
    const index = Number.parseInt(button.dataset.index || '', 10);
    if (!Number.isInteger(index) || index < 0 || index >= references.length) return;
    references.splice(index, 1);
    applyParameterSchema();
    renderReferences();
    updateRunState();
  });

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    setStatus('Reading image...');
    const maxInputImages = modelMaxInputImages(selectedModel());
    const loaded = await Promise.all(
      Array.from(fileInput.files).slice(0, maxInputImages).map(async (file) => ({
        name: String(file.name || 'image'),
        dataUrl: await readImageAsDataUrl(file),
      }))
    );
    references = loaded.filter((image) => image.dataUrl.startsWith('data:image/'));
    applyParameterSchema({ reset: true });
    renderReferences();
    updateRunState();
    setStatus(references.length > 0 ? `${references.length} image(s) added.` : '');
  });

  renderReferences();
  renderOutputs([]);
  updateOutputZoom();
  renderModelOptions();
  container.__onActivate = () => {
    loadModels();
  };
  return container;
}

function normalizeModelsPayload(payload) {
  const list = Array.isArray(payload) ? payload : [];
  return list.map((model) => ({
    id: String(model?.id || model?.name || ''),
    name: String(model?.name || model?.id || ''),
    backend: String(model?.backend || ''),
    capabilities: model?.capabilities && typeof model.capabilities === 'object' ? model.capabilities : {},
    recommendedSteps: model?.recommended_steps == null ? null : Number(model.recommended_steps),
    recommendedGuidance: model?.recommended_guidance == null ? null : Number(model.recommended_guidance),
    generationParameters: model?.generation_parameters && typeof model.generation_parameters === 'object'
      ? model.generation_parameters
      : {},
    imageToVideoParameters: model?.image_to_video_parameters && typeof model.image_to_video_parameters === 'object'
      ? model.image_to_video_parameters
      : {},
  })).filter((model) => model.id);
}

function parameterNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function enumDefault(definition, values) {
  const defaultValue = String(definition?.default || '');
  if (values.includes(defaultValue)) {
    return defaultValue;
  }
  return values[0] || '';
}

function enumLabel(definition, value) {
  const labels = definition?.labels && typeof definition.labels === 'object' ? definition.labels : {};
  return String(labels[value] || value);
}

function formatEnumOption(definition, value) {
  const text = String(value || '').trim();
  if (/^\d+x\d+$/.test(text)) {
    const [widthText, heightText] = text.split('x');
    const width = Number.parseInt(widthText, 10);
    const height = Number.parseInt(heightText, 10);
    if (width === height) {
      return `Square ${text}`;
    }
    return width > height ? `Landscape ${text}` : `Portrait ${text}`;
  }
  return enumLabel(definition, text);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseOptionalInt(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonNegativeInt(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function toAspectRatio(item) {
  const width = toNonNegativeInt(item?.width);
  const height = toNonNegativeInt(item?.height);
  return width && height ? `${width} / ${height}` : '16 / 9';
}

function formatModelOption(model) {
  const name = model.name || model.id;
  return model.backend ? `${name} (${model.backend})` : name;
}

function formatResponseStatus(response) {
  const count = Array.isArray(response?.data) ? response.data.length : 0;
  const metrics = response?.metrics && typeof response.metrics === 'object' ? response.metrics : {};
  const backend = String(metrics.backend || '').trim();
  const wallMs = Number(metrics.pool_total_wall_ms ?? metrics.backend_inference_wall_ms);
  if (Number.isFinite(wallMs)) {
    return backend
      ? `${count} video(s), ${(wallMs / 1000).toFixed(2)}s, ${backend}`
      : `${count} video(s), ${(wallMs / 1000).toFixed(2)}s`;
  }
  return backend ? `${count} video(s), ${backend}` : `${count} video(s)`;
}
