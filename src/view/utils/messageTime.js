const LANGUAGE_LOCALES = {
  en: "en-US",
  zh: "zh-CN"
};

function formatMessageTime(timestamp, options = {}) {
  const date = normalizeDate(timestamp);
  if (!date) {
    return "";
  }

  const now = normalizeDate(options.now) || new Date();
  const locale = LANGUAGE_LOCALES[options.language] || LANGUAGE_LOCALES.en;
  const timeOptions = { hour: "2-digit", minute: "2-digit" };
  const dateOptions = isSameLocalDate(date, now)
    ? timeOptions
    : { month: "short", day: "numeric", ...timeOptions };

  return new Intl.DateTimeFormat(locale, dateOptions).format(date);
}

function formatMessageTimeTitle(timestamp, options = {}) {
  const date = normalizeDate(timestamp);
  if (!date) {
    return "";
  }

  const locale = LANGUAGE_LOCALES[options.language] || LANGUAGE_LOCALES.en;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatMessageTimeIso(timestamp) {
  const date = normalizeDate(timestamp);
  return date ? date.toISOString() : "";
}

function normalizeDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameLocalDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

module.exports = {
  formatMessageTime,
  formatMessageTimeIso,
  formatMessageTimeTitle,
  _test: {
    isSameLocalDate,
    normalizeDate
  }
};
