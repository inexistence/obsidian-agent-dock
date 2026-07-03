const { Notice } = require("obsidian");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { parseArgsTemplate, withJsonOutput, withOutputLastMessage } = require("../../cli/args");
const { buildCliPath } = require("../../cli/env");
const { escapeAppleScriptString, shellQuote } = require("../../cli/shell");
const { applyModeArgs } = require("../../modes");
const { buildPrompt } = require("../../prompt");
const { DEFAULT_SETTINGS } = require("../../settings");
const { codexJsonEventToUpdates } = require("./jsonEvents");

class CodexAgent {
  constructor(plugin) {
    this.plugin = plugin;
    this.id = "codex";
    this.label = "Codex";
  }

  async run(prompt, onUpdate, conversation) {
    const settings = this.plugin.settings;
    const cwd = this.getWorkingDirectory();
    const finalPrompt = await buildPrompt(this.plugin.app, settings, prompt, conversation);
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

      const child = spawn(settings.codexPath, args, {
        cwd,
        shell: false,
        env: Object.assign({}, process.env, {
          PATH: buildCliPath(process.env.PATH),
          TERM: "dumb"
        }),
        stdio: ["ignore", "pipe", "pipe"]
      });

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

      child.on("error", (error) => reject(error));
      child.on("close", async (code) => {
        if (stdoutBuffer.trim()) {
          handleJsonLine(stdoutBuffer);
        }

        const fileOutput = await readOutputFile(outputPath);
        if (!finalOutput.trim() && fileOutput) {
          finalOutput = fileOutput;
          onUpdate({ kind: "content", text: fileOutput });
        }

        if (code === 0) {
          resolve(finalOutput.trim());
          return;
        }

        const details = [errorOutput.trim(), fileOutput.trim()]
          .filter(Boolean)
          .join("\n\n");
        reject(new Error(details || `Codex exited with code ${code}`));
      });
    });
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

module.exports = {
  CodexAgent
};
