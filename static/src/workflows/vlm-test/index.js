import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const MAX_IMAGES = 4;

export function createVlmTestView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view vlm-test-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <label class="translation-prompts-field">
              <span>Model</span>
              <select id="vlmModelSelect"></select>
            </label>
            <div class="translation-prompts-field prompt-runner-remote-field">
              <label class="prompt-runner-remote-toggle">
                <input id="vlmAllowRemote" type="checkbox">
                <span>Allow remote calls</span>
              </label>
            </div>
            <label class="translation-prompts-field vlm-max-tokens-field">
              <span>Max output tokens</span>
              <input id="vlmMaxTokens" type="number" min="1" max="4096" step="1" value="2048">
            </label>
            <label class="translation-prompts-field">
              <span>System prompt</span>
              <textarea id="vlmSystemPrompt" rows="3" placeholder="<Optional system prompt>"></textarea>
            </label>
            <label class="translation-prompts-field">
              <span>Question</span>
              <textarea id="vlmUserPrompt" rows="4" placeholder="Describe this image in English."></textarea>
            </label>
            <div class="translation-prompts-run-actions">
              <button type="button" id="vlmRunBtn">Run</button>
              <button type="button" id="vlmAddImagesBtn">Add images</button>
              <input id="vlmImageInput" type="file" accept="image/*" multiple hidden>
            </div>
            <div class="translation-prompts-inline-status" id="vlmStatus">Loading models...</div>
            <div class="vlm-image-strip" id="vlmImages"></div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <label class="translation-prompts-field translation-prompts-field-response">
              <span>Response</span>
              <textarea id="vlmResponse" rows="6" readonly></textarea>
            </label>
            <section class="translation-prompts-stats-block">
              <div class="translation-prompts-stats-grid">
                <div class="translation-prompts-stat">
                  <span>Model</span>
                  <strong id="vlmStatModel">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Images</span>
                  <strong id="vlmStatImages">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Wall</span>
                  <strong id="vlmStatWall">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Tok/s</span>
                  <strong id="vlmStatTps">-</strong>
                </div>
              </div>
            </section>
          </section>
        </div>
      </div>
    </div>
  `;

  const modelSelect = container.querySelector('#vlmModelSelect');
  const allowRemoteInput = container.querySelector('#vlmAllowRemote');
  const maxTokensInput = container.querySelector('#vlmMaxTokens');
  const systemPromptInput = container.querySelector('#vlmSystemPrompt');
  const userPromptInput = container.querySelector('#vlmUserPrompt');
  const runBtn = container.querySelector('#vlmRunBtn');
  const addImagesBtn = container.querySelector('#vlmAddImagesBtn');
  const imageInput = container.querySelector('#vlmImageInput');
  const statusEl = container.querySelector('#vlmStatus');
  const imagesEl = container.querySelector('#vlmImages');
  const responseEl = container.querySelector('#vlmResponse');
  const statModelEl = container.querySelector('#vlmStatModel');
  const statImagesEl = container.querySelector('#vlmStatImages');
  const statWallEl = container.querySelector('#vlmStatWall');
  const statTpsEl = container.querySelector('#vlmStatTps');

  let adminModels = [];
  let selectedImages = [];
  let isBusy = false;

  function normalizeAdminModelsPayload(payload) {
    const list = Array.isArray(payload?.models) ? payload.models : [];
    return list
      .map((model) => {
        const modalities = Array.isArray(model?.capabilities?.modalities)
          ? model.capabilities.modalities.map((m) => String(m).trim().toLowerCase())
          : ['text'];
        return {
          id: String(model?.name || '').trim(),
          name: String(model?.name || '').trim(),
          runtimeState: String(model?.runtime_state || 'unloaded').trim().toLowerCase(),
          isRemote: String(model?.resolved_backend || model?.definition?.backend || '').trim().toLowerCase() === 'openai_compatible',
          supportsImage: modalities.includes('image'),
        };
      })
      .filter((model) => model.id !== '');
  }

  function isLoadedRuntime(state) {
    return String(state || '').trim().toLowerCase() === 'loaded';
  }

  function visionModels() {
    return adminModels
      .filter((model) => isLoadedRuntime(model.runtimeState) && model.supportsImage)
      .sort((left, right) => left.name.localeCompare(right.name, 'nl', { sensitivity: 'base' }));
  }

  function selectedModel() {
    const selectedId = String(modelSelect.value || '');
    return adminModels.find((model) => model.id === selectedId) || null;
  }

  function setStatus(message) {
    statusEl.textContent = String(message || '');
  }

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    modelSelect.disabled = nextBusy;
    allowRemoteInput.disabled = nextBusy;
    maxTokensInput.disabled = nextBusy;
    systemPromptInput.disabled = nextBusy;
    userPromptInput.disabled = nextBusy;
    const noModels = visionModels().length === 0;
    runBtn.disabled = nextBusy || noModels || selectedImages.length === 0;
    addImagesBtn.disabled = nextBusy || selectedImages.length >= MAX_IMAGES;
  }

  function clearStats() {
    statModelEl.textContent = '-';
    statImagesEl.textContent = '-';
    statWallEl.textContent = '-';
    statTpsEl.textContent = '-';
  }

  function applyStats(result) {
    const metrics = result?.metrics || {};
    statModelEl.textContent = result?.model || '-';
    statImagesEl.textContent = result?.image_count != null ? String(result.image_count) : '-';
    statWallEl.textContent = metrics.transport_completed_ms != null
      ? `${Number(metrics.transport_completed_ms).toFixed(1)} ms`
      : '-';
    statTpsEl.textContent = metrics.engine_tokens_per_second != null
      ? Number(metrics.engine_tokens_per_second).toFixed(1)
      : '-';
  }

  function renderImages() {
    if (selectedImages.length === 0) {
      imagesEl.innerHTML = '<span class="vlm-image-empty">No images added.</span>';
      return;
    }
    imagesEl.innerHTML = selectedImages.map((image, index) => `
      <figure class="vlm-image-item">
        <img src="${escapeAttr(image.dataUrl)}" alt="${escapeAttr(image.name)}">
        <button
          type="button"
          class="vlm-image-remove"
          data-image-index="${index}"
          aria-label="Remove ${escapeAttr(image.name)}"
          title="Remove ${escapeAttr(image.name)}"
        ><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
        <figcaption>${escapeHtml(image.name)}</figcaption>
      </figure>
    `).join('');
  }

  function renderModelOptions() {
    const models = visionModels();
    const previous = String(modelSelect.value || '');
    modelSelect.innerHTML = models.length > 0
      ? models.map((model) => {
        const label = model.isRemote ? `${model.name} · remote` : model.name;
        return `<option value="${escapeAttr(model.id)}">${escapeHtml(label)}</option>`;
      }).join('')
      : '<option value="">No vision models loaded</option>';
    if (models.some((model) => model.id === previous)) {
      modelSelect.value = previous;
    }
    setBusy(isBusy);
  }

  async function loadModels() {
    setBusy(true);
    setStatus('Loading models...');
    try {
      adminModels = normalizeAdminModelsPayload(await api.getAdminModels());
      renderModelOptions();
      if (visionModels().length === 0) {
        setStatus('No loaded vision models. Load a model with image capability in llm-pool.');
      } else {
        setStatus('');
      }
    } catch (err) {
      adminModels = [];
      renderModelOptions();
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
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

  async function addImages(fileList) {
    const remaining = MAX_IMAGES - selectedImages.length;
    const files = Array.from(fileList).slice(0, Math.max(0, remaining));
    const loaded = await Promise.all(
      files.map(async (file) => ({
        name: String(file.name || 'image'),
        dataUrl: await readImageAsDataUrl(file),
      }))
    );
    selectedImages = selectedImages.concat(
      loaded.filter((image) => image.dataUrl.startsWith('data:image/'))
    );
    renderImages();
  }

  async function runPrompt() {
    const model = String(modelSelect.value || '').trim();
    if (model === '') {
      setStatus('Select a loaded vision model.');
      return;
    }
    if (selectedImages.length === 0) {
      setStatus('Add at least one image.');
      return;
    }
    const modelInfo = selectedModel();
    const allowRemote = Boolean(allowRemoteInput.checked);
    if (modelInfo?.isRemote && !allowRemote) {
      setStatus('Enable remote calls for this model.');
      return;
    }

    setBusy(true);
    setStatus('Running prompt...');
    try {
      const maxTokens = Math.max(1, Math.min(4096, Number.parseInt(maxTokensInput.value, 10) || 2048));
      const result = await api.runVlmPrompt({
        model,
        system_prompt: String(systemPromptInput.value || ''),
        user_prompt: String(userPromptInput.value || ''),
        allow_remote: allowRemote,
        max_tokens: maxTokens,
        images: selectedImages.map((image) => ({
          name: image.name,
          data_url: image.dataUrl,
        })),
      });
      responseEl.value = String(result?.output_text || '');
      applyStats(result);
      setStatus('');
    } catch (err) {
      responseEl.value = '';
      clearStats();
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  modelSelect.addEventListener('change', () => {
    setBusy(isBusy);
  });

  runBtn.addEventListener('click', () => {
    runPrompt();
  });

  addImagesBtn.addEventListener('click', () => {
    imageInput.value = '';
    imageInput.click();
  });

  imagesEl.addEventListener('click', (event) => {
    const button = event.target.closest('.vlm-image-remove');
    if (!button || isBusy) return;
    const index = Number.parseInt(button.dataset.imageIndex || '', 10);
    if (!Number.isInteger(index) || index < 0 || index >= selectedImages.length) return;
    selectedImages.splice(index, 1);
    renderImages();
    setBusy(isBusy);
  });

  imageInput.addEventListener('change', async () => {
    if (!imageInput.files || imageInput.files.length === 0) return;
    setBusy(true);
    setStatus('Reading images...');
    try {
      await addImages(imageInput.files);
      setStatus('');
    } catch (err) {
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  });

  renderImages();
  clearStats();
  loadModels();

  return container;
}
