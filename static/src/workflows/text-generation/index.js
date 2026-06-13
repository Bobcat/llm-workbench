import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const MAX_IMAGES = 4;
const THINKING_MODES = new Set(['default', 'enabled', 'disabled']);

const TEXT_MIME_ALLOWLIST = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
]);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'mjs', 'ts', 'jsx', 'tsx',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini',
  'cfg', 'conf', 'log', 'sql', 'sh', 'bash', 'zsh', 'env',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff']);

function fileExtension(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : '';
}

function classifyFile(file) {
  const type = String(file.type || '').toLowerCase();
  const ext = fileExtension(file.name);
  if (type.startsWith('image/') || (type === '' && IMAGE_EXTENSIONS.has(ext))) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') || TEXT_MIME_ALLOWLIST.has(type)) return 'text';
  if (type === '' && TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'other';
}

function parseImageLimit(definition) {
  const raw = definition?.vllm_limit_mm_per_prompt;
  if (Array.isArray(raw)) {
    const entry = raw.find((pair) => Array.isArray(pair) && String(pair[0]) === 'image');
    const count = entry ? Number(entry[1]) : NaN;
    if (Number.isFinite(count)) return Math.max(0, Math.trunc(count));
  }
  return MAX_IMAGES;
}

export function createTextGenerationView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view text-generation-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <label class="translation-prompts-field">
              <span>Model</span>
              <select id="textGenerationModelSelect"></select>
            </label>
            <div class="text-generation-options-row">
              <div class="translation-prompts-field prompt-runner-remote-field">
                <label class="prompt-runner-remote-toggle">
                  <input id="textGenerationAllowRemote" type="checkbox">
                  <span>Allow remote calls</span>
                </label>
              </div>
              <div class="translation-prompts-field prompt-runner-remote-field">
                <label class="prompt-runner-remote-toggle">
                  <input id="textGenerationEnableThinking" type="checkbox" disabled>
                  <span>Enable thinking</span>
                </label>
              </div>
            </div>
            <details class="translation-prompts-system-details text-generation-settings-details">
              <summary>System prompt &amp; decoding parameters</summary>
              <label class="translation-prompts-field">
                <span>System prompt</span>
                <textarea id="textGenerationSystemPrompt" rows="3" placeholder="<Optional system prompt>"></textarea>
              </label>
              <div class="translation-prompts-language-grid text-generation-decode-grid">
                <label class="translation-prompts-field">
                  <span>Max tokens</span>
                  <input id="textGenerationMaxTokens" type="number" min="1" max="4096" step="1" value="2048">
                </label>
                <label class="translation-prompts-field">
                  <span>Temperature</span>
                  <input id="textGenerationTemperature" type="number" min="0" max="2" step="0.05" placeholder="0.2 (0=greedy)">
                </label>
                <label class="translation-prompts-field">
                  <span>Top-p</span>
                  <input id="textGenerationTopP" type="number" min="0.01" max="1" step="0.01" placeholder="0.95">
                </label>
                <label class="translation-prompts-field">
                  <span>Top-k</span>
                  <input id="textGenerationTopK" type="number" min="1" max="200" step="1" placeholder="1=greedy">
                </label>
              </div>
              <div class="text-generation-settings-actions">
                <button type="button" id="textGenerationResetSettings">Reset to defaults</button>
              </div>
            </details>
            <label class="translation-prompts-field">
              <span>User prompt</span>
              <textarea id="textGenerationUserPrompt" rows="5" placeholder="<User prompt>"></textarea>
            </label>
            <div class="translation-prompts-run-actions">
              <button type="button" id="textGenerationRunBtn">Run</button>
              <button type="button" id="textGenerationAddFilesBtn">Add files</button>
              <input id="textGenerationFileInput" type="file" multiple hidden>
            </div>
            <div class="translation-prompts-inline-status" id="textGenerationStatus">Loading models...</div>
            <div class="text-generation-attachments" id="textGenerationAttachments"></div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <label class="translation-prompts-field translation-prompts-field-response">
              <span>Response</span>
              <textarea id="textGenerationResponse" rows="6" readonly></textarea>
            </label>
            <section class="translation-prompts-stats-block">
              <div class="translation-prompts-stats-grid">
                <div class="translation-prompts-stat">
                  <span>Model</span>
                  <strong id="textGenerationStatModel">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Request</span>
                  <strong id="textGenerationStatRequest">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Files</span>
                  <strong id="textGenerationStatFiles">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Images</span>
                  <strong id="textGenerationStatImages">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Wall</span>
                  <strong id="textGenerationStatWall">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Tok/s</span>
                  <strong id="textGenerationStatTps">-</strong>
                </div>
              </div>
            </section>
            <label class="translation-prompts-field">
              <span>Rendered user prompt</span>
              <textarea id="textGenerationRenderedUserPrompt" rows="6" readonly></textarea>
            </label>
          </section>
        </div>
      </div>
    </div>
  `;

  const modelSelect = container.querySelector('#textGenerationModelSelect');
  const allowRemoteInput = container.querySelector('#textGenerationAllowRemote');
  const enableThinkingInput = container.querySelector('#textGenerationEnableThinking');
  const maxTokensInput = container.querySelector('#textGenerationMaxTokens');
  const temperatureInput = container.querySelector('#textGenerationTemperature');
  const topPInput = container.querySelector('#textGenerationTopP');
  const topKInput = container.querySelector('#textGenerationTopK');
  const systemPromptInput = container.querySelector('#textGenerationSystemPrompt');
  const userPromptInput = container.querySelector('#textGenerationUserPrompt');
  const runBtn = container.querySelector('#textGenerationRunBtn');
  const addFilesBtn = container.querySelector('#textGenerationAddFilesBtn');
  const resetSettingsBtn = container.querySelector('#textGenerationResetSettings');
  const fileInput = container.querySelector('#textGenerationFileInput');
  const statusEl = container.querySelector('#textGenerationStatus');
  const attachmentsEl = container.querySelector('#textGenerationAttachments');
  const responseEl = container.querySelector('#textGenerationResponse');
  const renderedUserPromptEl = container.querySelector('#textGenerationRenderedUserPrompt');
  const statModelEl = container.querySelector('#textGenerationStatModel');
  const statRequestEl = container.querySelector('#textGenerationStatRequest');
  const statFilesEl = container.querySelector('#textGenerationStatFiles');
  const statImagesEl = container.querySelector('#textGenerationStatImages');
  const statWallEl = container.querySelector('#textGenerationStatWall');
  const statTpsEl = container.querySelector('#textGenerationStatTps');

  let adminModels = [];
  let selectedFiles = [];
  let selectedImages = [];
  let isBusy = false;
  let lastThinkingEnabled = false;

  function normalizeThinkingModes(value) {
    const modes = Array.isArray(value)
      ? value
        .map((mode) => String(mode).trim().toLowerCase())
        .filter((mode) => THINKING_MODES.has(mode))
      : [];
    return modes.includes('default') ? [...new Set(modes)] : ['default', ...new Set(modes)];
  }

  function normalizeAdminModelsPayload(payload) {
    const list = Array.isArray(payload?.models) ? payload.models : [];
    return list
      .map((model) => {
        const capabilities = model?.capabilities || {};
        const modalities = Array.isArray(capabilities.modalities)
          ? capabilities.modalities.map((m) => String(m).trim().toLowerCase())
          : ['text'];
        const backend = String(model?.resolved_backend || model?.definition?.backend || '').trim().toLowerCase();
        return {
          id: String(model?.name || '').trim(),
          name: String(model?.name || '').trim(),
          runtimeState: String(model?.runtime_state || 'unloaded').trim().toLowerCase(),
          backend,
          isRemote: backend === 'openai_compatible',
          supportsImage: modalities.includes('image'),
          thinkingModes: normalizeThinkingModes(capabilities.thinking_modes),
          imageLimit: parseImageLimit(model?.definition),
        };
      })
      .filter((model) => model.id !== '');
  }

  function isLoadedRuntime(state) {
    return String(state || '').trim().toLowerCase() === 'loaded';
  }

  function loadedModels() {
    return adminModels
      .filter((model) => isLoadedRuntime(model.runtimeState))
      .sort((left, right) => left.name.localeCompare(right.name, 'nl', { sensitivity: 'base' }));
  }

  function selectedModel() {
    const selectedId = String(modelSelect.value || '');
    return adminModels.find((model) => model.id === selectedId) || null;
  }

  function setStatus(message) {
    statusEl.textContent = String(message || '');
  }

  function selectedModelSupportsThinking() {
    const model = selectedModel();
    const modes = model?.thinkingModes || ['default'];
    return modes.includes('enabled') && modes.includes('disabled');
  }

  function renderThinkingControl() {
    const supportsThinking = selectedModelSupportsThinking();
    enableThinkingInput.checked = supportsThinking ? lastThinkingEnabled : false;
    enableThinkingInput.disabled = isBusy || !supportsThinking;
  }

  function selectedThinkingMode() {
    if (!selectedModelSupportsThinking()) return 'default';
    return enableThinkingInput.checked ? 'enabled' : 'disabled';
  }

  function attachmentModelIssue() {
    const model = selectedModel();
    if (!model || selectedImages.length === 0) return '';
    if (!model.supportsImage) {
      return 'Selected model cannot read the attached images.';
    }
    if (selectedImages.length > model.imageLimit) {
      return `Selected model accepts at most ${model.imageLimit} image(s).`;
    }
    return '';
  }

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    const noModels = loadedModels().length === 0;
    modelSelect.disabled = nextBusy;
    allowRemoteInput.disabled = nextBusy;
    maxTokensInput.disabled = nextBusy;
    temperatureInput.disabled = nextBusy;
    topPInput.disabled = nextBusy;
    topKInput.disabled = nextBusy;
    systemPromptInput.disabled = nextBusy;
    userPromptInput.disabled = nextBusy;
    resetSettingsBtn.disabled = nextBusy;
    runBtn.disabled = nextBusy || noModels || attachmentModelIssue() !== '';
    addFilesBtn.disabled = nextBusy || noModels;
    renderThinkingControl();
  }

  function clearStats() {
    statModelEl.textContent = '-';
    statRequestEl.textContent = '-';
    statFilesEl.textContent = '-';
    statImagesEl.textContent = '-';
    statWallEl.textContent = '-';
    statTpsEl.textContent = '-';
  }

  function applyStats(result) {
    const metrics = result?.metrics || {};
    statModelEl.textContent = result?.model || '-';
    statRequestEl.textContent = result?.request_id || '-';
    statFilesEl.textContent = result?.file_count != null ? String(result.file_count) : '-';
    statImagesEl.textContent = result?.image_count != null ? String(result.image_count) : '-';
    statWallEl.textContent = metrics.transport_completed_ms != null
      ? `${Number(metrics.transport_completed_ms).toFixed(1)} ms`
      : '-';
    statTpsEl.textContent = metrics.engine_tokens_per_second != null
      ? Number(metrics.engine_tokens_per_second).toFixed(1)
      : '-';
  }

  function buildRenderedUserPrompt() {
    const promptText = String(userPromptInput.value || '')
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '');
    const parts = [];
    if (promptText !== '') {
      parts.push(promptText);
    }
    if (selectedFiles.length > 0) {
      parts.push('ATTACHMENTS:');
      selectedFiles.forEach((file) => {
        const content = String(file.content || '')
          .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '');
        parts.push(`Name: ${file.name}`);
        parts.push('Contents:');
        parts.push('=====');
        parts.push(content);
        parts.push('=====');
      });
    }
    return parts.join('\n');
  }

  function renderUserPromptPreview() {
    renderedUserPromptEl.value = buildRenderedUserPrompt();
  }

  function renderAttachments() {
    if (selectedFiles.length === 0 && selectedImages.length === 0) {
      attachmentsEl.innerHTML = '<span class="text-generation-attachment-empty">No files added.</span>';
      return;
    }
    const fileMarkup = selectedFiles.map((file, index) => `
      <span class="prompt-runner-file-item text-generation-file-item">
        <span class="material-symbols-outlined" aria-hidden="true">description</span>
        <span class="prompt-runner-file-name">${escapeHtml(file.name)}</span>
        <button
          type="button"
          class="text-generation-attachment-remove prompt-runner-file-remove"
          data-kind="file"
          data-index="${index}"
          aria-label="Remove ${escapeAttr(file.name)}"
          title="Remove ${escapeAttr(file.name)}"
        ><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
      </span>
    `).join('');
    const imageMarkup = selectedImages.map((image, index) => `
      <figure class="text-generation-image-item">
        <img src="${escapeAttr(image.dataUrl)}" alt="${escapeAttr(image.name)}">
        <button
          type="button"
          class="text-generation-attachment-remove text-generation-image-remove"
          data-kind="image"
          data-index="${index}"
          aria-label="Remove ${escapeAttr(image.name)}"
          title="Remove ${escapeAttr(image.name)}"
        ><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
        <figcaption>${escapeHtml(image.name)}</figcaption>
      </figure>
    `).join('');
    attachmentsEl.innerHTML = `${fileMarkup}${imageMarkup}`;
  }

  function renderModelOptions() {
    const models = loadedModels();
    const previous = String(modelSelect.value || '');
    modelSelect.innerHTML = models.length > 0
      ? models.map((model) => {
        const tags = [];
        if (model.isRemote) tags.push('remote');
        if (model.supportsImage) tags.push('vision');
        const label = tags.length ? `${model.name} · ${tags.join(', ')}` : model.name;
        return `<option value="${escapeAttr(model.id)}">${escapeHtml(label)}</option>`;
      }).join('')
      : '<option value="">No loaded models</option>';
    if (models.some((model) => model.id === previous)) {
      modelSelect.value = previous;
    }
    renderThinkingControl();
    setBusy(isBusy);
  }

  async function loadModels() {
    setBusy(true);
    setStatus('Loading models...');
    try {
      adminModels = normalizeAdminModelsPayload(await api.getAdminModels());
      renderModelOptions();
      if (loadedModels().length === 0) {
        setStatus('No loaded models available.');
      } else {
        setStatus(attachmentModelIssue());
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

  async function addFiles(fileList) {
    const model = selectedModel();
    const rejected = [];
    for (const file of Array.from(fileList)) {
      const kind = classifyFile(file);
      if (kind === 'image') {
        if (!model?.supportsImage) {
          rejected.push(`${file.name} (this model cannot read images)`);
          continue;
        }
        if (selectedImages.length >= model.imageLimit) {
          rejected.push(`${file.name} (this model accepts at most ${model.imageLimit} image(s))`);
          continue;
        }
        const dataUrl = await readImageAsDataUrl(file);
        if (dataUrl.startsWith('data:image/')) {
          selectedImages.push({ name: String(file.name || 'image'), dataUrl });
        }
      } else if (kind === 'text') {
        selectedFiles.push({
          name: String(file.name || 'attachment.txt'),
          content: await file.text(),
        });
      } else {
        rejected.push(`${file.name} (${kind} files are not supported)`);
      }
    }
    renderAttachments();
    renderUserPromptPreview();
    const modelIssue = attachmentModelIssue();
    setStatus(rejected.length ? `Skipped: ${rejected.join('; ')}` : modelIssue);
  }

  function optionalFloat(el) {
    const raw = el.value.trim();
    if (raw === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }

  function optionalInt(el) {
    const raw = el.value.trim();
    if (raw === '') return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
  }

  function readDecode() {
    return {
      max_tokens: Math.max(1, Math.min(4096, Number.parseInt(maxTokensInput.value, 10) || 2048)),
      temperature: optionalFloat(temperatureInput),
      top_p: optionalFloat(topPInput),
      top_k: optionalInt(topKInput),
    };
  }

  function resetSettings() {
    systemPromptInput.value = '';
    maxTokensInput.value = '2048';
    temperatureInput.value = '';
    topPInput.value = '';
    topKInput.value = '';
  }

  async function runTextGeneration() {
    const model = selectedModel();
    if (!model) {
      setStatus('Select a loaded model.');
      return;
    }
    const allowRemote = Boolean(allowRemoteInput.checked);
    if (model.isRemote && !allowRemote) {
      setStatus('Enable remote calls for this model.');
      return;
    }
    const issue = attachmentModelIssue();
    if (issue) {
      setStatus(issue);
      return;
    }
    const renderedPrompt = buildRenderedUserPrompt();
    if (renderedPrompt.trim() === '' && selectedImages.length === 0) {
      setStatus('Type a prompt or add a file.');
      return;
    }

    setBusy(true);
    setStatus(selectedThinkingMode() === 'enabled' ? 'Thinking...' : 'Running prompt...');
    try {
      const decode = readDecode();
      const result = await api.runTextGeneration({
        model: model.id,
        system_prompt: String(systemPromptInput.value || ''),
        user_prompt: String(userPromptInput.value || ''),
        allow_remote: allowRemote,
        thinking: selectedThinkingMode(),
        max_tokens: decode.max_tokens,
        temperature: decode.temperature,
        top_p: decode.top_p,
        top_k: decode.top_k,
        files: selectedFiles.map((file) => ({
          name: file.name,
          content: file.content,
        })),
        images: selectedImages.map((image) => ({
          name: image.name,
          data_url: image.dataUrl,
        })),
      });
      responseEl.value = String(result?.output_text || '');
      renderedUserPromptEl.value = String(result?.rendered_user_prompt ?? renderedPrompt);
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
    renderThinkingControl();
    setStatus(attachmentModelIssue());
    setBusy(isBusy);
  });

  enableThinkingInput.addEventListener('change', () => {
    if (!enableThinkingInput.disabled) {
      lastThinkingEnabled = Boolean(enableThinkingInput.checked);
    }
  });

  userPromptInput.addEventListener('input', () => {
    renderUserPromptPreview();
  });

  resetSettingsBtn.addEventListener('click', () => {
    if (!isBusy) resetSettings();
  });

  runBtn.addEventListener('click', () => {
    runTextGeneration();
  });

  addFilesBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  attachmentsEl.addEventListener('click', (event) => {
    const button = event.target.closest('.text-generation-attachment-remove');
    if (!button || isBusy) return;
    const index = Number.parseInt(button.dataset.index || '', 10);
    if (!Number.isInteger(index)) return;
    if (button.dataset.kind === 'image') {
      if (index >= 0 && index < selectedImages.length) selectedImages.splice(index, 1);
    } else if (index >= 0 && index < selectedFiles.length) {
      selectedFiles.splice(index, 1);
    }
    renderAttachments();
    renderUserPromptPreview();
    setStatus(attachmentModelIssue());
    setBusy(isBusy);
  });

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    setBusy(true);
    setStatus('Reading files...');
    try {
      await addFiles(fileInput.files);
    } catch (err) {
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  });

  renderAttachments();
  renderUserPromptPreview();
  clearStats();

  container.__onActivate = () => {
    loadModels();
  };

  return container;
}
