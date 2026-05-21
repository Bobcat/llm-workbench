import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

export function createPromptRunnerView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view prompt-runner-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <label class="translation-prompts-field">
              <span>Model</span>
              <select id="promptRunnerModelSelect"></select>
            </label>
            <div class="translation-prompts-field prompt-runner-remote-field">
              <label class="prompt-runner-remote-toggle">
                <input id="promptRunnerAllowRemote" type="checkbox">
                <span>Allow remote calls</span>
              </label>
            </div>
            <label class="translation-prompts-field">
              <span>System prompt</span>
              <textarea id="promptRunnerSystemPrompt" rows="4" placeholder="<Optional system prompt>"></textarea>
            </label>
            <label class="translation-prompts-field">
              <span>User prompt</span>
              <textarea id="promptRunnerUserPrompt" rows="6" placeholder="<User prompt>"></textarea>
            </label>
            <div class="translation-prompts-run-actions">
              <button type="button" id="promptRunnerRunBtn">Run</button>
              <button type="button" id="promptRunnerAddFilesBtn">Add files</button>
              <input id="promptRunnerFileInput" type="file" multiple hidden>
            </div>
            <div class="translation-prompts-inline-status" id="promptRunnerStatus">Loading models...</div>
            <div class="translation-prompts-inline-status prompt-runner-files" id="promptRunnerFiles">No files added.</div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <label class="translation-prompts-field translation-prompts-field-response">
              <span>Response</span>
              <textarea id="promptRunnerResponse" rows="6" readonly></textarea>
            </label>
            <section class="translation-prompts-stats-block">
              <div class="translation-prompts-stats-grid">
                <div class="translation-prompts-stat">
                  <span>Model</span>
                  <strong id="promptRunnerStatModel">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Request</span>
                  <strong id="promptRunnerStatRequest">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Wall</span>
                  <strong id="promptRunnerStatWall">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Tok/s</span>
                  <strong id="promptRunnerStatTps">-</strong>
                </div>
              </div>
            </section>
            <label class="translation-prompts-field">
              <span>Rendered user prompt</span>
              <textarea id="promptRunnerRenderedUserPrompt" rows="6" readonly></textarea>
            </label>
          </section>
        </div>
      </div>
    </div>
  `;

  const modelSelect = container.querySelector('#promptRunnerModelSelect');
  const allowRemoteInput = container.querySelector('#promptRunnerAllowRemote');
  const systemPromptInput = container.querySelector('#promptRunnerSystemPrompt');
  const userPromptInput = container.querySelector('#promptRunnerUserPrompt');
  const runBtn = container.querySelector('#promptRunnerRunBtn');
  const addFilesBtn = container.querySelector('#promptRunnerAddFilesBtn');
  const fileInput = container.querySelector('#promptRunnerFileInput');
  const statusEl = container.querySelector('#promptRunnerStatus');
  const filesEl = container.querySelector('#promptRunnerFiles');
  const responseEl = container.querySelector('#promptRunnerResponse');
  const renderedUserPromptEl = container.querySelector('#promptRunnerRenderedUserPrompt');
  const statModelEl = container.querySelector('#promptRunnerStatModel');
  const statRequestEl = container.querySelector('#promptRunnerStatRequest');
  const statWallEl = container.querySelector('#promptRunnerStatWall');
  const statTpsEl = container.querySelector('#promptRunnerStatTps');

  let adminModels = [];
  let selectedFiles = [];
  let isBusy = false;

  function normalizeAdminModelsPayload(payload) {
    const list = Array.isArray(payload?.models) ? payload.models : [];
    return list
      .map((model) => ({
        id: String(model?.name || '').trim(),
        name: String(model?.name || '').trim(),
        runtimeState: String(model?.runtime_state || 'unloaded').trim().toLowerCase(),
        isRemote: String(model?.resolved_backend || model?.definition?.backend || '').trim().toLowerCase() === 'openai_compatible',
      }))
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

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    modelSelect.disabled = nextBusy;
    allowRemoteInput.disabled = nextBusy;
    systemPromptInput.disabled = nextBusy;
    userPromptInput.disabled = nextBusy;
    runBtn.disabled = nextBusy || loadedModels().length === 0;
    addFilesBtn.disabled = nextBusy;
  }

  function clearStats() {
    statModelEl.textContent = '-';
    statRequestEl.textContent = '-';
    statWallEl.textContent = '-';
    statTpsEl.textContent = '-';
  }

  function applyStats(result) {
    const metrics = result?.metrics || {};
    statModelEl.textContent = result?.model || '-';
    statRequestEl.textContent = result?.request_id || '-';
    statWallEl.textContent = metrics.transport_completed_ms != null
      ? `${Number(metrics.transport_completed_ms).toFixed(1)} ms`
      : '-';
    statTpsEl.textContent = metrics.engine_tokens_per_second != null
      ? Number(metrics.engine_tokens_per_second).toFixed(1)
      : '-';
  }

  function buildRenderedUserPrompt() {
    const promptText = String(userPromptInput.value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '');
    const parts = [];
    if (promptText !== '') {
      parts.push(promptText);
    }
    if (selectedFiles.length > 0) {
      parts.push('ATTACHMENTS:');
      selectedFiles.forEach((file) => {
        const content = String(file.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '');
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

  function renderFilesSummary() {
    if (selectedFiles.length === 0) {
      filesEl.textContent = 'No files added.';
      return;
    }
    filesEl.innerHTML = `
      <span class="prompt-runner-files-label">Files:</span>
      <span class="prompt-runner-file-list">
        ${selectedFiles.map((file, index) => `
          <span class="prompt-runner-file-item">
            <span class="prompt-runner-file-name">${escapeHtml(file.name)}</span>
            <button
              type="button"
              class="prompt-runner-file-remove"
              data-file-index="${index}"
              aria-label="Remove ${escapeAttr(file.name)}"
              title="Remove ${escapeAttr(file.name)}"
            ><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
          </span>
        `).join('')}
      </span>
    `;
  }

  function renderModelOptions() {
    const loaded = loadedModels();
    const previous = String(modelSelect.value || '');
    modelSelect.innerHTML = loaded.length > 0
      ? loaded.map((model) => {
        const label = model.isRemote ? `${model.name} · remote` : model.name;
        return `<option value="${escapeAttr(model.id)}">${escapeHtml(label)}</option>`;
      }).join('')
      : '<option value="">No loaded models</option>';
    if (loaded.some((model) => model.id === previous)) {
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
      if (loadedModels().length === 0) {
        setStatus('No loaded models available.');
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

  async function readSelectedFiles(fileList) {
    return Promise.all(
      Array.from(fileList).map(async (file) => ({
        name: String(file.name || 'attachment.txt'),
        content: await file.text(),
      }))
    );
  }

  async function runPrompt() {
    const model = String(modelSelect.value || '').trim();
    if (model === '') {
      setStatus('Select a loaded model.');
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
      const result = await api.runPrompt({
        model,
        system_prompt: String(systemPromptInput.value || ''),
        user_prompt: String(userPromptInput.value || ''),
        allow_remote: allowRemote,
        files: selectedFiles.map((file) => ({
          name: file.name,
          content: file.content,
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

  userPromptInput.addEventListener('input', () => {
    renderUserPromptPreview();
  });

  runBtn.addEventListener('click', () => {
    runPrompt();
  });

  addFilesBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  filesEl.addEventListener('click', (event) => {
    const button = event.target.closest('.prompt-runner-file-remove');
    if (!button || isBusy) return;
    const index = Number.parseInt(button.dataset.fileIndex || '', 10);
    if (!Number.isInteger(index) || index < 0 || index >= selectedFiles.length) return;
    selectedFiles.splice(index, 1);
    renderFilesSummary();
    renderUserPromptPreview();
  });

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files || fileInput.files.length === 0) return;
    setBusy(true);
    setStatus('Reading files...');
    try {
      selectedFiles = await readSelectedFiles(fileInput.files);
      renderFilesSummary();
      renderUserPromptPreview();
      setStatus('');
    } catch (err) {
      selectedFiles = [];
      renderFilesSummary();
      renderUserPromptPreview();
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  });

  renderFilesSummary();
  renderUserPromptPreview();
  clearStats();
  loadModels();

  return container;
}
