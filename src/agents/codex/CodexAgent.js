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
const { DEFAULT_SETTINGS } = require("../../settings");
const {
  extractAgentDockSignals,
  formatInvalidAgentDockSignalActivity,
  formatAgentDockSignalNotice,
  formatAgentDockReflectionNotice
} = require("../shared/agentSignals");
const {
  buildDeepMemoryAuditItems,
  buildInteractionMemoryAuditItems,
  buildMemoryUpdateAuditItems,
  formatDeepMemoryUpdateSummary,
  formatInteractionMemoryUpdateKind,
  formatInteractionMemoryUpdateSummary,
  formatInteractionMemoryUpdateTitle,
  formatMemoryUpdateSummary
} = require("../shared/captureNotices");
const {
  buildAgentTurnContext,
  emitDebugPromptActivity
} = require("../shared/TurnContextBuilder");
const { ReflectionContentFilter } = require("../shared/ReflectionContentFilter");
const { mergeSignalEvidenceContexts } = require("../shared/signalEvidence");
const { emitClaimedMemoryProvenance } = require("../shared/memoryProvenance");
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
    const turnContext = await buildAgentTurnContext({
      plugin: this.plugin,
      settings,
      prompt,
      onUpdate,
      translate,
      conversation,
      cwd,
      keyPrefix: "codex"
    });
    const finalPrompt = turnContext.promptResult.prompt;
    const activeFilePath = turnContext.activeFilePath;
    const baseSignalEvidenceContext = turnContext.signalEvidenceContext;
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
    emitDebugPromptActivity(onUpdate, turnContext.promptResult, settings, translate);

    return new Promise((resolve, reject) => {
      let finalOutput = "";
      let errorOutput = "";
      let stdoutBuffer = "";
      let settled = false;
      let aborted = false;
      let toolResultEvidence = "";
      const getSignalEvidenceContext = () => mergeSignalEvidenceContexts(
        baseSignalEvidenceContext,
        {
          assistant_message: extractAgentDockSignals(finalOutput).visibleText,
          tool_result: toolResultEvidence
        }
      );
      const reflectionNoticeSignals = [];
      const emitReflectionNotice = (signals) => {
        reflectionNoticeSignals.push(...signals);
        const notice = formatAgentDockReflectionNotice(
          reflectionNoticeSignals,
          settings,
          "codex",
          translate
        );
        if (notice) {
          notice.agentDockSignals = signals;
          notice.signalEvidenceContext = getSignalEvidenceContext();
          onUpdate(notice);
        }
      };
      const reflectionFilter = new ReflectionContentFilter({
        onAppraisal: emitReflectionNotice,
        onOutcome: emitReflectionNotice,
        onSourceComplete: () => emitReflectionNotice([])
      });

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
            if (update.kind === "tool") {
              toolResultEvidence = appendToolResultEvidence(toolResultEvidence, update);
            }
            if (update.agentMessagePhase !== undefined) {
              if (update.kind === "content") {
                finalOutput += update.text;
              }
              emitFilteredAgentMessage(update, reflectionFilter, onUpdate);
              continue;
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
        for (const visibleText of reflectionFilter.flush()) {
          onUpdate({ kind: "content", text: visibleText });
        }

        const fileOutput = await readOutputFile(outputPath);
        if (!finalOutput.trim() && fileOutput) {
          finalOutput = fileOutput;
          reflectionFilter.beginSource("content");
          for (const visibleText of reflectionFilter.push(fileOutput)) {
            onUpdate({ kind: "content", text: visibleText });
          }
          for (const visibleText of reflectionFilter.flush()) {
            onUpdate({ kind: "content", text: visibleText });
          }
          reflectionFilter.endSource();
        }

        if (aborted) {
          settle(reject, createAbortError(translate));
          return;
        }

        if (code === 0) {
          const signalResult = extractAgentDockSignals(finalOutput.trim());
          const signalEvidenceContext = getSignalEvidenceContext();
          emitClaimedMemoryProvenance(
            onUpdate,
            signalResult.signals,
            turnContext.memoryRecallManifest
          );
          emitInvalidAgentDockSignalActivity(signalResult, onUpdate);
          emitAgentDockSignalNotices(
            signalResult.signals,
            settings,
            "codex",
            translate,
            onUpdate,
            reflectionFilter,
            signalEvidenceContext
          );
          const visibleOutput = signalResult.visibleText.trim();
          await this.captureMemory({
            prompt,
            response: visibleOutput,
            agentDockSignals: signalResult.signals,
            signalEvidenceContext,
            previousAssistantResponse: getPreviousAssistantResponse(conversation),
            activeFilePath,
            sessionId: options.sessionId || "",
            userMessageId: options.userMessageId || "",
            assistantMessageId: options.assistantMessageId || "",
            memoryRecallManifest: turnContext.memoryRecallManifest
          }, settings, onUpdate);
          await this.captureInteractionMemory({
            prompt,
            response: visibleOutput,
            agentDockSignals: signalResult.signals,
            signalEvidenceContext,
            previousAssistantResponse: getPreviousAssistantResponse(conversation),
            activeFilePath,
            sessionId: options.sessionId || "",
            userMessageId: options.userMessageId || "",
            assistantMessageId: options.assistantMessageId || "",
            memoryRecallManifest: turnContext.memoryRecallManifest
          }, settings, onUpdate);
          await this.captureDeepMemory({
            prompt,
            response: visibleOutput,
            agentDockSignals: signalResult.signals,
            signalEvidenceContext,
            previousAssistantResponse: getPreviousAssistantResponse(conversation),
            activeFilePath,
            sessionId: options.sessionId || "",
            userMessageId: options.userMessageId || "",
            assistantMessageId: options.assistantMessageId || "",
            memoryRecallManifest: turnContext.memoryRecallManifest
          }, settings, onUpdate);
          settle(resolve, visibleOutput);
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
          noticeType: "memory_updated",
          insertBeforeLastContent: true,
          title: t(settings, "codex.memoryUpdated.title"),
          summary: formatMemoryUpdateSummary(settings, "codex", t, saved),
          auditItems: buildMemoryUpdateAuditItems(saved, settings, "codex", t)
        });
      }
    } catch (error) {
      console.warn("Agent Dock could not update memory:", error);
        onUpdate({
        kind: "notice",
        noticeType: "memory_skipped",
        insertBeforeLastContent: true,
          title: t(settings, "codex.memorySkipped.title"),
          summary: t(settings, "codex.memorySkipped.summary")
      });
    }
  }

  async captureInteractionMemory(turn, settings, onUpdate) {
    try {
      const result = await this.plugin.interactionMemoryStore.captureTurn(turn, settings);
      if (result.closedEpisodes.length > 0) {
        onUpdate({
          kind: formatInteractionMemoryUpdateKind(result),
          noticeType: "interaction_memory_updated",
          insertBeforeLastContent: true,
          title: formatInteractionMemoryUpdateTitle(settings, "codex", t, result),
          summary: formatInteractionMemoryUpdateSummary(settings, "codex", t, result),
          auditItems: buildInteractionMemoryAuditItems(result, settings, "codex", t)
        });
      }
    } catch (error) {
      console.warn("Agent Dock could not update interaction memory:", error);
      onUpdate({
        kind: "notice",
        noticeType: "interaction_memory_skipped",
        insertBeforeLastContent: true,
        title: t(settings, "codex.interactionMemorySkipped.title"),
        summary: t(settings, "codex.interactionMemorySkipped.summary")
      });
    }
  }

  async captureDeepMemory(turn, settings, onUpdate) {
    try {
      const saved = await this.plugin.deepMemoryStore.captureTurn(turn, settings);
      if (saved.length > 0) {
        onUpdate({
          kind: "notice",
          noticeType: "deep_memory_updated",
          insertBeforeLastContent: true,
          title: t(settings, "codex.deepMemoryUpdated.title"),
          summary: formatDeepMemoryUpdateSummary(settings, "codex", t, saved),
          auditItems: buildDeepMemoryAuditItems(saved, settings, "codex", t)
        });
      }
    } catch (error) {
      console.warn("Agent Dock could not update deep memory:", error);
      onUpdate({
        kind: "notice",
        noticeType: "deep_memory_skipped",
        insertBeforeLastContent: true,
        title: t(settings, "codex.deepMemorySkipped.title"),
        summary: t(settings, "codex.deepMemorySkipped.summary")
      });
    }
  }
}

function emitAgentDockSignalNotices(
  signals,
  settings,
  keyPrefix,
  translate,
  onUpdate,
  reflectionFilter,
  signalEvidenceContext
) {
  const reflectionNotice = formatAgentDockReflectionNotice(
    signals.filter((signal) => !reflectionFilter?.hasEmitted(signal)),
    settings,
    keyPrefix,
    translate
  );
  if (reflectionNotice) {
    reflectionNotice.signalEvidenceContext = signalEvidenceContext;
    onUpdate(reflectionNotice);
  }
  for (const signal of signals.filter((item) => item?.envelope !== "reflection_v1")) {
    const notice = formatAgentDockSignalNotice(signal, settings, keyPrefix, translate);
    if (notice) {
      onUpdate(notice);
    }
  }
}

function appendToolResultEvidence(existing, update) {
  return mergeSignalEvidenceContexts(
    { tool_result: existing },
    { tool_result: [update?.title, update?.summary, update?.detail].filter(Boolean).join("\n") }
  ).tool_result;
}

function emitFilteredAgentMessage(update, reflectionFilter, onUpdate) {
  const rawText = update.kind === "content"
    ? update.text
    : update.detail;
  reflectionFilter.beginSource(update.kind === "content" ? "content" : "commentary");
  const visibleChunks = reflectionFilter.push(rawText).concat(reflectionFilter.flush());
  for (const visibleText of visibleChunks) {
    if (!visibleText) {
      continue;
    }
    if (update.kind === "content") {
      onUpdate(Object.assign({}, update, { text: visibleText }));
    } else {
      onUpdate(Object.assign({}, update, { detail: visibleText }));
    }
  }
  reflectionFilter.endSource();
}

function emitInvalidAgentDockSignalActivity(signalResult, onUpdate) {
  const activity = formatInvalidAgentDockSignalActivity(signalResult);
  if (activity) {
    onUpdate(activity);
  }
}

function getPreviousAssistantResponse(conversation) {
  if (!Array.isArray(conversation)) {
    return "";
  }
  for (let index = conversation.length - 2; index >= 0; index -= 1) {
    const message = conversation[index];
    if (message?.role === "assistant" && message.content) {
      return message.content;
    }
  }
  return "";
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
