const { Notice } = require("obsidian");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { parseArgsTemplate, withJsonOutput, withOutputLastMessage } = require("../../cli/args");
const { buildCliPath } = require("../../cli/env");
const { escapeAppleScriptString, shellQuote } = require("../../cli/shell");
const { t } = require("../../i18n");
const { applyModeArgs } = require("../../modes");
const { buildPromptWithMetadata } = require("../../prompt");
const { DEFAULT_SETTINGS } = require("../../settings");
const {
  emitContextCompressedNotice,
  emitMemoryNotice
} = require("../shared/memoryNotices");
const {
  getExplicitMemorySearch,
  removeMemorySearchDuplicates
} = require("../shared/memorySearch");
const { codexJsonEventToUpdates } = require("./jsonEvents");

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
    const cwd = this.getWorkingDirectory();
    const activeFilePath = this.plugin.app.workspace.getActiveFile()?.path || "";
    const memories = await this.plugin.memoryStore.getRelevantMemories(prompt, settings, {
      activeFilePath,
      workingDirectory: cwd
    });
    const memorySearch = await getExplicitMemorySearch(
      this.plugin.memoryStore,
      prompt,
      settings,
      onUpdate,
      translate,
      "codex"
    );
    const promptMemories = removeMemorySearchDuplicates(memories, memorySearch.results);
    const promptResult = await buildPromptWithMetadata(this.plugin.app, settings, prompt, conversation, {
      memories: promptMemories,
      memorySearchResults: memorySearch.results,
      memorySearchPerformed: memorySearch.performed
    });
    const finalPrompt = promptResult.prompt;
    if (promptMemories.length > 0) {
      emitMemoryNotice(onUpdate, promptMemories, translate, "codex");
    }
    if (promptResult.context.compressed) {
      emitContextCompressedNotice(onUpdate, promptResult.context, translate, "codex");
    }
    const outputPath = path.join(
      os.tmpdir(),
      `obsidian-agent-dock-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
    );
    const args = withJsonOutput(
      withOutputLastMessage(
        applyModeArgs(
          parseArgsTemplate(settings.args, finalPrompt, DEFAULT_SETTINGS.args),
          settings.mode,
          DEFAULT_SETTINGS.mode
        ),
        outputPath
      )
    );

    return new Promise((resolve, reject) => {
      let finalOutput = "";
      let errorOutput = "";
      let stdoutBuffer = "";
      let settled = false;
      let aborted = false;

      const child = spawn(settings.codexPath, args, {
        cwd,
        shell: false,
        env: Object.assign({}, process.env, {
          PATH: buildCliPath(process.env.PATH),
          TERM: "dumb"
        }),
        stdio: ["ignore", "pipe", "pipe"]
      });
      this.children.add(child);

      const cleanup = () => {
        this.children.delete(child);
        options.signal?.removeEventListener("abort", abortRun);
      };

      const settle = (callback, value) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback(value);
      };

      const abortRun = () => {
        aborted = true;
        child.kill("SIGTERM");
      };

      if (options.signal?.aborted) {
        abortRun();
      } else {
        options.signal?.addEventListener("abort", abortRun, { once: true });
      }

      const handleJsonLine = (line) => {
        if (!line.trim()) {
          return;
        }

        try {
          const event = JSON.parse(line);
          const updates = codexJsonEventToUpdates(event, translate);
          for (const update of updates) {
            if (update.kind === "content") {
              finalOutput += update.text;
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
        for (const line of lines) {
          handleJsonLine(line);
        }
      });

      child.stderr.on("data", (data) => {
        errorOutput += data.toString();
        const text = data.toString().trim();
        if (text) {
          onUpdate({ kind: "activity", title: "Codex", detail: text });
        }
      });

      child.on("error", (error) => settle(reject, error));
      child.on("close", async (code) => {
        if (stdoutBuffer.trim()) {
          handleJsonLine(stdoutBuffer);
        }

        const fileOutput = await readOutputFile(outputPath);
        if (!finalOutput.trim() && fileOutput) {
          finalOutput = fileOutput;
          onUpdate({ kind: "content", text: fileOutput });
        }

        if (aborted) {
          settle(reject, createAbortError(translate));
          return;
        }

        if (code === 0) {
          await this.captureMemory({
            prompt,
            response: finalOutput.trim(),
            activeFilePath,
            sessionId: options.sessionId || ""
          }, settings, onUpdate);
          settle(resolve, finalOutput.trim());
          return;
        }

        const details = [errorOutput.trim(), fileOutput.trim()]
          .filter(Boolean)
          .join("\n\n");
        settle(reject, new Error(details || translate("codex.exitedWithCode", { code })));
      });
    });
  }

  cancelAll() {
    for (const child of this.children) {
      child.kill("SIGTERM");
    }
    this.children.clear();
  }

  async openInteractive() {
    if (process.platform !== "darwin") {
      new Notice(t(this.plugin.settings, "codex.terminalMacOnly"));
      return;
    }

    const settings = this.plugin.settings;
    const cwd = this.getWorkingDirectory();
    const command = [
      `cd ${shellQuote(cwd)}`,
      `${shellQuote(settings.codexPath)} ${settings.interactiveArgs || ""}`.trim()
    ].join(" && ");
    const script = [
      "tell application \"Terminal\"",
      "activate",
      `do script "${escapeAppleScriptString(command)}"`,
      "end tell"
    ].join("\n");

    await new Promise((resolve, reject) => {
      const child = spawn("osascript", ["-e", script], {
        env: Object.assign({}, process.env, {
          PATH: buildCliPath(process.env.PATH)
        }),
        stdio: ["ignore", "pipe", "pipe"]
      });

      let errorOutput = "";
      child.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(errorOutput.trim() || t(settings, "codex.terminalExitedWithCode", { code })));
      });
    });
  }

  getWorkingDirectory() {
    return this.plugin.settings.workingDirectory || this.plugin.app.vault.adapter.basePath;
  }

  async captureMemory(turn, settings, onUpdate) {
    try {
      const saved = await this.plugin.memoryStore.captureTurn(turn, settings);
      if (saved.length > 0) {
        onUpdate({
          kind: "notice",
          title: t(settings, "codex.memoryUpdated.title"),
          summary: t(settings, "codex.memoryUpdated.summary", {
            count: saved.length,
            noteLabel: saved.length === 1 ? "note" : "notes"
          })
        });
      }
    } catch (error) {
      console.warn("Agent Dock could not update memory:", error);
      onUpdate({
        kind: "notice",
        title: t(settings, "codex.memorySkipped.title"),
        summary: t(settings, "codex.memorySkipped.summary")
      });
    }
  }
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

module.exports = {
  CodexAgent
};
