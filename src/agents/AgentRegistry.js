const { spawn } = require("child_process");

const { buildCliPath } = require("../cli/env");
const { expandHomePath } = require("../cli/paths");
const { CodexAgent } = require("./codex/CodexAgent");
const { CursorAgent } = require("./cursor/CursorAgent");

const DIAGNOSTIC_TIMEOUT_MS = 5000;

const AGENT_DESCRIPTORS = {
  codex: {
    label: "Codex",
    description: "OpenAI Codex CLI",
    create: (plugin) => new CodexAgent(plugin),
    diagnose: (plugin) => diagnoseProvider({
      configuredPath: plugin.settings.codexPath,
      candidates: ["codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex"],
      authArgs: ["login", "status"]
    })
  },
  cursor: {
    label: "Cursor",
    description: "Cursor CLI via ACP",
    create: (plugin) => new CursorAgent(plugin),
    diagnose: (plugin) => diagnoseProvider({
      configuredPath: expandHomePath(plugin.settings.cursorPath),
      candidates: ["agent", expandHomePath("~/.local/bin/agent"), "/opt/homebrew/bin/agent", "/usr/local/bin/agent"],
      authArgs: ["status"]
    })
  }
};

const AGENT_OPTIONS = Object.fromEntries(
  Object.entries(AGENT_DESCRIPTORS).map(([id, descriptor]) => [id, {
    label: descriptor.label,
    description: descriptor.description
  }])
);

function createAgent(plugin) {
  const descriptor = AGENT_DESCRIPTORS[plugin.settings.agentId]
    || AGENT_DESCRIPTORS.codex;
  const agent = descriptor.create(plugin);
  if (!agent || typeof agent.run !== "function") {
    throw new Error(`Invalid agent adapter: ${plugin.settings.agentId || "codex"}`);
  }
  return agent;
}

async function diagnoseAgent(plugin, agentId) {
  const descriptor = AGENT_DESCRIPTORS[agentId] || AGENT_DESCRIPTORS.codex;
  return descriptor.diagnose(plugin);
}

async function diagnoseProvider(options) {
  const candidates = uniqueCandidates([options.configuredPath, ...(options.candidates || [])]);
  let lastResult = null;
  for (const executablePath of candidates) {
    const versionResult = await runDiagnosticCommand(executablePath, ["--version"]);
    lastResult = versionResult;
    if (!versionResult.ok) {
      continue;
    }
    const authResult = await runDiagnosticCommand(executablePath, options.authArgs || []);
    const authStatus = normalizeAuthStatus(authResult);
    const configuredPathFound = executablePath === expandHomePath(options.configuredPath);
    return {
      ok: configuredPathFound,
      executablePath,
      version: firstLine(versionResult.output),
      authStatus,
      message: buildDiagnosticMessage({ configuredPathFound, executablePath, authStatus })
    };
  }
  return {
    ok: false,
    executablePath: expandHomePath(options.configuredPath),
    version: "",
    authStatus: "unknown",
    message: lastResult?.timedOut
      ? "CLI check timed out. Verify the executable and its permissions."
      : "Executable not found at the configured path, on PATH, or in common install locations."
  };
}

function runDiagnosticCommand(executablePath, args) {
  if (!executablePath) {
    return Promise.resolve({ ok: false, output: "", code: null, errorCode: "ENOENT" });
  }
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      windowClearTimeout(timer);
      resolve(Object.assign({ output: output.trim() }, result));
    };
    const child = spawn(executablePath, args, {
      shell: false,
      env: Object.assign({}, process.env, { PATH: buildCliPath(process.env.PATH) }),
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += `${output ? "\n" : ""}${data.toString()}`; });
    child.on("error", (error) => finish({ ok: false, code: null, errorCode: error.code || "", message: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code, errorCode: "" }));
    timer = windowSetTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, code: null, errorCode: "ETIMEDOUT", timedOut: true });
    }, DIAGNOSTIC_TIMEOUT_MS);
  });
}

function normalizeAuthStatus(result) {
  const text = String(result?.output || "").toLowerCase();
  if (/(not logged in|unauthenticated|authentication required|run .*login|please log in|no api key)/.test(text)) {
    return "unauthenticated";
  }
  if (result?.ok && /(logged in|authenticated|api key|active account|ready)/.test(text)) {
    return "authenticated";
  }
  return "unknown";
}

function buildDiagnosticMessage({ configuredPathFound, executablePath, authStatus }) {
  if (!configuredPathFound) {
    return `CLI found at ${executablePath}. Update the configured executable path before running it.`;
  }
  if (authStatus === "unauthenticated") {
    return "CLI is installed but not authenticated. Sign in with the provider CLI, then retry.";
  }
  return authStatus === "authenticated"
    ? "CLI is installed and authenticated."
    : "CLI is installed. Authentication could not be confirmed; run the read-only connection test.";
}

function uniqueCandidates(values) {
  return [...new Set(values.map((value) => expandHomePath(String(value || "").trim())).filter(Boolean))];
}

function firstLine(value) {
  return String(value || "").trim().split(/\r?\n/)[0] || "";
}

function windowSetTimeout(callback, delay) {
  return typeof window !== "undefined" ? window.setTimeout(callback, delay) : setTimeout(callback, delay);
}

function windowClearTimeout(timer) {
  if (timer === undefined) return;
  if (typeof window !== "undefined") window.clearTimeout(timer);
  else clearTimeout(timer);
}

module.exports = {
  AGENT_OPTIONS,
  createAgent,
  diagnoseAgent,
  _test: { buildDiagnosticMessage, normalizeAuthStatus, uniqueCandidates }
};
