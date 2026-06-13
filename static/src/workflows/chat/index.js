import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const MAX_IMAGES_PER_TURN = 4;
const THINKING_MODES = new Set(['default', 'enabled', 'disabled']);

// System prompt + decode params persist across refreshes/boots (not the model
// or allow-remote, which are per-session choices).
const SETTINGS_STORAGE_KEY = 'llm-workbench.chat.settings';
const DEFAULT_SETTINGS = {
  systemPrompt: '',
  maxTokens: '2048',
  temperature: '',
  topP: '',
  topK: '',
};

function loadChatSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || 'null');
    if (parsed && typeof parsed === 'object') {
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore malformed or unavailable storage
  }
  return { ...DEFAULT_SETTINGS };
}

// The chosen model persists separately from the reset-able decode settings.
const MODEL_STORAGE_KEY = 'llm-workbench.chat.model';

function loadStoredModel() {
  try {
    return String(window.localStorage.getItem(MODEL_STORAGE_KEY) || '');
  } catch {
    return '';
  }
}

function saveStoredModel(id) {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, String(id || ''));
  } catch {
    // ignore unavailable storage
  }
}

// Text-like files are flattened into the message text; images become image
// content; everything else is rejected (e.g. audio, until a model advertises it).
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

function fileExtension(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : '';
}

function classifyFile(file) {
  const type = String(file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') || TEXT_MIME_ALLOWLIST.has(type)) return 'text';
  if (type === '' && TEXT_EXTENSIONS.has(fileExtension(file.name))) return 'text';
  return 'other';
}

// vLLM models report a per-prompt image cap as [["image", N], ...]. In a
// multi-turn request the whole history is one prompt, so this caps the images
// across the conversation. Defaults to MAX_IMAGES_PER_TURN when unspecified.
function parseImageLimit(definition) {
  const raw = definition?.vllm_limit_mm_per_prompt;
  if (Array.isArray(raw)) {
    const entry = raw.find((pair) => Array.isArray(pair) && String(pair[0]) === 'image');
    const count = entry ? Number(entry[1]) : NaN;
    if (Number.isFinite(count)) return Math.max(0, Math.trunc(count));
  }
  return MAX_IMAGES_PER_TURN;
}

export function createChatView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view chat-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main chat-main">
        <section class="chat-settings">
          <label class="translation-prompts-field">
            <span>Model</span>
            <select id="chatModelSelect"></select>
          </label>
          <div class="chat-toggle-row">
            <div class="translation-prompts-field prompt-runner-remote-field">
              <label class="prompt-runner-remote-toggle">
                <input id="chatAllowRemote" type="checkbox">
                <span>Allow remote calls</span>
              </label>
            </div>
            <div class="translation-prompts-field prompt-runner-remote-field">
              <label class="prompt-runner-remote-toggle">
                <input id="chatEnableThinking" type="checkbox" disabled>
                <span>Enable thinking</span>
              </label>
            </div>
          </div>
          <details class="translation-prompts-system-details">
            <summary>System prompt &amp; decoding parameters</summary>
            <label class="translation-prompts-field">
              <span>System prompt</span>
              <textarea id="chatSystemPrompt" rows="2" placeholder="<Optional system prompt>"></textarea>
            </label>
            <div class="translation-prompts-language-grid vlm-decode-grid">
              <label class="translation-prompts-field">
                <span>Max tokens</span>
                <input id="chatMaxTokens" type="number" min="1" max="4096" step="1" value="2048">
              </label>
              <label class="translation-prompts-field">
                <span>Temperature</span>
                <input id="chatTemperature" type="number" min="0" max="2" step="0.05" placeholder="0.2 (0=greedy)">
              </label>
              <label class="translation-prompts-field">
                <span>Top-p</span>
                <input id="chatTopP" type="number" min="0.01" max="1" step="0.01" placeholder="0.95">
              </label>
              <label class="translation-prompts-field">
                <span>Top-k</span>
                <input id="chatTopK" type="number" min="1" max="200" step="1" placeholder="1=greedy">
              </label>
            </div>
            <div class="chat-settings-actions">
              <button type="button" id="chatResetSettings">Reset to defaults</button>
            </div>
          </details>
        </section>

        <div class="chat-warning" id="chatWarning" role="status" hidden></div>

        <div class="chat-stream" id="chatStream"></div>

        <div class="chat-attachments" id="chatAttachments" hidden></div>
        <div class="translation-prompts-inline-status chat-status" id="chatStatus">Loading models...</div>

        <div class="chat-composer">
          <textarea id="chatInput" rows="3" placeholder="Type a message... (Enter to send, Shift+Enter for newline)"></textarea>
          <div class="chat-composer-actions">
            <button type="button" id="chatSendBtn">Send</button>
            <button type="button" id="chatAddFilesBtn">Add files</button>
            <button type="button" id="chatClearBtn">Clear</button>
            <input id="chatFileInput" type="file" multiple hidden>
          </div>
        </div>
      </div>
    </div>
  `;

  const modelSelect = container.querySelector('#chatModelSelect');
  const allowRemoteInput = container.querySelector('#chatAllowRemote');
  const systemPromptInput = container.querySelector('#chatSystemPrompt');
  const maxTokensInput = container.querySelector('#chatMaxTokens');
  const temperatureInput = container.querySelector('#chatTemperature');
  const topPInput = container.querySelector('#chatTopP');
  const topKInput = container.querySelector('#chatTopK');
  const enableThinkingInput = container.querySelector('#chatEnableThinking');
  const warningEl = container.querySelector('#chatWarning');
  const streamEl = container.querySelector('#chatStream');
  const attachmentsEl = container.querySelector('#chatAttachments');
  const statusEl = container.querySelector('#chatStatus');
  const inputEl = container.querySelector('#chatInput');
  const sendBtn = container.querySelector('#chatSendBtn');
  const addFilesBtn = container.querySelector('#chatAddFilesBtn');
  const clearBtn = container.querySelector('#chatClearBtn');
  const fileInput = container.querySelector('#chatFileInput');
  const resetSettingsBtn = container.querySelector('#chatResetSettings');

  let adminModels = [];
  // Committed conversation. user: {role, text, images:[{name,dataUrl}]}.
  // assistant: {role, text}. A failed send is rolled back, never stored.
  let turns = [];
  // Pending attachments for the next user turn.
  let pendingImages = [];
  let pendingTextFiles = [];
  let isBusy = false;
  let lastThinkingEnabled = false;
  // Shell-style recall of previously sent prompt text (Up/Down in the composer).
  let promptHistory = [];
  let historyIndex = null; // null = not navigating
  let historyStash = ''; // draft saved when navigation begins

  const settingInputs = [systemPromptInput, maxTokensInput, temperatureInput, topPInput, topKInput];

  function saveChatSettings() {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        systemPrompt: systemPromptInput.value,
        maxTokens: maxTokensInput.value,
        temperature: temperatureInput.value,
        topP: topPInput.value,
        topK: topKInput.value,
      }));
    } catch {
      // ignore unavailable storage
    }
  }

  function applyChatSettings(settings) {
    systemPromptInput.value = settings.systemPrompt;
    maxTokensInput.value = settings.maxTokens;
    temperatureInput.value = settings.temperature;
    topPInput.value = settings.topP;
    topKInput.value = settings.topK;
  }

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
          multiTurn: capabilities.multi_turn === true,
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

  function setBusy(nextBusy) {
    isBusy = nextBusy;
    modelSelect.disabled = nextBusy;
    allowRemoteInput.disabled = nextBusy;
    systemPromptInput.disabled = nextBusy;
    maxTokensInput.disabled = nextBusy;
    temperatureInput.disabled = nextBusy;
    topPInput.disabled = nextBusy;
    topKInput.disabled = nextBusy;
    enableThinkingInput.disabled = nextBusy || !selectedModelSupportsThinking();
    inputEl.disabled = nextBusy;
    const noModels = loadedModels().length === 0;
    sendBtn.disabled = nextBusy || noModels;
    addFilesBtn.disabled = nextBusy || noModels;
    clearBtn.disabled = nextBusy || (turns.length === 0 && !inputEl.value && pendingImages.length === 0 && pendingTextFiles.length === 0);
  }

  function committedImageCount() {
    return turns.reduce((sum, turn) => sum + ((turn.images || []).length), 0);
  }

  // Remaining images that can still be attached. Multi-turn counts the whole
  // conversation (one rendered prompt); single-turn counts only this message.
  function imageBudget() {
    const model = selectedModel();
    if (!model || !model.supportsImage) return 0;
    const used = (model.multiTurn ? committedImageCount() : 0) + pendingImages.length;
    return Math.max(0, model.imageLimit - used);
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

  function updateWarning() {
    const model = selectedModel();
    if (model && !model.multiTurn) {
      warningEl.hidden = false;
      warningEl.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">info</span>
        <span>Simulated chat — llm-pool's <strong>${escapeHtml(model.backend || 'current')}</strong> backend doesn't support multi-turn yet, so the full history is sent as a single prompt each turn.</span>`;
    } else {
      warningEl.hidden = true;
      warningEl.textContent = '';
    }
  }

  function renderModelOptions() {
    const models = loadedModels();
    // Prefer the in-session selection; on a fresh load fall back to the stored
    // model, but only restore it below if it is currently loaded.
    const previous = String(modelSelect.value || '') || loadStoredModel();
    modelSelect.innerHTML = models.length > 0
      ? models.map((model) => {
        const tags = [];
        if (model.isRemote) tags.push('remote');
        if (!model.multiTurn) tags.push('single-turn');
        if (model.supportsImage) tags.push('vision');
        const label = tags.length ? `${model.name} · ${tags.join(', ')}` : model.name;
        return `<option value="${escapeAttr(model.id)}">${escapeHtml(label)}</option>`;
      }).join('')
      : '<option value="">No loaded models</option>';
    if (models.some((model) => model.id === previous)) {
      modelSelect.value = previous;
    }
    renderThinkingControl();
    updateWarning();
    setBusy(isBusy);
  }

  function bubbleMarkup(turn) {
    const roleClass = turn.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant';
    const imagesMarkup = (turn.images || []).length
      ? `<div class="chat-bubble-images">${turn.images.map((img) => `
          <img src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.name)}" title="${escapeAttr(img.name)}">
        `).join('')}</div>`
      : '';
    const text = String(turn.text || '');
    const textMarkup = text ? `<div class="chat-bubble-text">${escapeHtml(text)}</div>` : '';
    return `
      <div class="chat-bubble ${roleClass}">
        ${imagesMarkup}
        ${textMarkup}
      </div>
    `;
  }

  function renderStream() {
    if (turns.length === 0) {
      streamEl.innerHTML = '<div class="chat-empty">No messages yet. Type below to start the conversation.</div>';
      return;
    }
    streamEl.innerHTML = turns.map(bubbleMarkup).join('');
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  function renderAttachments() {
    const items = [];
    pendingImages.forEach((img, index) => {
      items.push(`
        <figure class="chat-attachment chat-attachment-image">
          <img src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.name)}">
          <button type="button" class="chat-attachment-remove" data-kind="image" data-index="${index}"
            aria-label="Remove ${escapeAttr(img.name)}" title="Remove ${escapeAttr(img.name)}">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </figure>
      `);
    });
    pendingTextFiles.forEach((file, index) => {
      items.push(`
        <span class="chat-attachment chat-attachment-file">
          <span class="material-symbols-outlined" aria-hidden="true">description</span>
          <span class="chat-attachment-name">${escapeHtml(file.name)}</span>
          <button type="button" class="chat-attachment-remove" data-kind="text" data-index="${index}"
            aria-label="Remove ${escapeAttr(file.name)}" title="Remove ${escapeAttr(file.name)}">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </span>
      `);
    });
    if (items.length === 0) {
      attachmentsEl.hidden = true;
      attachmentsEl.innerHTML = '';
      return;
    }
    attachmentsEl.hidden = false;
    attachmentsEl.innerHTML = items.join('');
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
          rejected.push(`${file.name} (this model can't read images)`);
          continue;
        }
        if (imageBudget() <= 0) {
          const reason = (model.multiTurn && committedImageCount() > 0)
            ? `the earlier image is still active for this chat — no need to re-add (this model allows ${model.imageLimit} per conversation)`
            : `this model accepts at most ${model.imageLimit} image(s) per ${model.multiTurn ? 'conversation' : 'message'}`;
          rejected.push(`${file.name} (${reason})`);
          continue;
        }
        const dataUrl = await readImageAsDataUrl(file);
        if (dataUrl.startsWith('data:image/')) {
          pendingImages.push({ name: String(file.name || 'image'), dataUrl });
        }
      } else if (kind === 'text') {
        const content = await file.text();
        pendingTextFiles.push({ name: String(file.name || 'attachment.txt'), content });
      } else {
        rejected.push(`${file.name} (${kind} files are not supported)`);
      }
    }
    renderAttachments();
    setStatus(rejected.length ? `Skipped: ${rejected.join('; ')}` : '');
  }

  function buildUserTurnText() {
    const promptText = String(inputEl.value || '')
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '');
    const parts = [];
    if (promptText !== '') parts.push(promptText);
    if (pendingTextFiles.length > 0) {
      parts.push('ATTACHMENTS:');
      pendingTextFiles.forEach((file) => {
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

  function apiTurns() {
    return turns.map((turn) => ({
      role: turn.role,
      text: String(turn.text || ''),
      images: (turn.images || []).map((img) => ({ name: img.name, data_url: img.dataUrl })),
    }));
  }

  function formatResultStats(metrics) {
    const parts = [];
    const gpuMs = metrics.gpu_generate_total_ms;
    if (gpuMs != null) parts.push(`${Number(gpuMs).toFixed(0)} ms GPU`);
    const tps = metrics.engine_tokens_per_second;
    if (tps != null) parts.push(`${Number(tps).toFixed(1)} tok/s`);
    return parts.join(' · ');
  }

  function readDecode() {
    const optionalFloat = (el) => (el.value.trim() === '' ? undefined : Number(el.value));
    const optionalInt = (el) => (el.value.trim() === '' ? undefined : Number.parseInt(el.value, 10));
    return {
      max_tokens: Math.max(1, Math.min(4096, Number.parseInt(maxTokensInput.value, 10) || 2048)),
      temperature: optionalFloat(temperatureInput),
      top_p: optionalFloat(topPInput),
      top_k: optionalInt(topKInput),
    };
  }

  async function send() {
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
    const draft = inputEl.value;
    const sentImages = pendingImages;
    const sentTextFiles = pendingTextFiles;
    const text = buildUserTurnText();
    if (text.trim() === '' && sentImages.length === 0) {
      setStatus('Type a message or add a file.');
      return;
    }

    if (draft.trim() !== '' && promptHistory[promptHistory.length - 1] !== draft) {
      promptHistory.push(draft);
    }
    historyIndex = null;

    const userTurn = { role: 'user', text, images: sentImages };
    turns.push(userTurn);
    pendingImages = [];
    pendingTextFiles = [];
    inputEl.value = '';
    renderAttachments();
    renderStream();

    setBusy(true);
    const thinkingMode = selectedThinkingMode();
    setStatus(thinkingMode === 'enabled' ? 'Thinking...' : 'Generating...');
    try {
      const decode = readDecode();
      const result = await api.runChatPrompt({
        model: model.id,
        system_prompt: String(systemPromptInput.value || ''),
        multi_turn: model.multiTurn,
        allow_remote: allowRemote,
        thinking: thinkingMode,
        max_tokens: decode.max_tokens,
        temperature: decode.temperature,
        top_p: decode.top_p,
        top_k: decode.top_k,
        turns: apiTurns(),
      });
      turns.push({ role: 'assistant', text: String(result?.output_text || '') });
      setStatus(formatResultStats(result?.metrics || {}));
    } catch (err) {
      // Roll the failed turn back into the composer so it never lingers in the
      // sent history (which would re-send its attachments on every later turn).
      const idx = turns.indexOf(userTurn);
      if (idx !== -1) turns.splice(idx, 1);
      inputEl.value = draft;
      pendingImages = sentImages;
      pendingTextFiles = sentTextFiles;
      renderAttachments();
      setStatus(formatApiError(err));
    } finally {
      renderStream();
      setBusy(false);
      inputEl.focus();
    }
  }

  function clearConversation() {
    turns = [];
    pendingImages = [];
    pendingTextFiles = [];
    inputEl.value = '';
    historyIndex = null;
    renderAttachments();
    renderStream();
    setStatus('');
    setBusy(isBusy);
  }

  function moveCaretToEnd(el) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }

  // Up/Down recall of previously sent prompts (shell-style). Starting recall
  // requires an empty box or the caret at the very start, so multi-line editing
  // still uses the arrows normally; once recalling, the arrows step through.
  function recallPrevPrompt() {
    if (promptHistory.length === 0) return false;
    const navigating = historyIndex !== null;
    const atStart = inputEl.selectionStart === 0 && inputEl.selectionEnd === 0;
    if (!navigating && inputEl.value !== '' && !atStart) return false;
    if (!navigating) {
      historyStash = inputEl.value;
      historyIndex = promptHistory.length;
    }
    historyIndex = Math.max(0, historyIndex - 1);
    inputEl.value = promptHistory[historyIndex];
    moveCaretToEnd(inputEl);
    setBusy(isBusy);
    return true;
  }

  function recallNextPrompt() {
    if (historyIndex === null) return false;
    historyIndex += 1;
    if (historyIndex >= promptHistory.length) {
      historyIndex = null;
      inputEl.value = historyStash;
    } else {
      inputEl.value = promptHistory[historyIndex];
    }
    moveCaretToEnd(inputEl);
    setBusy(isBusy);
    return true;
  }

  async function loadModels() {
    setBusy(true);
    setStatus('Loading models...');
    try {
      adminModels = normalizeAdminModelsPayload(await api.getAdminModels());
      renderModelOptions();
      setStatus(loadedModels().length === 0 ? 'No loaded models available.' : '');
    } catch (err) {
      adminModels = [];
      renderModelOptions();
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  modelSelect.addEventListener('change', () => {
    saveStoredModel(modelSelect.value);
    renderThinkingControl();
    updateWarning();
    setBusy(isBusy);
  });

  enableThinkingInput.addEventListener('change', () => {
    if (!enableThinkingInput.disabled) {
      lastThinkingEnabled = Boolean(enableThinkingInput.checked);
    }
  });

  sendBtn.addEventListener('click', () => send());

  inputEl.addEventListener('keydown', (event) => {
    // Enter sends; Shift+Enter inserts a newline. Ignore Enter mid-IME-composition.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!isBusy) send();
      return;
    }
    if (isBusy) return;
    if (event.key === 'ArrowUp' && recallPrevPrompt()) {
      event.preventDefault();
    } else if (event.key === 'ArrowDown' && recallNextPrompt()) {
      event.preventDefault();
    }
  });
  inputEl.addEventListener('input', () => {
    historyIndex = null; // typing exits history recall
    setBusy(isBusy);
  });

  addFilesBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
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

  attachmentsEl.addEventListener('click', (event) => {
    const button = event.target.closest('.chat-attachment-remove');
    if (!button || isBusy) return;
    const index = Number.parseInt(button.dataset.index || '', 10);
    if (!Number.isInteger(index)) return;
    if (button.dataset.kind === 'image') {
      if (index >= 0 && index < pendingImages.length) pendingImages.splice(index, 1);
    } else if (index >= 0 && index < pendingTextFiles.length) {
      pendingTextFiles.splice(index, 1);
    }
    renderAttachments();
    setBusy(isBusy);
  });

  clearBtn.addEventListener('click', () => {
    if (!isBusy) clearConversation();
  });

  settingInputs.forEach((el) => el.addEventListener('input', saveChatSettings));
  resetSettingsBtn.addEventListener('click', () => {
    applyChatSettings(DEFAULT_SETTINGS);
    saveChatSettings();
  });

  applyChatSettings(loadChatSettings());
  renderStream();
  renderAttachments();

  container.__onActivate = () => {
    loadModels();
  };

  return container;
}
