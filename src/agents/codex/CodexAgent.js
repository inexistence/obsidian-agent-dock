const { Notice } = require("obsidian");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { parseArgsTemplate, withJsonOutput, withOutputLastMessage } = require("../../cli/args");
const { buildCliPath } = require("../../cli/env");
const { escapeAppleScriptString, shellQuote } = require("../../cli/shell");
const { applyModeArgs } = require("../../modes");
const { buildPromptWithMetadata } = require("../../prompt");
const { DEFAULT_SETTINGS } = require("../../settings");
const { formatMemoryLine } = require("../../storage/MemoryStore");
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
    const cwd = this.getWorkingDirectory();
    const activeFilePath = this.plugin.app.workspace.getActiveFile()?.path || "";
    const memories = await this.plugin.memoryStore.getRelevantMemories(prompt, settings, {
      activeFilePath,
      workingDirectory: cwd
    });
    const promptResult = await buildPromptWithMetadata(this.plugin.app, settings, prompt, conversation, { memories });
    const finalPrompt = promptResult.prompt;
    if (promptResult.context.memoryCount > 0) {
      const memorySummary = formatMemoryNoticeSummary(memories);
      onUpdate({
        kind: "notice",
        title: "Memory included",
        summary: memorySummary,
        detail: memories.map(formatMemoryLine).join("\n")
      });
    }
    if (promptResult.context.compressed) {
      onUpdate({
        kind: "notice",
        title: "Context compressed",
        summary: `Compressed ${formatNumber(promptResult.context.originalChars)} chars into ${formatNumber(promptResult.context.promptChars)} / ${formatNumber(promptResult.context.limitChars)} chars.`
      });
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
          const updates = codexJsonEventToUpdates(event);
          for (const update of updates) {
            if (update.kind === "content") {
              finalOutput += update.text;
            }
            onUpdate(update);
          }
        } catch {
          onUpdate({ kind: "activity", title: "Raw output", detail: line });
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
          settle(reject, createAbortError());
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
        settle(reject, new Error(details || `Codex exited with code ${code}`));
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
      new Notice("Interactive Codex launch is currently implemented for macOS Terminal.");
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

        reject(new Error(errorOutput.trim() || `Terminal exited with code ${code}`));
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
          title: "Memory updated",
          summary: `Saved ${saved.length} automatic ${saved.length === 1 ? "memory" : "memories"} for future chats.`
        });
      }
    } catch (error) {
      console.warn("Agent Dock could not update memory:", error);
      onUpdate({
        kind: "notice",
        title: "Memory skipped",
        summary: "Agent Dock could not save automatic memory. Check the console for details."
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

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function formatMemoryNoticeSummary(memories) {
  const count = memories.length;
  const lines = [
    `Added ${count} relevant local ${count === 1 ? "memory" : "memories"} to the prompt.`
  ];
  const visibleMemories = memories.slice(0, 5).map(formatMemoryLine);
  lines.push(...visibleMemories);
  if (memories.length > visibleMemories.length) {
    lines.push(`- ... ${memories.length - visibleMemories.length} more`);
  }
  return lines.join("\n");
}

function createAbortError() {
  const error = new Error("Codex run was stopped.");
  error.name = "AbortError";
  return error;
}

module.exports = {
  CodexAgent
};
