const { spawn } = require("child_process");

const { buildCliPath } = require("../../cli/env");

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const AUTHENTICATE_REQUEST_TIMEOUT_MS = 15000;
const SESSION_REQUEST_TIMEOUT_MS = 60000;
const CANCEL_REQUEST_TIMEOUT_MS = 5000;
const LONG_RUNNING_METHODS = new Set([
  "session/prompt"
]);
const METHOD_REQUEST_TIMEOUTS = {
  authenticate: AUTHENTICATE_REQUEST_TIMEOUT_MS,
  "session/cancel": CANCEL_REQUEST_TIMEOUT_MS,
  "session/load": SESSION_REQUEST_TIMEOUT_MS,
  "session/new": SESSION_REQUEST_TIMEOUT_MS
};

class AcpClient {
  constructor(options = {}) {
    this.executablePath = options.executablePath;
    this.extraArgs = options.extraArgs || [];
    this.cwd = options.cwd || process.cwd();
    this.permissionPolicy = options.permissionPolicy || "allow-once";
    this.onSessionUpdate = options.onSessionUpdate || (() => {});
    this.onExtensionNotice = options.onExtensionNotice || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onStderr = options.onStderr || (() => {});
    this.onProcessClose = options.onProcessClose || (() => {});
    this.requestTimeoutMs = Number(options.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;

    this.child = null;
    this.stdoutBuffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.initialized = false;
    this.closed = false;
    this.activeAcpSessionId = "";
  }

  isAlive() {
    return Boolean(this.child && !this.closed);
  }

  async connect() {
    if (this.child && !this.closed) {
      return;
    }

    if (this.child) {
      this.child = null;
    }

    this.closed = false;
    this.stdoutBuffer = "";
    this.initialized = false;
    this.activeAcpSessionId = "";

    const args = [...this.extraArgs, "acp"];
    this.log("start", {
      executablePath: this.executablePath,
      cwd: this.cwd,
      extraArgCount: this.extraArgs.length
    });
    this.child = spawn(this.executablePath, args, {
      cwd: this.cwd,
      shell: false,
      env: Object.assign({}, process.env, {
        PATH: buildCliPath(process.env.PATH),
        TERM: "dumb"
      }),
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.trim()) {
        this.onStderr(text);
      }
    });
    this.child.on("error", (error) => {
      this.handleProcessExit(error);
    });
    this.child.on("close", () => {
      this.handleProcessExit(new Error("ACP process closed"));
    });

    await this.send("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: {
        name: "obsidian-agent-dock",
        version: "1.0.0"
      }
    });

    this.log("authenticating", { methodId: "cursor_login" });
    await this.send("authenticate", { methodId: "cursor_login" });
    this.log("authenticated", { methodId: "cursor_login" });
    this.initialized = true;
  }

  async createSession(mode) {
    await this.connect();
    const result = await this.send("session/new", {
      cwd: this.cwd,
      mode,
      mcpServers: []
    });
    this.activeAcpSessionId = result.sessionId || result.id || "";
    return this.activeAcpSessionId;
  }

  async loadSession(acpSessionId, mode) {
    await this.connect();
    const result = await this.send("session/load", {
      sessionId: acpSessionId,
      cwd: this.cwd,
      mode,
      mcpServers: []
    });
    this.activeAcpSessionId = result.sessionId || acpSessionId;
    return this.activeAcpSessionId;
  }

  async prompt(acpSessionId, text) {
    await this.connect();
    const sessionId = acpSessionId || this.activeAcpSessionId;
    return this.send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }]
    });
  }

  async cancelPrompt(acpSessionId) {
    if (!this.child || this.closed) {
      return;
    }

    const sessionId = acpSessionId || this.activeAcpSessionId;
    if (!sessionId) {
      return;
    }

    try {
      await this.send("session/cancel", { sessionId });
    } catch {
      // Ignore cancel failures while shutting down.
    }
  }

  async close() {
    if (!this.child && this.closed) {
      return;
    }

    this.closed = true;
    this.rejectAllPending(new Error("ACP client closed"));
    if (this.child) {
      this.child.stdin?.end();
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.initialized = false;
    this.activeAcpSessionId = "";
  }

  send(method, params) {
    if (!this.child || this.closed) {
      return Promise.reject(new Error("ACP process is not running"));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    this.log("send", {
      id,
      method,
      summary: summarizeRequestParams(method, params)
    });
    return new Promise((resolve, reject) => {
      const timeout = this.createRequestTimeout(id, method, reject);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(payload, (error) => {
        if (error) {
          this.deletePending(id);
          reject(error);
        }
      });
    });
  }

  createRequestTimeout(id, method, reject) {
    const timeoutMs = this.getRequestTimeoutMs(method);
    if (timeoutMs <= 0) {
      return null;
    }

    return setTimeout(() => {
      this.pending.delete(id);
      this.log("timeout", { id, method, timeoutMs });
      reject(new Error(`ACP request timed out: ${method}`));
    }, timeoutMs);
  }

  getRequestTimeoutMs(method) {
    if (LONG_RUNNING_METHODS.has(method)) {
      return 0;
    }
    return METHOD_REQUEST_TIMEOUTS[method] || this.requestTimeoutMs;
  }

  deletePending(id) {
    const waiter = this.pending.get(id);
    if (waiter?.timeout) {
      clearTimeout(waiter.timeout);
    }
    this.pending.delete(id);
    return waiter;
  }

  respond(id, result) {
    if (!this.child || this.closed) {
      return;
    }

    const payload = JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n";
    this.child.stdin.write(payload);
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk.toString();
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      this.handleLine(line);
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.onStderr(line);
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiter = this.pending.get(message.id);
      if (!waiter) {
        return;
      }
      this.deletePending(message.id);
      if (message.error) {
        this.log("error", {
          id: message.id,
          message: message.error?.message || "JSON-RPC error"
        });
        waiter.reject(normalizeJsonRpcError(message.error));
      } else {
        this.log("result", {
          id: message.id,
          summary: summarizeResult(message.result)
        });
        waiter.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.log("notification", {
        method: message.method,
        hasId: message.id !== undefined
      });
      this.handleNotification(message);
    }
  }

  handleNotification(message) {
    const { method, params, id } = message;

    if (method === "session/update") {
      const update = params?.update;
      if (update) {
        this.onSessionUpdate(update, params);
      }
      return;
    }

    if (id === undefined) {
      if (method === "cursor/update_todos" || method === "cursor/task" || method === "cursor/generate_image") {
        this.onExtensionNotice(method, params);
      }
      return;
    }

    if (method === "session/request_permission") {
      this.respond(id, {
        outcome: {
          outcome: "selected",
          optionId: this.permissionPolicy
        }
      });
      return;
    }

    if (method === "cursor/ask_question") {
      this.onExtensionNotice(method, params);
      this.respond(id, { outcome: { outcome: "skipped", reason: "Obsidian Agent Dock auto-skipped question." } });
      return;
    }

    if (method === "cursor/create_plan") {
      this.onExtensionNotice(method, params);
      this.respond(id, { outcome: { outcome: "accepted" } });
      return;
    }

    console.warn(`Agent Dock received unsupported ACP request: ${method}`);
    this.respond(id, { outcome: { outcome: "cancelled" } });
  }

  handleProcessExit(error) {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.child = null;
    this.initialized = false;
    this.activeAcpSessionId = "";
    this.log("exit", {
      message: error instanceof Error ? error.message : "ACP process closed"
    });
    this.rejectAllPending(error instanceof Error ? error : new Error("ACP process closed"));
    this.onProcessClose(error instanceof Error ? error : new Error("ACP process closed"));
  }

  rejectAllPending(error) {
    for (const waiter of this.pending.values()) {
      if (waiter.timeout) {
        clearTimeout(waiter.timeout);
      }
      waiter.reject(error);
    }
    this.pending.clear();
  }

  log(event, details = {}) {
    try {
      if (!shouldLogAcpEvent(event, details)) {
        return;
      }
      this.onLog(event, details);
    } catch {
      // Logging must never affect ACP control flow.
    }
  }
}

function shouldLogAcpEvent(event, details) {
  return !(event === "notification" && details?.method === "session/update");
}

function summarizeRequestParams(method, params) {
  if (method === "session/prompt") {
    const prompt = Array.isArray(params?.prompt) ? params.prompt : [];
    const chars = prompt.reduce((sum, part) => sum + String(part?.text || "").length, 0);
    return `session=${params?.sessionId || ""} promptChars=${chars}`;
  }
  if (method === "session/new" || method === "session/load") {
    return `cwd=${params?.cwd || ""} mode=${params?.mode || ""} session=${params?.sessionId || ""}`;
  }
  if (method === "authenticate") {
    return `methodId=${params?.methodId || ""}`;
  }
  if (method === "initialize") {
    return `protocolVersion=${params?.protocolVersion || ""}`;
  }
  return "";
}

function summarizeResult(result) {
  if (!result || typeof result !== "object") {
    return typeof result;
  }
  if (result.sessionId || result.id) {
    return `session=${result.sessionId || result.id}`;
  }
  return Object.keys(result).slice(0, 5).join(",");
}

function normalizeJsonRpcError(error) {
  const code = error?.code;
  const message = error?.message || error?.data || "ACP request failed";
  const wrapped = new Error(typeof message === "string" ? message : JSON.stringify(message));
  wrapped.name = "AcpError";
  if (code !== undefined) {
    wrapped.code = code;
  }
  return wrapped;
}

module.exports = {
  AcpClient
};
