const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { parseArgsTemplate, withJsonOutput, withModel, withOutputLastMessage } = require("../../cli/args");
const { buildCliPath } = require("../../cli/env");
const { t } = require("../../i18n");
const { applyModeArgs } = require("../../modes");
const { DEFAULT_SETTINGS } = require("../../settings");
const { buildAgentTurnContext, emitDebugPromptActivity } = require("../shared/TurnContextBuilder");
const { applyVisibleEventPolicy } = require("../shared/visibleEventPolicy");
const { codexJsonEventToUpdates, updateLatestAgentMessageOutput } = require("./jsonEvents");
const { listCodexModels } = require("./ModelCatalog");

class CodexAgent {
  constructor(plugin) {
    this.plugin = plugin;
    this.id = "codex";
    this.label = "Codex";
    this.children = new Set();
  }

  async run(prompt, onUpdate, conversation, options = {}) {
    const settings = this.plugin.settings;
    const translate = (key, params) => t(settings, key, params);
    const turnContext = await buildAgentTurnContext({
      plugin: this.plugin,
      settings,
      prompt,
      conversation,
      onUpdate,
      translate,
      useFullPrompt: true
    });
    const outputPath = path.join(os.tmpdir(), `obsidian-agent-dock-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    const args = withJsonOutput(withOutputLastMessage(applyModeArgs(
      withModel(
        parseArgsTemplate(settings.args, turnContext.promptResult.prompt, DEFAULT_SETTINGS.args),
        this.getModel(options.dockSession)
      ),
      settings.mode,
      DEFAULT_SETTINGS.mode
    ), outputPath));
    emitDebugPromptActivity(onUpdate, turnContext.promptResult, settings, translate);

    return new Promise((resolve, reject) => {
      let finalOutput = "";
      let errorOutput = "";
      let stdoutBuffer = "";
      let settled = false;
      let aborted = false;
      const child = spawn(settings.codexPath, args, {
        cwd: this.getWorkingDirectory(),
        shell: false,
        env: Object.assign({}, process.env, { PATH: buildCliPath(process.env.PATH), TERM: "dumb" }),
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.children.add(child);

      const cleanup = () => {
        this.children.delete(child);
        options.signal?.removeEventListener("abort", abortRun);
      };
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const abortRun = () => {
        aborted = true;
        child.kill("SIGTERM");
      };
      if (options.signal?.aborted) abortRun();
      else options.signal?.addEventListener("abort", abortRun, { once: true });

      const handleJsonLine = (line) => {
        if (!line.trim()) return;
        try {
          for (const rawUpdate of codexJsonEventToUpdates(JSON.parse(line), translate)) {
            const update = applyVisibleEventPolicy(rawUpdate, settings.mode, translate);
            if (update.kind === "content" && update.agentMessagePhase !== undefined) {
              finalOutput = updateLatestAgentMessageOutput(finalOutput, update);
            }
            onUpdate(update);
          }
        } catch {
          onUpdate({ kind: "activity", title: translate("codex.rawOutput"), detail: line });
        }
      };

      child.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        lines.forEach(handleJsonLine);
      });
      child.stderr.on("data", (data) => {
        errorOutput += data.toString();
        const text = data.toString().trim();
        if (text) onUpdate({ kind: "activity", title: "Codex", detail: text });
      });
      child.on("error", (error) => settle(reject, error));
      child.on("close", async (code) => {
        if (stdoutBuffer.trim()) handleJsonLine(stdoutBuffer);
        const fileOutput = await readOutputFile(outputPath);
        if (!finalOutput.trim() && fileOutput) {
          finalOutput = fileOutput;
          onUpdate({ kind: "content", text: fileOutput });
        }
        if (aborted) return settle(reject, createAbortError(translate));
        if (code === 0) return settle(resolve, finalOutput.trim());
        const details = [errorOutput.trim(), fileOutput.trim()].filter(Boolean).join("\n\n");
        settle(reject, new Error(details || translate("codex.exitedWithCode", { code })));
      });
    });
  }

  cancelAll() {
    for (const child of this.children) child.kill("SIGTERM");
    this.children.clear();
  }

  getWorkingDirectory() {
    return this.plugin.settings.workingDirectory || this.plugin.app.vault.adapter.basePath;
  }

  getModel(dockSession) {
    return String(dockSession?.providerState?.codex?.model || "");
  }

  setModel(dockSession, model) {
    if (!dockSession) return;
    if (!dockSession.providerState || typeof dockSession.providerState !== "object") {
      dockSession.providerState = {};
    }
    dockSession.providerState.codex = { model: normalizeModel(model) };
  }

  async getModelCatalog() {
    return listCodexModels({
      executablePath: this.plugin.settings.codexPath,
      cwd: this.getWorkingDirectory(),
      env: Object.assign({}, process.env, { PATH: buildCliPath(process.env.PATH), TERM: "dumb" })
    });
  }
}

function normalizeModel(value) {
  return String(value || "").trim().slice(0, 120);
}

async function readOutputFile(outputPath) {
  try {
    const content = await fs.readFile(outputPath, "utf8");
    await fs.unlink(outputPath).catch(() => {});
    return content;
  } catch {
    return "";
  }
}

function createAbortError(translate) {
  const error = new Error(translate("codex.abortError"));
  error.name = "AbortError";
  return error;
}

module.exports = { CodexAgent };
