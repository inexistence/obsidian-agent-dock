const en = require("./en");
const zh = require("./zh");

const DEFAULT_LANGUAGE = "en";

const LANGUAGE_PACKS = {
  en,
  zh
};

const LANGUAGE_OPTIONS = Object.fromEntries(
  Object.entries(LANGUAGE_PACKS).map(([id, pack]) => [id, { label: pack.label }])
);

function normalizeLanguage(language) {
  return LANGUAGE_PACKS[language] ? language : DEFAULT_LANGUAGE;
}

function t(settingsOrLanguage, key, params = {}) {
  const language = normalizeLanguage(
    typeof settingsOrLanguage === "string" ? settingsOrLanguage : settingsOrLanguage?.language
  );
  const defaultMessages = LANGUAGE_PACKS[DEFAULT_LANGUAGE]?.messages || {};
  const messages = LANGUAGE_PACKS[language]?.messages || defaultMessages;
  const template = messages[key] || defaultMessages[key] || key;
  return formatTemplate(template, params);
}

function formatTemplate(template, params) {
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined || value === null ? match : String(value);
  });
}

module.exports = {
  DEFAULT_LANGUAGE,
  LANGUAGE_OPTIONS,
  normalizeLanguage,
  t
};
