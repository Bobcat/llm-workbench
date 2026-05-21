export function buildReplayMarkup() {
  return `
    <div class="shell replay-shell">
      <div class="replay-main">
        <div class="replay-main-stage">
          <header class="replay-top-bar">
            <div class="replay-top-left">
              <span class="replay-status-badge status-idle" id="replayStatusBadge">Idle</span>
              <span class="replay-recorded-timer" id="replayRecordedTimer" hidden></span>
            </div>
            <div class="replay-top-right">
              <div class="speed-form speed-form-top">
                <select id="sampleFileSelect" class="replay-sample-select" aria-label="Sample file"></select>
                <select id="policySelect" aria-label="Policy">
                  <option value="replay" selected>Replay policy</option>
                  <option value="live">Live policy</option>
                </select>
                <select id="speedSelect" aria-label="Speed">
                  <optgroup label="Recorded timing">
                    <option value="recorded_1x">Recorded 1x</option>
                    <option value="recorded_2x">Recorded 2x</option>
                    <option value="recorded_5x">Recorded 5x</option>
                    <option value="recorded_10x">Recorded 10x</option>
                    <option value="recorded_max">Recorded max</option>
                  </optgroup>
                  <optgroup label="Fixed delay">
                    <option value="slow">Fixed slow (900 ms)</option>
                    <option value="normal" selected>Fixed normal (500 ms)</option>
                    <option value="fast">Fixed fast (200 ms)</option>
                    <option value="fast2">Fixed fast 2 (150 ms)</option>
                    <option value="fast3">Fixed fast 3 (100 ms)</option>
                    <option value="fast4">Fixed fast 4 (75 ms)</option>
                    <option value="fast5">Fixed fast 5 (50 ms)</option>
                    <option value="fast6">Fixed fast 6 (25 ms)</option>
                    <option value="fast7">Fixed fast 7 (10 ms)</option>
                    <option value="fastest">Fixed fastest</option>
                  </optgroup>
                </select>
                <button type="button" id="replaySettingsBtn">Settings</button>
              </div>
            </div>
          </header>

          <div class="replay-content-area">
            <div class="replay-transcript-stage">
              <div class="stage-grid">
                <div class="stage-column">
                  <div class="stage-panel">
                    <div id="sourceText" class="replay-text"><span class="placeholder">(empty)</span></div>
                  </div>
                </div>
                <div class="stage-column stage-column-target">
                  <div class="stage-panel">
                    <div id="targetText" class="replay-text"><span class="placeholder">(waiting for translation)</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="replay-bottom-bar">
            <div class="replay-revision-row">
              <div class="replay-revision-cell replay-revision-cell-source" aria-live="polite">
                <span class="metric-item">rev.<span class="metric-value" id="sourceRevisionStat">0</span></span>
              </div>
              <div class="replay-revision-cell replay-revision-cell-target" aria-live="polite">
                <span class="metric-item">rev.<span class="metric-value" id="targetRevisionStat">0</span></span>
                <div class="replay-target-language-row" id="replayTargetLanguageRow" hidden>
                  <select id="targetLanguageQuickSelect" class="replay-target-language-select" aria-label="Target language"></select>
                </div>
              </div>
            </div>

            <div class="replay-inline-stats" aria-live="polite">
              <span class="metric-item">Event: <span class="metric-value" id="eventStat">-/-</span></span>
              <span class="metric-item">Kind: <span class="metric-value" id="kindStat">-</span></span>
              <span class="metric-item">Translated: <span class="metric-value" id="translatedStat">-</span></span>
              <span class="metric-item">Req wall/LLM gen: <span class="metric-value" id="timingStat">- / -</span></span>
            </div>

            <div class="controls">
              <div class="controls-actions">
                <button id="startBtn">Play</button>
                <button id="pauseBtn" hidden>Pause</button>
                <a href="#" id="exportFinalLink" hidden>Export</a>
                <button id="resetBtn" hidden>Reset</button>
              </div>
              <div class="controls-models">
                <select id="modelSelect">
                  <option value="">No translator</option>
                </select>
                <select id="correctionModelSelect">
                  <option value="">No reviser</option>
                </select>
                <button type="button" id="firstPassPromptsBtn">Prompts</button>
                <button type="button" id="replayDevToggleBtn" aria-expanded="false" title="Dev Tools">Dev Tools</button>
              </div>
            </div>
          </div>
        </div>

        <div class="replay-dev-section" id="replayDevSection" hidden>
          <div class="replay-dev-grid">
            <section class="replay-dev-card">
              <div class="replay-dev-card-label">LLM translation metrics</div>
              <div class="replay-dev-card-text" id="replayRunMetricsText"></div>
            </section>
            <section class="replay-dev-card">
              <div class="replay-dev-card-label replay-dev-card-label-row">
                <span>Replay source timing</span>
                <label class="replay-source-timestamps-toggle">
                  <input type="checkbox" id="sourceTimestampToggle">
                  <span>timestamps</span>
                </label>
              </div>
              <div class="replay-dev-card-text is-placeholder" id="replaySourceTimingText">Source timing appears here once replay events arrive.</div>
            </section>
          </div>
        </div>

        <div class="modal hidden replay-prompts-dialog" id="firstPassPromptsDialog" role="dialog" aria-modal="true" aria-label="Prompts">
          <div class="modal-card dialog-card replay-prompts-dialog-card" id="firstPassPromptsDialogCard">
            <div class="dialog-topbar dialog-drag-handle" id="firstPassPromptsDialogDragHandle" title="Drag to move">
              <div class="dialog-title">Prompts</div>
              <div class="dialog-grip" aria-hidden="true">⋮⋮</div>
            </div>
            <div class="dialog-body replay-prompts-dialog-body">
              <div class="replay-prompts-dialog-pass-tabs" role="tablist" aria-label="Prompt pass">
                <button type="button" id="firstPassPromptTabBtn" class="replay-prompts-dialog-pass-tab is-active" role="tab" aria-selected="true">1st pass</button>
                <button type="button" id="secondPassPromptTabBtn" class="replay-prompts-dialog-pass-tab" role="tab" aria-selected="false">2nd pass</button>
              </div>
              <label class="replay-prompts-dialog-field">
                <span>Prompt</span>
                <select id="firstPassPromptSelect"></select>
              </label>
              <label class="replay-prompts-dialog-field">
                <span>System prompt</span>
                <textarea id="firstPassPromptSystemPreview" rows="3" readonly></textarea>
              </label>
              <label class="replay-prompts-dialog-field">
                <span>User prompt</span>
                <textarea id="firstPassPromptUserPreview" rows="5" readonly></textarea>
              </label>
              <div class="replay-prompts-dialog-language-grid">
                <label class="replay-prompts-dialog-field">
                  <span>{{source_lang}}</span>
                  <select id="firstPassSourceLanguageSelect"></select>
                  <span class="replay-prompts-dialog-field-hint" id="firstPassSourceLanguageHint" hidden>Not used by current prompt.</span>
                </label>
                <label class="replay-prompts-dialog-field">
                  <span>{{target_lang}}</span>
                  <select id="firstPassTargetLanguageSelect"></select>
                  <span class="replay-prompts-dialog-field-hint" id="firstPassTargetLanguageHint" hidden>Not used by current prompt.</span>
                </label>
              </div>
            </div>
            <div class="replay-prompts-dialog-actions">
              <button type="button" id="cancelFirstPassPromptBtn">Cancel</button>
              <button type="button" id="applyFirstPassPromptBtn">Apply</button>
            </div>
          </div>
        </div>

        <div class="modal hidden replay-settings-dialog" id="replaySettingsDialog" role="dialog" aria-modal="true" aria-label="Translation settings">
          <div class="modal-card dialog-card replay-settings-dialog-card" id="replaySettingsDialogCard">
            <div class="dialog-topbar dialog-drag-handle" id="replaySettingsDialogDragHandle" title="Drag to move">
              <div class="dialog-title">Translation settings</div>
              <div class="dialog-grip" aria-hidden="true">⋮⋮</div>
            </div>
            <div class="dialog-body replay-settings-dialog-body">
              <p class="replay-settings-dialog-copy">
                These gating settings determine when incoming source events become translation-eligible and therefore when target revisions are produced.
              </p>
              <label class="replay-settings-dialog-field">
                <span>Current gating settings</span>
                <textarea id="replaySettingsSummary" rows="3" readonly></textarea>
              </label>
            </div>
            <div class="replay-settings-dialog-actions">
              <button type="button" id="closeReplaySettingsBtn">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function getReplayElements(container) {
  const sourcePanel = container.querySelector('#sourceText')?.closest('.stage-panel');
  const targetPanel = container.querySelector('#targetText')?.closest('.stage-panel');
  return {
    modelSelect: container.querySelector('#modelSelect'),
    correctionModelSelect: container.querySelector('#correctionModelSelect'),
    firstPassPromptsBtn: container.querySelector('#firstPassPromptsBtn'),
    firstPassPromptsDialog: container.querySelector('#firstPassPromptsDialog'),
    firstPassPromptsDialogCard: container.querySelector('#firstPassPromptsDialogCard'),
    firstPassPromptsDialogDragHandle: container.querySelector('#firstPassPromptsDialogDragHandle'),
    firstPassPromptTabBtn: container.querySelector('#firstPassPromptTabBtn'),
    secondPassPromptTabBtn: container.querySelector('#secondPassPromptTabBtn'),
    firstPassPromptSelect: container.querySelector('#firstPassPromptSelect'),
    firstPassPromptSystemPreview: container.querySelector('#firstPassPromptSystemPreview'),
    firstPassPromptUserPreview: container.querySelector('#firstPassPromptUserPreview'),
    firstPassSourceLanguageSelect: container.querySelector('#firstPassSourceLanguageSelect'),
    firstPassTargetLanguageSelect: container.querySelector('#firstPassTargetLanguageSelect'),
    firstPassSourceLanguageHint: container.querySelector('#firstPassSourceLanguageHint'),
    firstPassTargetLanguageHint: container.querySelector('#firstPassTargetLanguageHint'),
    cancelFirstPassPromptBtn: container.querySelector('#cancelFirstPassPromptBtn'),
    applyFirstPassPromptBtn: container.querySelector('#applyFirstPassPromptBtn'),
    replaySettingsBtn: container.querySelector('#replaySettingsBtn'),
    replaySettingsDialog: container.querySelector('#replaySettingsDialog'),
    replaySettingsDialogCard: container.querySelector('#replaySettingsDialogCard'),
    replaySettingsDialogDragHandle: container.querySelector('#replaySettingsDialogDragHandle'),
    replaySettingsSummary: container.querySelector('#replaySettingsSummary'),
    closeReplaySettingsBtn: container.querySelector('#closeReplaySettingsBtn'),
    replayDevToggleBtn: container.querySelector('#replayDevToggleBtn'),
    replayDevSection: container.querySelector('#replayDevSection'),
    policySelect: container.querySelector('#policySelect'),
    speedSelect: container.querySelector('#speedSelect'),
    sampleFileSelect: container.querySelector('#sampleFileSelect'),
    targetLanguageQuickSelect: container.querySelector('#targetLanguageQuickSelect'),
    startBtn: container.querySelector('#startBtn'),
    pauseBtn: container.querySelector('#pauseBtn'),
    resetBtn: container.querySelector('#resetBtn'),
    exportFinalLink: container.querySelector('#exportFinalLink'),
    sourcePanel,
    targetPanel,
  };
}
