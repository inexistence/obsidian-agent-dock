function containsSensitiveText(text) {
  return /(api[_-]?key|password|passwd|secret|token|bearer|private[_-]?key|ssh-rsa|sk-[a-z0-9]|密码|密钥|令牌)/i.test(text);
}

function redactSensitiveText(text) {
  return containsSensitiveText(text) ? "[Sensitive content omitted]" : String(text || "");
}

module.exports = {
  containsSensitiveText,
  redactSensitiveText
};
