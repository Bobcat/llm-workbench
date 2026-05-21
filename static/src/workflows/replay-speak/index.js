import { api, ReplaySpeakWebSocket } from '../../api-client.js';
import { escapeAttr, escapeHtml, formatApiError } from '../../shared/ui-helpers.js';

const DEFAULT_SAMPLE_PATH = 'data/realtime_translation/sample/sample_c_only_120s.pc';
const DEFAULT_LANGUAGE = 'English';

export function createReplaySpeakView() {
  const container = document.createElement('div');
  container.className = 'translation-prompts-view replay-speak-view';

  container.innerHTML = `
    <div class="translation-prompts-shell">
      <div class="translation-prompts-main">
        <div class="translation-prompts-content-area">
          <section class="translation-prompts-pane translation-prompts-pane-editor">
            <label class="translation-prompts-field">
              <span>Sample</span>
              <select id="replaySpeakSampleSelect"></select>
            </label>
            <label class="translation-prompts-field">
              <span>TTS model</span>
              <select id="replaySpeakModelSelect"></select>
            </label>
            <label class="translation-prompts-field">
              <span>Language</span>
              <input id="replaySpeakLanguageInput" type="text" value="${escapeAttr(DEFAULT_LANGUAGE)}">
            </label>
            <label class="translation-prompts-field">
              <span>Voice instructions</span>
              <textarea id="replaySpeakVoiceInput" rows="3"></textarea>
            </label>
            <div class="translation-prompts-run-actions">
              <button type="button" id="replaySpeakStartBtn">Start</button>
              <button type="button" id="replaySpeakPauseBtn">Pause</button>
              <button type="button" id="replaySpeakResetBtn">Reset</button>
            </div>
            <div class="translation-prompts-inline-status" id="replaySpeakStatus">Loading...</div>
            <div class="translation-prompts-divider" aria-hidden="true"></div>
            <audio id="replaySpeakAudio" controls></audio>
            <section class="translation-prompts-stats-block">
              <div class="translation-prompts-stats-grid">
                <div class="translation-prompts-stat">
                  <span>Status</span>
                  <strong id="replaySpeakStatStatus">idle</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Segment</span>
                  <strong id="replaySpeakStatSegment">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Synth</span>
                  <strong id="replaySpeakStatSynth">-</strong>
                </div>
                <div class="translation-prompts-stat">
                  <span>Audio</span>
                  <strong id="replaySpeakStatAudio">-</strong>
                </div>
              </div>
            </section>
            <label class="translation-prompts-field translation-prompts-field-response">
              <span>Committed segments</span>
              <textarea id="replaySpeakTranscript" rows="12" readonly></textarea>
            </label>
          </section>
        </div>
      </div>
    </div>
  `;

  const sampleSelect = container.querySelector('#replaySpeakSampleSelect');
  const modelSelect = container.querySelector('#replaySpeakModelSelect');
  const languageInput = container.querySelector('#replaySpeakLanguageInput');
  const voiceInput = container.querySelector('#replaySpeakVoiceInput');
  const startBtn = container.querySelector('#replaySpeakStartBtn');
  const pauseBtn = container.querySelector('#replaySpeakPauseBtn');
  const resetBtn = container.querySelector('#replaySpeakResetBtn');
  const statusEl = container.querySelector('#replaySpeakStatus');
  const audioEl = container.querySelector('#replaySpeakAudio');
  const transcriptEl = container.querySelector('#replaySpeakTranscript');
  const statStatusEl = container.querySelector('#replaySpeakStatStatus');
  const statSegmentEl = container.querySelector('#replaySpeakStatSegment');
  const statSynthEl = container.querySelector('#replaySpeakStatSynth');
  const statAudioEl = container.querySelector('#replaySpeakStatAudio');

  let samples = [];
  let models = [];
  let sessionId = null;
  let socket = null;
  let status = 'idle';
  let segmentCount = 0;
  let busy = false;
  let audioQueue = [];
  let audioPlaying = false;
  let voiceInstructionsTouched = false;
  let lastAutoVoiceInstructions = defaultVoiceInstructions(DEFAULT_LANGUAGE);

  voiceInput.value = lastAutoVoiceInstructions;

  function setStatus(message) {
    statusEl.textContent = String(message || '');
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    sampleSelect.disabled = busy || status === 'playing' || status === 'paused';
    modelSelect.disabled = busy || status === 'playing';
    languageInput.disabled = busy || status === 'playing';
    voiceInput.disabled = busy || status === 'playing';
    startBtn.disabled = busy || loadedModels().length === 0;
    pauseBtn.disabled = busy || status !== 'playing';
    resetBtn.disabled = busy || !sessionId;
  }

  function updateStats(nextStatus = status) {
    statStatusEl.textContent = nextStatus || '-';
    statSegmentEl.textContent = segmentCount > 0 ? `${Math.min(currentDisplayedSegment(), segmentCount)} / ${segmentCount}` : '-';
  }

  function currentDisplayedSegment() {
    const match = String(statSegmentEl.dataset.current || '0');
    const parsed = Number(match);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
  }

  function loadedModels() {
    return models
      .filter((model) => model.runtimeState === 'loaded')
      .sort((left, right) => left.name.localeCompare(right.name, 'nl', { sensitivity: 'base' }));
  }

  function renderSampleOptions() {
    const previous = sampleSelect.value || DEFAULT_SAMPLE_PATH;
    sampleSelect.innerHTML = samples.length
      ? samples.map((sample) => `
        <option value="${escapeAttr(sample.path)}">${escapeHtml(sample.name)}</option>
      `).join('')
      : '<option value="">No samples</option>';
    if (samples.some((sample) => sample.path === previous)) {
      sampleSelect.value = previous;
    } else if (samples.some((sample) => sample.path === DEFAULT_SAMPLE_PATH)) {
      sampleSelect.value = DEFAULT_SAMPLE_PATH;
    }
  }

  function renderModelOptions() {
    const loaded = loadedModels();
    const previous = modelSelect.value;
    modelSelect.innerHTML = loaded.length
      ? loaded.map((model) => `
        <option value="${escapeAttr(model.id)}">${escapeHtml(model.name)}</option>
      `).join('')
      : '<option value="">No loaded TTS models</option>';
    if (loaded.some((model) => model.id === previous)) {
      modelSelect.value = previous;
    }
    setBusy(busy);
  }

  async function loadSamples() {
    try {
      const payload = await api.getReplaySpeakSamples();
      samples = Array.isArray(payload?.samples)
        ? payload.samples.map((sample) => ({
          path: String(sample?.path || ''),
          name: String(sample?.name || sample?.path || ''),
        })).filter((sample) => sample.path)
        : [];
      renderSampleOptions();
    } catch (err) {
      samples = [];
      renderSampleOptions();
      setStatus(formatApiError(err));
    }
  }

  async function loadModels() {
    try {
      const payload = await api.getTtsAdminModels();
      models = Array.isArray(payload?.models)
        ? payload.models.map((model) => ({
          id: String(model?.name || '').trim(),
          name: String(model?.name || '').trim(),
          runtimeState: String(model?.runtime_state || 'unloaded').trim().toLowerCase(),
        })).filter((model) => model.id)
        : [];
      renderModelOptions();
      if (loadedModels().length === 0) {
        setStatus('No loaded TTS models available.');
      } else if (status === 'idle') {
        setStatus('');
      }
    } catch (err) {
      models = [];
      renderModelOptions();
      setStatus(formatApiError(err));
    }
  }

  function collectOptions() {
    return {
      file_path: sampleSelect.value,
      model: modelSelect.value,
      language: String(languageInput.value || '').trim() || DEFAULT_LANGUAGE,
      voice_instructions: String(voiceInput.value || '').trim(),
    };
  }

  async function ensureSession() {
    if (sessionId && status === 'paused') {
      await api.setReplaySpeakOptions(sessionId, collectOptions());
      return sessionId;
    }

    closeSocket();
    clearPlayback();
    const payload = await api.createReplaySpeakSession(collectOptions());
    sessionId = payload.session_id;
    segmentCount = Number(payload.segment_count || 0);
    statSegmentEl.dataset.current = '0';
    connectSocket(sessionId);
    updateStats('idle');
    return sessionId;
  }

  function connectSocket(nextSessionId) {
    closeSocket();
    socket = new ReplaySpeakWebSocket(nextSessionId, handleSocketMessage);
    socket.connect();
  }

  function closeSocket() {
    if (!socket) return;
    socket.close();
    socket = null;
  }

  function clearPlayback() {
    audioQueue = [];
    audioPlaying = false;
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
    transcriptEl.value = '';
    statSynthEl.textContent = '-';
    statAudioEl.textContent = '-';
  }

  async function start() {
    setBusy(true);
    setStatus('Starting...');
    try {
      const activeSessionId = await ensureSession();
      await api.startReplaySpeak(activeSessionId);
      status = 'playing';
      setStatus('');
      updateStats(status);
      playNextAudio();
    } catch (err) {
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    if (!sessionId) return;
    setBusy(true);
    try {
      await api.pauseReplaySpeak(sessionId);
      status = 'paused';
      audioEl.pause();
      updateStats(status);
    } catch (err) {
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!sessionId) return;
    setBusy(true);
    try {
      await api.resetReplaySpeak(sessionId);
      status = 'idle';
      clearPlayback();
      statSegmentEl.dataset.current = '0';
      updateStats(status);
      setStatus('');
    } catch (err) {
      setStatus(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSocketMessage(message) {
    const type = String(message?.type || '');
    const data = message?.data || {};
    if (type === 'session_info') {
      segmentCount = Number(data.segment_count || 0);
      status = String(data.status || status || 'idle');
      updateStats(status);
      setBusy(busy);
      return;
    }
    if (type === 'state_update') {
      status = String(data.status || status || 'idle');
      segmentCount = Number(data.segment_count || segmentCount || 0);
      updateStats(status);
      setBusy(busy);
      if (status === 'completed') {
        setStatus('Completed.');
      }
      if (status === 'error') {
        setStatus(String(data.error || 'TTS replay failed.'));
      }
      return;
    }
    if (type === 'segment_start') {
      const index = Number(data.segment_index || 0);
      statSegmentEl.dataset.current = String(index);
      updateStats(status);
      setStatus(index > 0 ? `Synthesizing segment ${index}...` : 'Synthesizing...');
      return;
    }
    if (type === 'segment_audio') {
      handleSegmentAudio(data);
      return;
    }
    if (type === 'segment_error') {
      status = 'error';
      appendTranscriptLine(formatSegmentHeader(data, 'error'), String(data.error || 'TTS replay failed.'));
      setStatus(String(data.error || 'TTS replay failed.'));
      updateStats(status);
    }
  }

  function handleSegmentAudio(data) {
    const artifact = data.artifact || {};
    const index = Number(data.segment_index || 0);
    statSegmentEl.dataset.current = String(index);
    const wallMs = Number(artifact.wall_ms);
    const durationMs = Number(artifact.duration_ms);
    statSynthEl.textContent = Number.isFinite(wallMs) ? `${wallMs.toFixed(0)} ms` : '-';
    statAudioEl.textContent = Number.isFinite(durationMs) ? `${durationMs} ms` : '-';
    appendTranscriptLine(
      formatSegmentHeader(data, 'audio'),
      String(data.text || '')
    );
    if (artifact.audio_url) {
      audioQueue.push(String(artifact.audio_url));
      playNextAudio();
    }
    setStatus('');
    updateStats(status);
  }

  function formatSegmentHeader(data, kind) {
    const index = Number(data.segment_index || 0);
    const total = segmentCount || '?';
    const lineNumber = Number(data.line_number || 0);
    const speechEndMs = Number(data.speech_end_ms || 0);
    const prefix = kind === 'error' ? 'ERROR' : 'OK';
    return `[${prefix}] ${index || '?'} / ${total} - line ${lineNumber || '?'} - ${speechEndMs || 0} ms`;
  }

  function appendTranscriptLine(header, text) {
    const next = [header, text, ''].join('\n');
    transcriptEl.value = transcriptEl.value
      ? `${transcriptEl.value}\n${next}`
      : next;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  async function playNextAudio() {
    if (audioPlaying || status === 'paused' || audioQueue.length === 0) return;
    const nextUrl = audioQueue.shift();
    audioPlaying = true;
    audioEl.src = nextUrl;
    try {
      await audioEl.play();
    } catch {
      audioPlaying = false;
      setStatus('Audio ready.');
    }
  }

  function defaultVoiceInstructions(language) {
    return `Speak in ${language}. Use a clear, natural voice.`;
  }

  startBtn.addEventListener('click', () => {
    start();
  });
  pauseBtn.addEventListener('click', () => {
    pause();
  });
  resetBtn.addEventListener('click', () => {
    reset();
  });
  audioEl.addEventListener('ended', () => {
    audioPlaying = false;
    playNextAudio();
  });
  voiceInput.addEventListener('input', () => {
    voiceInstructionsTouched = true;
  });
  languageInput.addEventListener('input', () => {
    const nextInstructions = defaultVoiceInstructions(String(languageInput.value || '').trim() || DEFAULT_LANGUAGE);
    if (!voiceInstructionsTouched || voiceInput.value === lastAutoVoiceInstructions) {
      voiceInput.value = nextInstructions;
      voiceInstructionsTouched = false;
    }
    lastAutoVoiceInstructions = nextInstructions;
  });

  container.__onActivate = () => {
    loadModels();
  };
  container.__onDeactivate = () => {
    // Keep the websocket alive because the persistent workflow may keep playing while hidden.
  };

  setBusy(true);
  Promise.all([loadSamples(), loadModels()]).finally(() => {
    updateStats(status);
    setBusy(false);
  });

  return container;
}
