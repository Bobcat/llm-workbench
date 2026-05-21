import { escapeAttr, escapeHtml } from './ui-helpers.js';

export const TRANSLATION_LANGUAGES = [
  {code: 'en', flag: '🇬🇧', name: 'English'},
  {code: 'nl', flag: '🇳🇱', name: 'Dutch'},
  {code: 'de', flag: '🇩🇪', name: 'German'},
  {code: 'fr', flag: '🇫🇷', name: 'French'},
  {code: 'es', flag: '🇪🇸', name: 'Spanish'},
  {code: 'it', flag: '🇮🇹', name: 'Italian'},
  {code: 'pt', flag: '🇵🇹', name: 'Portuguese'},
  {code: 'ru', flag: '🇷🇺', name: 'Russian'},
  {code: 'zh', flag: '🇨🇳', name: 'Chinese'},
  {code: 'ja', flag: '🇯🇵', name: 'Japanese'},
  {code: 'ko', flag: '🇰🇷', name: 'Korean'},
  {code: 'pl', flag: '🇵🇱', name: 'Polish'},
  {code: 'uk', flag: '🇺🇦', name: 'Ukrainian'},
  {code: 'tr', flag: '🇹🇷', name: 'Turkish'},
  {code: 'ar', flag: '🇸🇦', name: 'Arabic'},
  {code: 'hi', flag: '🇮🇳', name: 'Hindi'},
  {code: 'el', flag: '🇬🇷', name: 'Greek'},
  {code: 'cs', flag: '🇨🇿', name: 'Czech'},
  {code: 'da', flag: '🇩🇰', name: 'Danish'},
  {code: 'fi', flag: '🇫🇮', name: 'Finnish'},
  {code: 'hu', flag: '🇭🇺', name: 'Hungarian'},
  {code: 'no', flag: '🇳🇴', name: 'Norwegian'},
  {code: 'ro', flag: '🇷🇴', name: 'Romanian'},
  {code: 'sk', flag: '🇸🇰', name: 'Slovak'},
  {code: 'sv', flag: '🇸🇪', name: 'Swedish'},
  {code: 'th', flag: '🇹🇭', name: 'Thai'},
  {code: 'vi', flag: '🇻🇳', name: 'Vietnamese'},
  {code: 'id', flag: '🇮🇩', name: 'Indonesian'},
  {code: 'ms', flag: '🇲🇾', name: 'Malay'},
  {code: 'he', flag: '🇮🇱', name: 'Hebrew'},
  {code: 'fa', flag: '🇮🇷', name: 'Persian'},
  {code: 'bg', flag: '🇧🇬', name: 'Bulgarian'},
  {code: 'ca', flag: '🇪🇸', name: 'Catalan'},
  {code: 'hr', flag: '🇭🇷', name: 'Croatian'},
  {code: 'lt', flag: '🇱🇹', name: 'Lithuanian'},
  {code: 'lv', flag: '🇱🇻', name: 'Latvian'},
  {code: 'sl', flag: '🇸🇮', name: 'Slovenian'},
  {code: 'sr', flag: '🇷🇸', name: 'Serbian'},
  {code: 'et', flag: '🇪🇪', name: 'Estonian'},
];

export function normalizeTranslationLanguage(language, fallbackLanguage = 'English') {
  const value = String(language || '').trim();
  if (!value) {
    return fallbackLanguage;
  }

  const normalizedValue = value.toLowerCase();
  const match = TRANSLATION_LANGUAGES.find((item) => (
    item.name.toLowerCase() === normalizedValue || item.code.toLowerCase() === normalizedValue
  ));
  return match ? match.name : value;
}

export function populateTranslationLanguageSelect(select, selectedLanguage, options = {}) {
  if (!select) return '';

  const includeUnknown = options.includeUnknown === true;
  const normalizedSelected = normalizeTranslationLanguage(selectedLanguage);
  let hasSelectedOption = false;

  const markup = TRANSLATION_LANGUAGES.map((language) => {
    if (language.name === normalizedSelected) {
      hasSelectedOption = true;
    }
    return `<option value="${escapeAttr(language.name)}">${escapeHtml(`${language.flag} ${language.name}`.trim())}</option>`;
  });

  if (includeUnknown && normalizedSelected && !hasSelectedOption) {
    markup.push(`<option value="${escapeAttr(normalizedSelected)}">${escapeHtml(normalizedSelected)}</option>`);
  }

  select.innerHTML = markup.join('');
  const fallbackValue = hasSelectedOption || (includeUnknown && normalizedSelected)
    ? normalizedSelected
    : (TRANSLATION_LANGUAGES[0]?.name || normalizedSelected);
  select.value = fallbackValue;
  return fallbackValue;
}
