import { normalizeTranslationLanguage as normalizeReplayLanguage } from '../../shared/translation-languages.js';

const REPLAY_TRANSLATOR_MODEL_STORAGE_KEY = 'replay.translator_model';
const REPLAY_REVISER_MODEL_STORAGE_KEY = 'replay.reviser_model';
const REPLAY_TRANSLATOR_MODEL_OVERRIDE_STORAGE_KEY = 'replay.translator_model_user_override';
const REPLAY_REVISER_MODEL_OVERRIDE_STORAGE_KEY = 'replay.reviser_model_user_override';
const REPLAY_SPEED_STORAGE_KEY = 'replay.speed';
const REPLAY_POLICY_STORAGE_KEY = 'replay.policy';
const REPLAY_SOURCE_LANGUAGE_STORAGE_KEY = 'replay.source_language';
const REPLAY_TARGET_LANGUAGE_STORAGE_KEY = 'replay.target_language';

export function resolveStartupModelSelection({
  storedValue,
  defaultValue,
  validModelIds,
  preferStored = false,
  defaultWhenMissing = '',
}) {
  const validIds = Array.isArray(validModelIds) ? validModelIds : [];
  const tryStoredValue = () => {
    if (storedValue === null) {
      return null;
    }
    const normalizedStored = String(storedValue || '');
    if (normalizedStored === '' || validIds.includes(normalizedStored)) {
      return normalizedStored;
    }
    return null;
  };

  const tryDefaultValue = () => {
    const normalizedDefault = String(defaultValue || '');
    if (normalizedDefault !== '' && validIds.includes(normalizedDefault)) {
      return normalizedDefault;
    }
    return null;
  };

  const preferredValue = preferStored ? tryStoredValue() : tryDefaultValue();
  if (preferredValue !== null) {
    return preferredValue;
  }

  const fallbackValue = preferStored ? tryDefaultValue() : tryStoredValue();
  if (fallbackValue !== null) {
    return fallbackValue;
  }

  return defaultWhenMissing;
}

export function getStoredTranslatorModelSelection() {
  return getStoredString(REPLAY_TRANSLATOR_MODEL_STORAGE_KEY);
}

export function getStoredReviserModelSelection() {
  return getStoredString(REPLAY_REVISER_MODEL_STORAGE_KEY);
}

export function getStoredTranslatorModelSelectionOverride() {
  return getStoredBoolean(REPLAY_TRANSLATOR_MODEL_OVERRIDE_STORAGE_KEY);
}

export function getStoredReviserModelSelectionOverride() {
  return getStoredBoolean(REPLAY_REVISER_MODEL_OVERRIDE_STORAGE_KEY);
}

export function getStoredReplaySpeedSelection() {
  return getStoredString(REPLAY_SPEED_STORAGE_KEY);
}

export function getStoredReplayPolicySelection() {
  return getStoredString(REPLAY_POLICY_STORAGE_KEY);
}

export function getStoredReplaySourceLanguageSelection() {
  return getStoredString(REPLAY_SOURCE_LANGUAGE_STORAGE_KEY);
}

export function getStoredReplayTargetLanguageSelection() {
  return getStoredString(REPLAY_TARGET_LANGUAGE_STORAGE_KEY);
}

export function persistTranslatorModelSelection(model) {
  const normalized = normalizeModelForStorage(model);
  setStoredString(REPLAY_TRANSLATOR_MODEL_STORAGE_KEY, normalized);
}

export function persistReviserModelSelection(model) {
  const normalized = normalizeModelForStorage(model);
  setStoredString(REPLAY_REVISER_MODEL_STORAGE_KEY, normalized);
}

export function persistTranslatorModelSelectionOverride(enabled) {
  setStoredBoolean(REPLAY_TRANSLATOR_MODEL_OVERRIDE_STORAGE_KEY, enabled);
}

export function persistReviserModelSelectionOverride(enabled) {
  setStoredBoolean(REPLAY_REVISER_MODEL_OVERRIDE_STORAGE_KEY, enabled);
}

export function persistReplaySpeedSelection(speed) {
  const normalized = normalizeSpeedForStorage(speed);
  setStoredString(REPLAY_SPEED_STORAGE_KEY, normalized);
}

export function persistReplayPolicySelection(policy) {
  const normalized = normalizePolicyForStorage(policy);
  setStoredString(REPLAY_POLICY_STORAGE_KEY, normalized);
}

export function persistReplaySourceLanguageSelection(language) {
  const normalized = normalizeReplayLanguage(language);
  setStoredString(REPLAY_SOURCE_LANGUAGE_STORAGE_KEY, normalized);
}

export function persistReplayTargetLanguageSelection(language) {
  const normalized = normalizeReplayLanguage(language);
  setStoredString(REPLAY_TARGET_LANGUAGE_STORAGE_KEY, normalized);
}

export function normalizeSpeedForStorage(speed) {
  const value = String(speed || '').trim().toLowerCase();
  if (
    value === 'slow' ||
    value === 'normal' ||
    value === 'fast' ||
    value === 'fast2' ||
    value === 'fast3' ||
    value === 'fast4' ||
    value === 'fast5' ||
    value === 'fast6' ||
    value === 'fast7' ||
    value === 'fastest' ||
    value === 'recorded_1x' ||
    value === 'recorded_2x' ||
    value === 'recorded_5x' ||
    value === 'recorded_10x' ||
    value === 'recorded_max'
  ) {
    return value;
  }
  return 'normal';
}

export function normalizePolicyForStorage(policy) {
  const value = String(policy || '').trim().toLowerCase();
  if (value === 'live' || value === 'replay') {
    return value;
  }
  return 'replay';
}

export function initializeStoredSpeedSelection(select, onSpeedSelected) {
  if (!select) return;
  const stored = getStoredReplaySpeedSelection();
  const resolved = normalizeSpeedForStorage(stored);
  select.value = resolved;
  onSpeedSelected?.(resolved);
}

export function initializeStoredPolicySelection(select, onPolicySelected) {
  if (!select) return;
  const stored = getStoredReplayPolicySelection();
  const resolved = normalizePolicyForStorage(stored);
  select.value = resolved;
  onPolicySelected?.(resolved);
}

function normalizeModelForStorage(model) {
  const value = String(model || '').trim();
  if (!value || value === '(none)') {
    return '';
  }
  return value;
}

function getStoredString(key) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? null : String(value);
  } catch {
    return null;
  }
}

function getStoredBoolean(key) {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function setStoredString(key, value) {
  try {
    window.localStorage.setItem(key, String(value || ''));
  } catch {
    // Ignore storage failures (private mode/quota/etc.).
  }
}

function setStoredBoolean(key, value) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Ignore storage failures (private mode/quota/etc.).
  }
}
