const assert = require("assert");

const {
  formatMessageTime,
  formatMessageTimeIso,
  formatMessageTimeTitle
} = require("../src/view/utils/messageTime");

const today = new Date(2026, 6, 4, 9, 7, 8).getTime();
const laterToday = new Date(2026, 6, 4, 18, 30, 0).getTime();
const yesterday = new Date(2026, 6, 3, 9, 7, 8).getTime();

{
  const formatted = formatMessageTime(today, { language: "en", now: laterToday });
  assert.match(formatted, /9:07/);
  assert.doesNotMatch(formatted, /Jul|2026/);
}

{
  const formatted = formatMessageTime(yesterday, { language: "en", now: laterToday });
  assert.match(formatted, /Jul/);
  assert.match(formatted, /3/);
  assert.match(formatted, /9:07/);
}

{
  const formatted = formatMessageTime(today, { language: "zh", now: laterToday });
  assert.match(formatted, /09:07/);
}

{
  const title = formatMessageTimeTitle(today, { language: "en" });
  assert.match(title, /2026/);
  assert.match(title, /9:07/);
}

assert.strictEqual(formatMessageTimeIso(String(today)), new Date(today).toISOString());
assert.strictEqual(formatMessageTime(0), "");
assert.strictEqual(formatMessageTime("not a timestamp"), "");
assert.strictEqual(formatMessageTimeIso("not a timestamp"), "");

console.log("message time tests passed");
