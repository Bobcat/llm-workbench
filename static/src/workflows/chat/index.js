import { api } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const MAX_IMAGES_PER_TURN = 4;

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
          <div class="translation-prompts-field prompt-runner-remote-field">
            <label class="prompt-runner-remote-toggle">
              <input id="chatAllowRemote" type="checkbox">
              <span>Allow remote calls</span>
            </label>
          </div>
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
              <input id="chatTemperature" type="number" min="0" max="2" step="0.05" placeholder="0.2">
            </label>
            <label class="translation-prompts-field">
              <span>Top-p</span>
              <input id="chatTopP" type="number" min="0.01" max="1" step="0.01" placeholder="0.95">
            </label>
            <label class="translation-prompts-field">
              <span>Top-k</span>
              <input id="chatTopK" type="number" min="1" max="200" step="1" placeholder="-">
            </label>
          </div>
        </section>

        <div class="chat-warning" id="chatWarning" role="status" hidden></div>

        <div class="chat-stream" id="chatStream"></div>

        <div class="chat-attachments" id="chatAttachments" hidden></div>
        <div class="translation-prompts-inline-status chat-status" id="chatStatus">Loading models...</div>

        <div class="chat-composer">
          <textarea id="chatInput" rows="3" placeholder="Type a message... (Ctrl+Enter to send)"></textarea>
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
  const warningEl = container.querySelector('#chatWarning');
  const streamEl = container.querySelector('#chatStream');
  const attachmentsEl = container.querySelector('#chatAttachments');
  const statusEl = container.querySelector('#chatStatus');
  const inputEl = container.querySelector('#chatInput');
  const sendBtn = container.querySelector('#chatSendBtn');
  const addFilesBtn = container.querySelector('#chatAddFilesBtn');
  const clearBtn = container.querySelector('#chatClearBtn');
  const fileInput = container.querySelector('#chatFileInput');

  let adminModels = [];
  // Committed conversation. user: {role, text, images:[{name,dataUrl}]}.
  // assistant: {role, text, isError}.
  let turns = [];
  // Pending attachments for the next user turn.
  let pendingImages = [];
  let pendingTextFiles = [];
  let isBusy = false;

  function normalizeAdminModelsPayload(payload) {
    const list = Array.isArray(payload?.models) ? payload.models : [];
    return list
      .map((model) => {
        const capabilities = model?.capabilities || {};
        const modalities = Array.isArray(capabilities.modalities)
          ? capabilities.modalities.map((m) => String(m).trim().toLowerCase())
          : ['text'];
        return {
          id: String(model?.name || '').trim(),
          name: String(model?.name || '').trim(),
          runtimeState: String(model?.runtime_state || 'unloaded').trim().toLowerCase(),
          isRemote: String(model?.resolved_backend || model?.definition?.backend || '').trim().toLowerCase() === 'openai_compatible',
          supportsImage: modalities.includes('image'),
          multiTurn: capabilities.multi_turn === true,
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
    inputEl.disabled = nextBusy;
    const noModels = loadedModels().length === 0;
    sendBtn.disabled = nextBusy || noModels;
    const model = selectedModel();
    const imageFull = pendingImages.length >= MAX_IMAGES_PER_TURN;
    addFilesBtn.disabled = nextBusy || noModels;
    clearBtn.disabled = nextBusy || (turns.length === 0 && !inputEl.value && pendingImages.length === 0 && pendingTextFiles.length === 0);
    // hint flags used by status copy
    addFilesBtn.dataset.imageFull = String(Boolean(model?.supportsImage) && imageFull);
  }

  function updateWarning() {
    const model = selectedModel();
    if (model && !model.multiTurn) {
      warningEl.hidden = false;
      warningEl.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">info</span>
        <span>Simulated chat — <strong>${escapeHtml(model.name)}</strong> has no multi-turn support, so the full history is sent as a single prompt each turn.</span>`;
    } else {
      warningEl.hidden = true;
      warningEl.textContent = '';
    }
  }

  function renderModelOptions() {
    const models = loadedModels();
    const previous = String(modelSelect.value || '');
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
    updateWarning();
    setBusy(isBusy);
  }

  function bubbleMarkup(turn) {
    const roleClass = turn.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant';
    const errorClass = turn.isError ? ' chat-bubble-error' : '';
    const imagesMarkup = (turn.images || []).length
      ? `<div class="chat-bubble-images">${turn.images.map((img) => `
          <img src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.name)}" title="${escapeAttr(img.name)}">
        `).join('')}</div>`
      : '';
    const text = String(turn.text || '');
    const textMarkup = text ? `<div class="chat-bubble-text">${escapeHtml(text)}</div>` : '';
    return `
      <div class="chat-bubble ${roleClass}${errorClass}">
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
        if (pendingImages.length >= MAX_IMAGES_PER_TURN) {
          rejected.push(`${file.name} (max ${MAX_IMAGES_PER_TURN} images per message)`);
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
    return turns
      .filter((turn) => !turn.isError)
      .map((turn) => ({
        role: turn.role,
        text: String(turn.text || ''),
        images: (turn.images || []).map((img) => ({ name: img.name, data_url: img.dataUrl })),
      }));
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
    const text = buildUserTurnText();
    if (text.trim() === '' && pendingImages.length === 0) {
      setStatus('Type a message or add a file.');
      return;
    }

    turns.push({ role: 'user', text, images: pendingImages });
    pendingImages = [];
    pendingTextFiles = [];
    inputEl.value = '';
    renderAttachments();
    renderStream();

    setBusy(true);
    setStatus('Thinking...');
    try {
      const decode = readDecode();
      const result = await api.runChatPrompt({
        model: model.id,
        system_prompt: String(systemPromptInput.value || ''),
        multi_turn: model.multiTurn,
        allow_remote: allowRemote,
        max_tokens: decode.max_tokens,
        temperature: decode.temperature,
        top_p: decode.top_p,
        top_k: decode.top_k,
        turns: apiTurns(),
      });
      turns.push({ role: 'assistant', text: String(result?.output_text || '') });
      const metrics = result?.metrics || {};
      const tps = metrics.engine_tokens_per_second;
      setStatus(tps != null ? `${Number(tps).toFixed(1)} tok/s` : '');
    } catch (err) {
      turns.push({ role: 'assistant', text: formatApiError(err), isError: true });
      setStatus('');
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
    renderAttachments();
    renderStream();
    setStatus('');
    setBusy(isBusy);
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
    updateWarning();
    setBusy(isBusy);
  });

  sendBtn.addEventListener('click', () => send());

  inputEl.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!isBusy) send();
    }
  });
  inputEl.addEventListener('input', () => setBusy(isBusy));

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

  renderStream();
  renderAttachments();

  container.__onActivate = () => {
    loadModels();
  };

  return container;
}
