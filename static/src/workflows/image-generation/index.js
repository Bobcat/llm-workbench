import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const SIZE_BY_ASPECT_RATIO = {
  '1:1': '512x512',
  '4:3': '768x576',
  '3:4': '576x768',
  '16:9': '1024x576',
  '9:16': '576x1024',
};
const MAX_MATCHED_INPUT_EDGE = 1024;
const OUTPUT_SIZE_MULTIPLE = 8;

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
              <summary>Generation parameters</summary>
              <div class="translation-prompts-language-grid image-generation-params-grid">
                <label class="translation-prompts-field">
                  <span>Output size</span>
                  <select id="imageGenerationAspectRatio">
                    <option value="1:1">Square 512x512</option>
                    <option value="match-input" disabled>Match input shape</option>
                    <option value="4:3">Landscape 768x576</option>
                    <option value="3:4">Portrait 576x768</option>
                    <option value="16:9">Wide 1024x576</option>
                    <option value="9:16">Tall 576x1024</option>
                  </select>
                </label>
                <label class="translation-prompts-field">
                  <span>Images</span>
                  <input id="imageGenerationCount" type="number" min="1" max="4" step="1" value="1">
                </label>
                <label class="translation-prompts-field">
                  <span>Steps</span>
                  <input id="imageGenerationSteps" type="number" min="1" max="80" step="1" value="4">
                </label>
                <label class="translation-prompts-field">
                  <span>Guidance</span>
                  <input id="imageGenerationGuidance" type="number" min="0" max="20" step="0.5" value="1">
                </label>
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
            <label class="image-generation-output-zoom">
              <span>Preview size</span>
              <input id="imageGenerationOutputZoom" type="range" min="25" max="200" step="5" value="100">
              <output id="imageGenerationOutputZoomValue">100%</output>
            </label>
            <section class="image-generation-output" id="imageGenerationOutput" aria-label="Output">
              <span class="image-generation-output-empty">No image generated.</span>
            </section>
          </section>
        </div>
      </div>
    </div>
  `;

  const modelSelect = container.querySelector('#imageGenerationModelSelect');
  const promptEl = container.querySelector('#imageGenerationPrompt');
  const aspectRatioEl = container.querySelector('#imageGenerationAspectRatio');
  const countEl = container.querySelector('#imageGenerationCount');
  const stepsEl = container.querySelector('#imageGenerationSteps');
  const guidanceEl = container.querySelector('#imageGenerationGuidance');
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
    return inputModalities.includes('image') && tasks.includes('image_edit');
  }

  function modelMaxInputImages(model) {
    const parsed = Number.parseInt(model?.capabilities?.max_images, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 4;
  }

  function modelMaxOutputImages(model) {
    const parsed = Number.parseInt(model?.capabilities?.max_output_images, 10);
    return Number.isFinite(parsed) ? Math.max(1, parsed) : 4;
  }

  function updateRunState() {
    const model = selectedModel();
    runBtn.disabled = isRunning || !selectedModelId();
    const supportsImageInput = modelSupportsImageInput(model);
    const maxInputImages = modelMaxInputImages(model);
    const maxOutputImages = modelMaxOutputImages(model);
    countEl.max = String(maxOutputImages);
    const clampedOutputImages = clampInt(countEl.value, 1, maxOutputImages, 1);
    if (clampedOutputImages !== Number.parseInt(countEl.value, 10)) {
      countEl.value = String(clampedOutputImages);
    }
    addFilesBtn.disabled = isRunning || !supportsImageInput;
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
      aspectRatioEl.value = '1:1';
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
    updateRunState();
    renderReferences();
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

  function buildPayload() {
    const prompt = String(promptEl.value || '').trim();
    const outputSizeMode = String(aspectRatioEl.value || '1:1');
    const n = clampInt(countEl.value, 1, 4, 1);
    const steps = clampInt(stepsEl.value, 1, 80, 4);
    const guidance = clampNumber(guidanceEl.value, 0, 20, 1);
    const size = outputSizeMode === 'match-input'
      ? outputSizeFromReference(references[0])
      : SIZE_BY_ASPECT_RATIO[outputSizeMode] || SIZE_BY_ASPECT_RATIO['1:1'];
    return {
      model: selectedModelId(),
      prompt,
      n,
      size,
      metadata: {
        output_size_mode: outputSizeMode,
        steps,
        guidance,
      },
    };
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
    setStatus(references.length > 0 ? 'Editing image...' : 'Generating image...');
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
    updateRunState();
    renderReferences();
  });
  promptEl.addEventListener('input', updateRunState);
  outputZoomEl.addEventListener('input', updateOutputZoom);
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
  };
  return container;
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

function formatResponseStatus(response) {
  const count = Array.isArray(response?.data) ? response.data.length : 0;
  const metrics = response?.metrics && typeof response.metrics === 'object' ? response.metrics : {};
  const backend = String(metrics.backend || '').trim();
  const wallMs = Number(metrics.pool_total_wall_ms ?? metrics.backend_inference_wall_ms);
  if (Number.isFinite(wallMs)) {
    return backend
      ? `${count} image(s), ${(wallMs / 1000).toFixed(2)}s, ${backend}`
      : `${count} image(s), ${(wallMs / 1000).toFixed(2)}s`;
  }
  return backend ? `${count} image(s), ${backend}` : `${count} image(s)`;
}

function formatModelOption(model) {
  const name = model.name || model.id;
  return model.backend ? `${name} (${model.backend})` : name;
}
