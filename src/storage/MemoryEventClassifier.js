const GENERIC_EVENT_TOPICS = new Set(["work_progress", "project_task"]);
const TIMELINE_EVENT_TOPICS = new Set(["commute_home", "travel"]);

function deriveEventTopic(text) {
  const source = compactText(text).toLowerCase();
  if (/(?:下班|离开公司|回家|到家|通勤|leave work|go home|arrive home|commute)/i.test(source)) {
    return "commute_home";
  }
  if (/(?:出发|到达|抵达|路上|depart|arrive|on the way)/i.test(source)) {
    return "travel";
  }
  if (/(?:完成|实现|修复|测试|构建|提交|finish|implement|fix|test|build|commit)/i.test(source)) {
    return "work_progress";
  }
  return "";
}

function inferEventStatus(text) {
  const source = String(text || "");
  if (/(?:取消|不去了|cancelled|canceled)/i.test(source)) {
    return "cancelled";
  }
  if (/(?:到家|到达|抵达|已经完成|已完成|完成了|finished|completed|arrived)/i.test(source)) {
    return "completed";
  }
  if (/(?:正在|出发|离开|路上|in progress|leaving|on the way)/i.test(source)) {
    return "active";
  }
  if (/(?:准备|计划|待会|稍后|planning|plan to|about to)/i.test(source)) {
    return "planned";
  }
  return "observed";
}

function createEventInstanceKey(topic, occurredAt) {
  if (!TIMELINE_EVENT_TOPICS.has(topic)) {
    return "";
  }
  const timestamp = Number(occurredAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${topic}:${year}-${month}-${day}`;
}

function isGenericEventTopic(topic) {
  return GENERIC_EVENT_TOPICS.has(topic);
}

function isTimelineEventTopic(topic) {
  return TIMELINE_EVENT_TOPICS.has(topic);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  createEventInstanceKey,
  deriveEventTopic,
  inferEventStatus,
  isGenericEventTopic,
  isTimelineEventTopic
};
