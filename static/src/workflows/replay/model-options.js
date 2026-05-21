import { api } from '../../api-client.js';
import {
  getStoredReviserModelSelection,
  getStoredReviserModelSelectionOverride,
  getStoredTranslatorModelSelection,
  getStoredTranslatorModelSelectionOverride,
  resolveStartupModelSelection,
} from './preferences.js';
import { syncSelectTitle } from './ui.js';

export async function loadModelsAndSelectDefault(container, onModelSelected, onCorrectionModelSelected) {
  const select = container.querySelector('#modelSelect');
  const correctionSelect = container.querySelector('#correctionModelSelect');

  try {
    const [modelsResponse, configResponse] = await Promise.all([
      api.getModels(),
      api.getDefaultModel(),
    ]);

    const models = modelsResponse;
    const defaultModel = configResponse.default_model;
    const correctionEnabled = Boolean(configResponse.second_pass_enabled);
    const defaultCorrectionModel = String(configResponse.second_pass_model || '');

    populateModelSelect(select, models, 'No translator');
    populateModelSelect(correctionSelect, models, 'No reviser');

    const modelIds = models.map((model) => model.id);
    const translatorStored = getStoredTranslatorModelSelection();
    const reviserStored = getStoredReviserModelSelection();
    const translatorStoredOverride = getStoredTranslatorModelSelectionOverride();
    const reviserStoredOverride = getStoredReviserModelSelectionOverride();

    select.value = resolveStartupModelSelection({
      storedValue: translatorStoredOverride ? translatorStored : null,
      defaultValue: defaultModel,
      validModelIds: modelIds,
      preferStored: translatorStoredOverride,
      defaultWhenMissing: '',
    });
    onModelSelected?.(select.value);
    syncSelectTitle(select);

    const correctionDefault = (
      correctionEnabled && defaultCorrectionModel && modelIds.includes(defaultCorrectionModel)
    ) ? defaultCorrectionModel : '';
    correctionSelect.value = resolveStartupModelSelection({
      storedValue: reviserStoredOverride ? reviserStored : null,
      defaultValue: correctionDefault,
      validModelIds: modelIds,
      preferStored: reviserStoredOverride,
      defaultWhenMissing: '',
    });
    onCorrectionModelSelected?.(correctionSelect.value);
    syncSelectTitle(correctionSelect);
    container.__modelOptionsInitialized = true;
  } catch (err) {
    console.error('Failed to load models:', err);
    populateModelSelect(select, [], 'No translator');
    populateModelSelect(correctionSelect, [], 'No reviser');
    container.__modelOptionsInitialized = false;
    onModelSelected?.('');
    onCorrectionModelSelected?.('');
    syncSelectTitle(select);
    syncSelectTitle(correctionSelect);
  }
}

export async function refreshModelOptions(container, currentModel, currentCorrectionModel) {
  const select = container.querySelector('#modelSelect');
  const correctionSelect = container.querySelector('#correctionModelSelect');
  if (!select || !correctionSelect) return;

  try {
    const models = await api.getModels();
    const modelIds = models.map((model) => model.id);
    const selectedModel = currentModel && currentModel !== '(none)' ? currentModel : '';
    const selectedCorrectionModel = currentCorrectionModel || '';

    populateModelSelect(select, models, 'No translator');
    populateModelSelect(correctionSelect, models, 'No reviser');

    select.value = modelIds.includes(selectedModel) ? selectedModel : '';
    correctionSelect.value = modelIds.includes(selectedCorrectionModel) ? selectedCorrectionModel : '';
    syncSelectTitle(select);
    syncSelectTitle(correctionSelect);
  } catch (err) {
    console.error('Failed to refresh replay model options:', err);
  }
}

function populateModelSelect(select, models, emptyLabel) {
  if (!select) return;
  select.innerHTML = `<option value="">${emptyLabel}</option>`;
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    select.appendChild(option);
  });
}
