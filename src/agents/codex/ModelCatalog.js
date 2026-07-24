const { spawn } = require("child_process");

const MODEL_REQUEST_TIMEOUT_MS = 10000;

function listCodexModels(options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(options.executablePath, ["app-server", "--stdio"], {
      cwd: options.cwd || process.cwd(),
      shell: false,
      env: options.env || process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let nextId = 1;
    let catalog = [];
    let configuredDefault = "";
    const timeout = setTimeout(() => finish(new Error("Codex model catalog timed out.")), MODEL_REQUEST_TIMEOUT_MS);

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin?.end();
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(result);
    };
    const send = (method, params) => {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return id;
    };
    const requestModels = (cursor = null) => send("model/list", { cursor, limit: 100 });

    child.on("error", (error) => finish(error));
    child.on("close", () => {
      if (!settled) finish(new Error(stderr.trim() || "Codex app-server closed while listing models."));
    });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.error && message.id !== 2) {
          finish(new Error(message.error.message || "Codex model catalog request failed."));
          return;
        }
        if (message.id === 1) {
          send("config/read", { cwd: options.cwd || process.cwd() });
        } else if (message.id === 2) {
          configuredDefault = String(message.result?.config?.model || "").trim();
          requestModels();
        } else if (message.result?.data && Array.isArray(message.result.data)) {
          catalog = catalog.concat(message.result.data);
          if (message.result.nextCursor) requestModels(message.result.nextCursor);
          else finish(null, normalizeCatalog(catalog, configuredDefault));
        }
      }
    });
    send("initialize", {
      clientInfo: { name: "obsidian-agent-dock", version: "1.0.0" },
      capabilities: null
    });
  });
}

function normalizeCatalog(entries, configuredDefault) {
  const models = entries
    .filter((entry) => entry && !entry.hidden && typeof entry.model === "string" && entry.model)
    .map((entry) => ({ id: entry.model, label: entry.displayName || entry.model, description: entry.description || "" }));
  const catalogDefault = entries.find((entry) => entry?.isDefault)?.model || "";
  const defaultModel = configuredDefault || catalogDefault;
  const defaultEntry = models.find((entry) => entry.id === defaultModel);
  return { models, defaultModel, defaultLabel: defaultEntry?.label || defaultModel };
}

module.exports = { listCodexModels, _test: { normalizeCatalog } };
