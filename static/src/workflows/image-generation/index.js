import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const SIZE_BY_ASPECT_RATIO = {
  '1:1': '512x512',
  '1:1-large': '1024x1024',
  '4:3': '768x576',
  '3:4': '576x768',
  '16:9': '1024x576',
  '9:16': '576x1024',
};
const MAX_MATCHED_INPUT_EDGE = 1024;
const OUTPUT_SIZE_MULTIPLE = 8;
const DEFAULT_LORA_STRENGTH = 0.35;
const DEFAULT_IMAGE_STRENGTH = 0.35;
const DEFAULT_PARAMETER_LABELS = {
  size: 'Output size',
  n: 'Images',
  steps: 'Steps',
  guidance: 'Guidance',
  sampler: 'Sampler',
  strength: 'Image strength',
  seed: 'Seed',
  negative_prompt: 'Negative prompt',
  lora_scale: 'LoRA strength',
};

export function createImageGenerationView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view image-generation-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <label class="translation-prompts-field">
              <span>Model</span>
              <select id="imageGenerationModelSelect" disabled>
                <option value="">Loading image models...</option>
              </select>
            </label>
            <details class="translation-prompts-system-details image-generation-parameters-details">
              <summary id="imageGenerationParametersSummary">Generation parameters</summary>
              <div class="translation-prompts-language-grid image-generation-params-grid">
                <label class="translation-prompts-field">
                  <span data-parameter-label="size">Output size</span>
                  <select id="imageGenerationAspectRatio">
                    <option value="1:1">Square 512x512</option>
                    <option value="1:1-large">Square 1024x1024</option>
                    <option value="match-input" disabled>Match input shape</option>
                    <option value="4:3">Landscape 768x576</option>
                    <option value="3:4">Portrait 576x768</option>
                    <option value="16:9">Wide 1024x576</option>
                    <option value="9:16">Tall 576x1024</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="n">Images</span>
                  <input id="imageGenerationCount" type="number" min="1" max="4" step="1" value="1">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="steps">Steps</span>
                  <input id="imageGenerationSteps" type="number" min="1" max="80" step="1" value="4">
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="guidance">Guidance</span>
                  <input id="imageGenerationGuidance" type="number" min="0" max="20" step="0.5" value="1">
                </label>
                <label class="translation-prompts-field image-generation-sampler-field" hidden>
                  <span data-parameter-label="sampler">Sampler</span>
                  <select id="imageGenerationSampler"></select>
                </label>
                <label class="translation-prompts-field image-generation-image-strength-field">
                  <span>
                    <span data-parameter-label="strength">Image strength</span>
                    <output id="imageGenerationImageStrengthValue">0.35</output>
                  </span>
                  <input id="imageGenerationImageStrength" type="range" min="0" max="1" step="0.05" value="0.35" disabled>
                </label>
                <label class="translation-prompts-field">
                  <span data-parameter-label="seed">Seed</span>
                  <input id="imageGenerationSeed" type="number" step="1" placeholder="Random">
                </label>
                <label class="translation-prompts-field image-generation-negative-prompt-field" hidden>
                  <span data-parameter-label="negative_prompt">Negative prompt</span>
                  <input id="imageGenerationNegativePrompt" type="text" placeholder="None">
                </label>
                <label class="translation-prompts-field image-generation-lora-field">
                  <span>LoRA</span>
                  <select id="imageGenerationLoraSelect" disabled>
                    <option value="">No LoRA</option>
                  </select>
                </label>
                <label class="translation-prompts-field image-generation-lora-strength-field">
                  <span>
                    <span data-parameter-label="lora_scale">LoRA strength</span>
                    <output id="imageGenerationLoraStrengthValue">0.35</output>
                  </span>
                  <input id="imageGenerationLoraStrength" type="range" min="0" max="2" step="0.05" value="0.35" disabled>
                </label>
              </div>
              <div class="image-generation-parameter-actions">
                <button type="button" id="imageGenerationResetDefaultsBtn">Reset to defaults</button>
              </div>
            </details>
            <label class="translation-prompts-field">
              <span>Prompt</span>
              <textarea id="imageGenerationPrompt" rows="5" placeholder="<Image prompt or edit instruction>"></textarea>
            </label>
            <div class="translation-prompts-run-actions">
              <button type="button" id="imageGenerationRunBtn" disabled>Run</button>
              <button type="button" id="imageGenerationAddFilesBtn">Add images</button>
              <input id="imageGenerationFileInput" type="file" accept="image/*" multiple hidden>
            </div>
            <div class="translation-prompts-inline-status" id="imageGenerationStatus">Loading image-pool models...</div>
            <div class="image-generation-reference-strip" id="imageGenerationReferences"></div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <div class="image-generation-output-shell">
              <section class="image-generation-output" id="imageGenerationOutput" aria-label="Output">
                <span class="image-generation-output-empty">No image generated.</span>
              </section>
              <label class="image-generation-output-zoom" aria-label="Output preview size">
                <input id="imageGenerationOutputZoom" type="range" min="25" max="200" step="5" value="100">
                <output id="imageGenerationOutputZoomValue">100%</output>
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;

  const modelSelect = container.querySelector('#imageGenerationModelSelect');
  const promptEl = container.querySelector('#imageGenerationPrompt');
  const parameterLabelEls = Object.fromEntries(
    Array.from(container.querySelectorAll('[data-parameter-label]')).map((element) => [
      String(element.dataset.parameterLabel || ''),
      element,
    ])
  );
  const parametersSummaryEl = container.querySelector('#imageGenerationParametersSummary');
  const resetDefaultsBtn = container.querySelector('#imageGenerationResetDefaultsBtn');
  const aspectRatioEl = container.querySelector('#imageGenerationAspectRatio');
  const countEl = container.querySelector('#imageGenerationCount');
  const stepsEl = container.querySelector('#imageGenerationSteps');
  const guidanceEl = container.querySelector('#imageGenerationGuidance');
  const samplerField = container.querySelector('.image-generation-sampler-field');
  const samplerEl = container.querySelector('#imageGenerationSampler');
  const imageStrengthField = container.querySelector('.image-generation-image-strength-field');
  const imageStrengthEl = container.querySelector('#imageGenerationImageStrength');
  const imageStrengthValueEl = container.querySelector('#imageGenerationImageStrengthValue');
  const seedEl = container.querySelector('#imageGenerationSeed');
  const negativePromptField = container.querySelector('.image-generation-negative-prompt-field');
  const negativePromptEl = container.querySelector('#imageGenerationNegativePrompt');
  const loraField = container.querySelector('.image-generation-lora-field');
  const loraSelect = container.querySelector('#imageGenerationLoraSelect');
  const loraStrengthField = container.querySelector('.image-generation-lora-strength-field');
  const loraStrengthEl = container.querySelector('#imageGenerationLoraStrength');
  const loraStrengthValueEl = container.querySelector('#imageGenerationLoraStrengthValue');
  const outputZoomEl = container.querySelector('#imageGenerationOutputZoom');
  const outputZoomValueEl = container.querySelector('#imageGenerationOutputZoomValue');
  const runBtn = container.querySelector('#imageGenerationRunBtn');
  const addFilesBtn = container.querySelector('#imageGenerationAddFilesBtn');
  const fileInput = container.querySelector('#imageGenerationFileInput');
  const referencesEl = container.querySelector('#imageGenerationReferences');
  const outputEl = container.querySelector('#imageGenerationOutput');
  const statusEl = container.querySelector('#imageGenerationStatus');
  let references = [];
  let models = [];
  let loras = [];
  let isRunning = false;
  let loadToken = 0;
  let loraLoadToken = 0;

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
    const model = selectedModel();
    if (references.length === 0 && model && !modelSupportsGeneration(model) && modelSupportsImageInput(model)) {
      return 'edit';
    }
    if (references.length > 0) {
      return modelSupportsImageEdit(model) ? 'edit' : 'image_to_image';
    }
    return 'generation';
  }

  function activeParameterSchema() {
    const model = selectedModel();
    if (!model) return {};
    const operation = activeOperation();
    const schema = operation === 'edit' || operation === 'image_to_image'
      ? model.editParameters
      : model.generationParameters;
    return schema && typeof schema === 'object' ? schema : {};
  }

  function parameterDefinition(name) {
    const schema = activeParameterSchema();
    const definition = schema[name];
    return definition && typeof definition === 'object' ? definition : null;
  }

  function hasParameter(name) {
    return Boolean(parameterDefinition(name));
  }

  function matchingLoras() {
    const modelId = selectedModelId();
    if (!modelId) return [];
    return loras.filter((lora) => lora.compatibleModels.includes(modelId));
  }

  function selectedLora() {
    const loraId = String(loraSelect.value || '').trim();
    return matchingLoras().find((lora) => lora.id === loraId) || null;
  }

  function modelSupportsImageInput(model) {
    const capabilities = model?.capabilities && typeof model.capabilities === 'object'
      ? model.capabilities
      : {};
    const inputModalities = Array.isArray(capabilities.input_modalities)
      ? capabilities.input_modalities.map((item) => String(item))
      : [];
    const tasks = Array.isArray(capabilities.tasks)
      ? capabilities.tasks.map((item) => String(item))
      : [];
    return inputModalities.includes('image') && (
      tasks.includes('image_edit') || tasks.includes('image_to_image')
    );
  }

  function modelSupportsImageEdit(model) {
    const capabilities = model?.capabilities && typeof model.capabilities === 'object'
      ? model.capabilities
      : {};
    const tasks = Array.isArray(capabilities.tasks)
      ? capabilities.tasks.map((item) => String(item))
      : [];
    return tasks.includes('image_edit');
  }

  function modelSupportsGeneration(model) {
    const capabilities = model?.capabilities && typeof model.capabilities === 'object'
      ? model.capabilities
      : {};
    const tasks = Array.isArray(capabilities.tasks)
      ? capabilities.tasks.map((item) => String(item))
      : [];
    return tasks.length === 0 || tasks.includes('image_generation');
  }

  function modelMaxInputImages(model) {
    const parsed = Number.parseInt(model?.capabilities?.max_images, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 4;
  }

  function modelMaxOutputImages(model) {
    const parsed = Number.parseInt(model?.capabilities?.max_output_images, 10);
    return Number.isFinite(parsed) ? Math.max(1, parsed) : 4;
  }

  function applySelectedModelDefaults() {
    applyParameterSchema({ reset: true });
  }

  function applyParameterSchema({ reset = false } = {}) {
    const model = selectedModel();
    const operation = activeOperation();
    const schema = activeParameterSchema();
    parametersSummaryEl.textContent = 'Generation parameters';

    applyParameterLabels(schema);
    configureSizeControl(schema.size, { reset, operation });
    configureIntegerControl(countEl, schema.n, { reset, fallback: modelMaxOutputImages(model), hardMin: 1, hardMax: modelMaxOutputImages(model) });
    configureIntegerControl(stepsEl, schema.steps, { reset, fallback: model?.recommendedSteps || 4, hardMin: 1, hardMax: 80 });
    configureNumberControl(guidanceEl, schema.guidance, { reset, fallback: model?.recommendedGuidance ?? 1, hardMin: 0, hardMax: 20 });
    configureSamplerControl(schema.sampler, { reset });
    configureSeedControl(schema.seed, { reset });
    configureTextControl(negativePromptField, negativePromptEl, schema.negative_prompt, { reset });
    configureRangeControl(imageStrengthField, imageStrengthEl, imageStrengthValueEl, schema.strength, {
      reset,
      fallback: DEFAULT_IMAGE_STRENGTH,
      hardMin: 0,
      hardMax: 1,
    });
    configureRangeControl(loraStrengthField, loraStrengthEl, loraStrengthValueEl, schema.lora_scale, {
      reset,
      fallback: DEFAULT_LORA_STRENGTH,
      hardMin: 0,
      hardMax: 2,
    });

    const supportsLoraParameter = Boolean(schema.lora_scale);
    loraField.hidden = !supportsLoraParameter;
    loraStrengthField.hidden = !supportsLoraParameter;
    if (!supportsLoraParameter) {
      loraSelect.value = '';
    }
  }

  function applyParameterLabels(schema) {
    Object.entries(DEFAULT_PARAMETER_LABELS).forEach(([name, fallback]) => {
      const element = parameterLabelEls[name];
      if (element) {
        element.textContent = parameterLabel(schema[name], fallback);
      }
    });
  }

  function configureSizeControl(definition, { reset, operation }) {
    const allowedValues = Array.isArray(definition?.allowed_values)
      ? definition.allowed_values.map((item) => String(item)).filter(Boolean)
      : [];
    const values = allowedValues.length > 0 ? allowedValues : ['512x512'];
    const defaultValue = values.includes(String(definition?.default || ''))
      ? String(definition.default)
      : values[0];
    const previousValue = String(aspectRatioEl.value || '');
    const canMatchInput = (operation === 'edit' || operation === 'image_to_image')
      && references.some((image) => image.width && image.height);
    aspectRatioEl.innerHTML = [
      ...values.map((value) => `<option value="${escapeAttr(value)}">${escapeHtml(formatSizeOption(value))}</option>`),
      `<option value="match-input"${canMatchInput ? '' : ' disabled'}>Match input shape</option>`,
    ].join('');
    if (reset) {
      aspectRatioEl.value = defaultValue;
    } else if (previousValue === 'match-input' && canMatchInput) {
      aspectRatioEl.value = 'match-input';
    } else if (values.includes(previousValue)) {
      aspectRatioEl.value = previousValue;
    } else {
      aspectRatioEl.value = defaultValue;
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

  function configureSamplerControl(definition, { reset }) {
    const values = enumValues(definition);
    const defaultValue = enumDefault(definition, values);
    const previousValue = String(samplerEl.value || '');
    samplerField.hidden = !definition || values.length <= 1;
    samplerEl.innerHTML = values.map((value) => `
      <option value="${escapeAttr(value)}">${escapeHtml(enumLabel(definition, value))}</option>
    `).join('');
    if (reset) {
      samplerEl.value = defaultValue;
    } else if (values.includes(previousValue)) {
      samplerEl.value = previousValue;
    } else {
      samplerEl.value = defaultValue;
    }
  }

  function configureRangeControl(field, input, output, definition, { reset, fallback, hardMin, hardMax }) {
    const min = parameterNumber(definition?.minimum, hardMin);
    const max = parameterNumber(definition?.maximum, hardMax);
    const defaultValue = parameterNumber(definition?.default, fallback);
    field.hidden = !definition;
    input.min = String(min);
    input.max = String(max);
    input.step = String(parameterNumber(definition?.step, 0.05));
    const nextValue = reset ? defaultValue : input.value;
    const value = clampNumber(nextValue, min, max, defaultValue);
    input.value = value.toFixed(2);
    output.textContent = value.toFixed(2);
  }

  function configureSeedControl(definition, { reset }) {
    const visible = Boolean(definition);
    seedEl.closest('label').hidden = !visible;
    if (!visible) return;
    if (definition.minimum != null) {
      seedEl.min = String(definition.minimum);
    } else {
      seedEl.removeAttribute('min');
    }
    seedEl.step = String(parameterNumber(definition.step, 1));
    if (reset) {
      seedEl.value = definition.default == null ? '' : String(definition.default);
    }
  }

  function configureTextControl(field, input, definition, { reset }) {
    field.hidden = !definition;
    if (definition && reset) {
      input.value = String(definition.default || '');
    }
  }

  function updateRunState() {
    applyParameterSchema();
    const model = selectedModel();
    const supportsImageInput = modelSupportsImageInput(model);
    const supportsGeneration = modelSupportsGeneration(model);
    const operation = activeOperation();
    const canRunOperation = operation === 'edit'
      ? supportsImageInput && references.length > 0 && Object.keys(activeParameterSchema()).length > 0
      : supportsGeneration && Object.keys(activeParameterSchema()).length > 0;
    runBtn.disabled = isRunning || !selectedModelId() || !canRunOperation;
    resetDefaultsBtn.disabled = isRunning || !selectedModelId();
    const maxInputImages = modelMaxInputImages(model);
    const nDefinition = parameterDefinition('n');
    const maxOutputImages = parameterNumber(nDefinition?.maximum, modelMaxOutputImages(model));
    const minOutputImages = parameterNumber(nDefinition?.minimum, 1);
    countEl.max = String(maxOutputImages);
    const clampedOutputImages = clampInt(countEl.value, minOutputImages, maxOutputImages, 1);
    if (clampedOutputImages !== Number.parseInt(countEl.value, 10)) {
      countEl.value = String(clampedOutputImages);
    }
    addFilesBtn.disabled = isRunning || !supportsImageInput;
    imageStrengthEl.disabled = isRunning || imageStrengthField.hidden || !supportsImageInput || references.length === 0;
    const hasMatchingLoras = matchingLoras().length > 0;
    const hasSelectedLora = Boolean(selectedLora());
    loraSelect.disabled = isRunning || loraField.hidden || !hasMatchingLoras;
    loraStrengthEl.disabled = isRunning || loraStrengthField.hidden || !hasSelectedLora;
    updateImageStrengthLabel();
    updateLoraStrengthLabel();
    if ((!supportsImageInput && references.length > 0) || references.length > maxInputImages) {
      references = supportsImageInput ? references.slice(0, maxInputImages) : [];
      renderReferences();
    }
    syncOutputSizeOptions();
  }

  function syncOutputSizeOptions() {
    const matchInputOption = aspectRatioEl.querySelector('option[value="match-input"]');
    const canMatchInput = references.length > 0 && references.some((image) => image.width && image.height);
    if (matchInputOption) {
      matchInputOption.disabled = !canMatchInput;
    }
    if (!canMatchInput && aspectRatioEl.value === 'match-input') {
      aspectRatioEl.value = aspectRatioEl.querySelector('option:not([disabled])')?.value || '512x512';
    }
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function renderModelOptions() {
    const previous = selectedModelId();
    const options = selectableModels();
    modelSelect.innerHTML = options.length > 0
      ? options.map((model) => `
        <option value="${escapeAttr(model.id)}">${escapeHtml(formatModelOption(model))}</option>
      `).join('')
      : '<option value="">No loaded image models</option>';
    if (options.some((model) => model.id === previous)) {
      modelSelect.value = previous;
    }
    modelSelect.disabled = options.length === 0;
    applySelectedModelDefaults();
    renderLoraOptions();
    updateRunState();
    renderReferences();
  }

  function renderLoraOptions() {
    const previous = String(loraSelect.value || '');
    const options = matchingLoras();
    loraSelect.innerHTML = [
      '<option value="">No LoRA</option>',
      ...options.map((lora) => `
        <option value="${escapeAttr(lora.id)}">${escapeHtml(formatLoraOption(lora))}</option>
      `),
    ].join('');
    if (options.some((lora) => lora.id === previous)) {
      loraSelect.value = previous;
    } else {
      loraSelect.value = '';
    }
  }

  function updateLoraStrengthLabel() {
    const min = Number(loraStrengthEl.min || 0);
    const max = Number(loraStrengthEl.max || 2);
    const value = clampNumber(loraStrengthEl.value, min, max, DEFAULT_LORA_STRENGTH);
    loraStrengthEl.value = value.toFixed(2);
    loraStrengthValueEl.textContent = value.toFixed(2);
  }

  function updateImageStrengthLabel() {
    const min = Number(imageStrengthEl.min || 0);
    const max = Number(imageStrengthEl.max || 1);
    const value = clampNumber(imageStrengthEl.value, min, max, DEFAULT_IMAGE_STRENGTH);
    imageStrengthEl.value = value.toFixed(2);
    imageStrengthValueEl.textContent = value.toFixed(2);
  }

  function renderReferences() {
    if (references.length === 0) {
      const model = selectedModel();
      const emptyMessage = model && selectedModelId() && !modelSupportsImageInput(model)
        ? 'Selected model does not accept input images.'
        : 'No images added.';
      referencesEl.innerHTML = `<span class="image-generation-reference-empty">${escapeHtml(emptyMessage)}</span>`;
      return;
    }
    referencesEl.innerHTML = references.map((image, index) => `
      <figure class="image-generation-reference-item">
        <img src="${escapeAttr(image.dataUrl)}" alt="${escapeAttr(image.name)}">
        <button
          type="button"
          class="image-generation-reference-remove"
          data-index="${index}"
          aria-label="Remove ${escapeAttr(image.name)}"
          title="Remove ${escapeAttr(image.name)}"
        ><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
        <figcaption>${escapeHtml(image.name)}</figcaption>
      </figure>
    `).join('');
  }

  function updateOutputZoom() {
    const value = clampInt(outputZoomEl.value, 25, 200, 100);
    outputZoomEl.value = String(value);
    outputZoomValueEl.textContent = `${value}%`;
    outputEl.querySelectorAll('img[data-output-image]').forEach((image) => {
      const applyWidth = () => {
        const naturalWidth = image.naturalWidth || 512;
        image.style.width = `${Math.round(naturalWidth * value / 100)}px`;
      };
      if (image.complete && image.naturalWidth) {
        applyWidth();
      } else {
        image.addEventListener('load', applyWidth, { once: true });
      }
    });
  }

  function renderOutputs(items) {
    if (!Array.isArray(items) || items.length === 0) {
      outputEl.innerHTML = '<span class="image-generation-output-empty">No image generated.</span>';
      return;
    }
    outputEl.innerHTML = items.map((item, index) => {
      const mimeType = String(item?.mime_type || 'image/png');
      const b64 = String(item?.b64_json || '');
      const src = `data:${mimeType};base64,${b64}`;
      const caption = item?.revised_prompt ? String(item.revised_prompt) : `Output ${index + 1}`;
      return `
        <figure class="image-generation-output-item">
          <img src="${escapeAttr(src)}" alt="${escapeAttr(caption)}" data-output-image>
          <figcaption>${escapeHtml(caption)}</figcaption>
        </figure>
      `;
    }).join('');
    updateOutputZoom();
  }

  async function loadModels() {
    const token = ++loadToken;
    setStatus('Loading image-pool models...');
    try {
      const payload = await api.getImagePoolModels();
      if (!container.isConnected || token !== loadToken) return;
      models = Array.isArray(payload)
        ? payload.map((model) => ({
          id: String(model?.id || model?.name || ''),
          name: String(model?.name || model?.id || ''),
          backend: String(model?.backend || ''),
          capabilities: model?.capabilities && typeof model.capabilities === 'object'
            ? model.capabilities
            : {},
          recommendedSteps: model?.recommended_steps == null ? null : Number.parseInt(model.recommended_steps, 10),
          recommendedGuidance: model?.recommended_guidance == null ? null : Number(model.recommended_guidance),
          generationParameters: model?.generation_parameters && typeof model.generation_parameters === 'object'
            ? model.generation_parameters
            : {},
          editParameters: model?.edit_parameters && typeof model.edit_parameters === 'object'
            ? model.edit_parameters
            : {},
        })).filter((model) => model.id)
        : [];
      renderModelOptions();
      setStatus(models.length > 0 ? '' : 'No loaded image models available.');
    } catch (err) {
      if (!container.isConnected || token !== loadToken) return;
      models = [];
      renderModelOptions();
      setStatus(`Failed to load image models: ${formatApiError(err)}`);
    }
  }

  async function loadLoras() {
    const token = ++loraLoadToken;
    try {
      const payload = await api.getImagePoolLoras();
      if (!container.isConnected || token !== loraLoadToken) return;
      const rawLoras = Array.isArray(payload?.loras) ? payload.loras : [];
      loras = rawLoras.map((lora) => ({
        id: String(lora?.id || ''),
        name: String(lora?.name || lora?.id || ''),
        family: String(lora?.family || ''),
        sourceType: String(lora?.source_type || ''),
        artifactType: String(lora?.artifact_type || lora?.kind || ''),
        model: String(lora?.model || ''),
        trainedOnModelId: String(lora?.trained_on_model_id || lora?.model || ''),
        compatibleModels: Array.isArray(lora?.compatible_models)
          ? lora.compatible_models.map((item) => String(item)).filter(Boolean)
          : [String(lora?.model || '')].filter(Boolean),
        triggerWords: Array.isArray(lora?.trigger_words)
          ? lora.trigger_words.map((item) => String(item)).filter(Boolean)
          : [],
        defaultStrength: lora?.default_strength == null || lora?.default_strength === ''
          ? null
          : Number(lora.default_strength),
        path: String(lora?.path || ''),
        runId: String(lora?.run_id || ''),
        dataset: String(lora?.dataset || ''),
        kind: String(lora?.kind || ''),
        checkpointId: String(lora?.checkpoint_id || ''),
        checkpointStep: Number.parseInt(lora?.checkpoint_step, 10),
      })).filter((lora) => lora.id && lora.path);
      renderLoraOptions();
      updateRunState();
    } catch (err) {
      if (!container.isConnected || token !== loraLoadToken) return;
      loras = [];
      renderLoraOptions();
      updateRunState();
      setStatus(`Failed to load LoRAs: ${formatApiError(err)}`);
    }
  }

  function buildPayload() {
    const prompt = String(promptEl.value || '').trim();
    const outputSizeMode = String(aspectRatioEl.value || '1:1');
    const nDefinition = parameterDefinition('n');
    const stepsDefinition = parameterDefinition('steps');
    const guidanceDefinition = parameterDefinition('guidance');
    const samplerDefinition = parameterDefinition('sampler');
    const strengthDefinition = parameterDefinition('strength');
    const loraScaleDefinition = parameterDefinition('lora_scale');
    const n = clampInt(
      countEl.value,
      parameterNumber(nDefinition?.minimum, 1),
      parameterNumber(nDefinition?.maximum, modelMaxOutputImages(selectedModel())),
      parameterNumber(nDefinition?.default, 1)
    );
    const seed = parseOptionalInt(seedEl.value);
    const lora = selectedLora();
    const loraScale = clampNumber(
      loraStrengthEl.value,
      parameterNumber(loraScaleDefinition?.minimum, 0),
      parameterNumber(loraScaleDefinition?.maximum, 2),
      parameterNumber(loraScaleDefinition?.default, DEFAULT_LORA_STRENGTH)
    );
    const size = outputSizeMode === 'match-input'
      ? outputSizeFromReference(references[0])
      : SIZE_BY_ASPECT_RATIO[outputSizeMode] || outputSizeMode || SIZE_BY_ASPECT_RATIO['1:1'];
    const metadata = { output_size_mode: outputSizeMode };
    if (stepsDefinition) {
      metadata.steps = clampInt(
        stepsEl.value,
        parameterNumber(stepsDefinition.minimum, 1),
        parameterNumber(stepsDefinition.maximum, 80),
        parameterNumber(stepsDefinition.default, 4)
      );
    }
    if (guidanceDefinition) {
      metadata.guidance = clampNumber(
        guidanceEl.value,
        parameterNumber(guidanceDefinition.minimum, 0),
        parameterNumber(guidanceDefinition.maximum, 20),
        parameterNumber(guidanceDefinition.default, 1)
      );
    }
    if (samplerDefinition) {
      metadata.sampler = enumValue(samplerDefinition, samplerEl.value);
    }
    if (hasParameter('negative_prompt')) {
      const negativePrompt = String(negativePromptEl.value || '').trim();
      if (negativePrompt) {
        metadata.negative_prompt = negativePrompt;
      }
    }
    if (lora && loraScaleDefinition) {
      metadata.lora_id = lora.id;
      metadata.lora_name = lora.name;
      metadata.lora_path = lora.path;
      metadata.lora_scale = loraScale;
      metadata.lora_family = lora.family;
      metadata.lora_source_type = lora.sourceType;
      metadata.lora_trained_on_model_id = lora.trainedOnModelId;
      metadata.lora_trigger_words = lora.triggerWords;
      metadata.lora_compatible_models = lora.compatibleModels;
      if (Number.isFinite(lora.defaultStrength)) {
        metadata.lora_default_strength = lora.defaultStrength;
      }
    }
    if (references.length > 0 && strengthDefinition) {
      metadata.strength = clampNumber(
        imageStrengthEl.value,
        parameterNumber(strengthDefinition.minimum, 0),
        parameterNumber(strengthDefinition.maximum, 1),
        parameterNumber(strengthDefinition.default, DEFAULT_IMAGE_STRENGTH)
      );
    }
    return {
      model: selectedModelId(),
      prompt,
      n,
      size,
      ...(seed === null ? {} : { seed }),
      metadata,
    };
  }

  function applySelectedLoraDefaultStrength() {
    const lora = selectedLora();
    if (!lora || !Number.isFinite(lora.defaultStrength)) return;
    const definition = parameterDefinition('lora_scale');
    if (!definition) return;
    const value = clampNumber(
      lora.defaultStrength,
      parameterNumber(definition.minimum, 0),
      parameterNumber(definition.maximum, 2),
      parameterNumber(definition.default, DEFAULT_LORA_STRENGTH)
    );
    loraStrengthEl.value = value.toFixed(2);
    updateLoraStrengthLabel();
  }

  async function runGeneration() {
    if (isRunning) return;
    const payload = buildPayload();
    if (!payload.model) {
      setStatus('No loaded image model selected.');
      return;
    }
    if (!payload.prompt) {
      setStatus('Prompt is required.');
      return;
    }

    isRunning = true;
    updateRunState();
    setStatus(references.length > 0
      ? (modelSupportsImageEdit(selectedModel()) ? 'Editing image...' : 'Generating from image...')
      : 'Generating image...');
    try {
      const response = references.length > 0
        ? await api.runImageEdit({
          ...payload,
          images: references.map((image) => ({
            name: image.name,
            data_url: image.dataUrl,
          })),
        })
        : await api.runImageGeneration(payload);
      renderOutputs(response?.data || []);
      setStatus(formatResponseStatus(response));
    } catch (err) {
      setStatus(`Image generation failed: ${formatApiError(err)}`);
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
    renderLoraOptions();
    updateRunState();
    renderReferences();
  });
  promptEl.addEventListener('input', updateRunState);
  seedEl.addEventListener('input', updateRunState);
  loraSelect.addEventListener('change', () => {
    applySelectedLoraDefaultStrength();
    updateRunState();
  });
  imageStrengthEl.addEventListener('input', updateImageStrengthLabel);
  loraStrengthEl.addEventListener('input', updateLoraStrengthLabel);
  outputZoomEl.addEventListener('input', updateOutputZoom);
  resetDefaultsBtn.addEventListener('click', () => {
    applySelectedModelDefaults();
    updateRunState();
  });
  runBtn.addEventListener('click', runGeneration);

  addFilesBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  referencesEl.addEventListener('click', (event) => {
    const button = event.target.closest('.image-generation-reference-remove');
    if (!button) return;
    const index = Number.parseInt(button.dataset.index || '', 10);
    if (!Number.isInteger(index) || index < 0 || index >= references.length) return;
    references.splice(index, 1);
    renderReferences();
    updateRunState();
  });

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    setStatus('Reading images...');
    const maxInputImages = modelMaxInputImages(selectedModel());
    const loaded = await Promise.all(
      Array.from(fileInput.files).slice(0, maxInputImages).map(async (file) => ({
        name: String(file.name || 'image'),
        dataUrl: await readImageAsDataUrl(file),
      }))
    );
    references = await Promise.all(
      loaded
        .filter((image) => image.dataUrl.startsWith('data:image/'))
        .map(async (image) => ({
          ...image,
          ...(await readImageDimensions(image.dataUrl)),
        }))
    );
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
    loadLoras();
  };
  return container;
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

function enumValue(definition, value) {
  const values = enumValues(definition);
  const selectedValue = String(value || '');
  return values.includes(selectedValue) ? selectedValue : enumDefault(definition, values);
}

function formatSizeOption(size) {
  const text = String(size || '').trim();
  const [widthText, heightText] = text.split('x');
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return text || 'Auto';
  }
  if (width === height) {
    return `Square ${text}`;
  }
  return width > height ? `Landscape ${text}` : `Portrait ${text}`;
}

function outputSizeFromReference(image) {
  const width = Number(image?.width);
  const height = Number(image?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return SIZE_BY_ASPECT_RATIO['1:1'];
  }
  const scale = Math.min(1, MAX_MATCHED_INPUT_EDGE / Math.max(width, height));
  const matchedWidth = clampMatchedOutputSize(width * scale);
  const matchedHeight = clampMatchedOutputSize(height * scale);
  return `${matchedWidth}x${matchedHeight}`;
}

function clampMatchedOutputSize(value) {
  const rounded = Math.round(value / OUTPUT_SIZE_MULTIPLE) * OUTPUT_SIZE_MULTIPLE;
  return Math.min(MAX_MATCHED_INPUT_EDGE, Math.max(64, rounded));
}

function readImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
    image.onerror = () => resolve({});
    image.src = dataUrl;
  });
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

function formatResponseStatus(response) {
  const count = Array.isArray(response?.data) ? response.data.length : 0;
  const metrics = response?.metrics && typeof response.metrics === 'object' ? response.metrics : {};
  const backend = String(metrics.backend || '').trim();
  const loraId = String(metrics.lora_id || '').trim();
  const loraScale = Number(metrics.lora_scale || 0);
  const loraText = loraId ? `, LoRA ${loraScale.toFixed(2)}` : '';
  const sampler = String(metrics.sampler || '').trim();
  const samplerText = sampler ? `, ${sampler}` : '';
  const imageStrength = Number(metrics.strength || 0);
  const imageStrengthText = imageStrength > 0 ? `, strength ${imageStrength.toFixed(2)}` : '';
  const wallMs = Number(metrics.pool_total_wall_ms ?? metrics.backend_inference_wall_ms);
  if (Number.isFinite(wallMs)) {
    return backend
      ? `${count} image(s), ${(wallMs / 1000).toFixed(2)}s, ${backend}${samplerText}${loraText}${imageStrengthText}`
      : `${count} image(s), ${(wallMs / 1000).toFixed(2)}s${samplerText}${loraText}${imageStrengthText}`;
  }
  return backend ? `${count} image(s), ${backend}${samplerText}${loraText}${imageStrengthText}` : `${count} image(s)${samplerText}${loraText}${imageStrengthText}`;
}

function formatModelOption(model) {
  const name = model.name || model.id;
  return model.backend ? `${name} (${model.backend})` : name;
}

function formatLoraOption(lora) {
  if (lora.name) return lora.name;
  const run = lora.runId || lora.id;
  const checkpoint = Number.isFinite(lora.checkpointStep) ? ` / step ${lora.checkpointStep}` : '';
  return lora.dataset ? `${lora.dataset} / ${run}${checkpoint}` : `${run}${checkpoint}`;
}
