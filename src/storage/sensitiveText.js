function containsSensitiveText(text) {
  return /(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret|token|bearer|private[_-]?key|ssh-rsa|BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY|sk-[a-z0-9]|ghp_[a-z0-9]|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{16}|密码|密钥|私钥|令牌|凭证)/i.test(text);
}

function redactSensitiveText(text) {
  return containsSensitiveText(text) ? "[Sensitive content omitted]" : String(text || "");
}

module.exports = {
  containsSensitiveText,
  redactSensitiveText
};
