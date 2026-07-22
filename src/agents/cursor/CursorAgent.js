const {
  buildAgentTurnContext,
  buildPromptResultForTurnContext,
  emitDebugPromptActivity
} = require("../shared/TurnContextBuilder");
const { applyVisibleEventPolicy } = require("../shared/visibleEventPolicy");
const { expandHomePath } = require("../../cli/paths");
const { t } = require("../../i18n");
const { DEFAULT_SETTINGS } = require("../../settings");
const { AcpClient } = require("./AcpClient");
const { acpUpdateToEvents } = require("./acpEvents");
const { toCursorMode } = require("./modes");

const CONNECTION_IDLE_MS = 30 * 60 * 1000;

class CursorAgent {
  constructor(plugin) {
    this.plugin = plugin;
    this.id = "cursor";
    this.label = "Cursor";
    this.connections = new Map();
  }

  async run(prompt, onUpdate, conversation, options = {}) {
    return this.runWithRecovery(prompt, onUpdate, conversation, options, false);
  }

  async runWithRecovery(prompt, onUpdate, conversation, options, isRetry) {
    try {
      return await this.runOnce(prompt, onUpdate, conversation, options);
    } catch (error) {
      if (!isRetry && isRecoverableAcpError(error)) {
        this.removeConnection(options.dockSession?.id);
        return this.runWithRecovery(prompt, onUpdate, conversation, options, true);
      }
      throw error;
    }
  }

  async runOnce(prompt, onUpdate, conversation, options = {}) {
    const settings = this.plugin.settings;
    const translate = (key, params) => t(settings, key, params);
    const cwd = this.getWorkingDirectory();

    if (!options.dockSession) {
      console.warn("Agent Dock Cursor run missing dockSession; ACP session reuse is disabled for this turn.");
    }

    const dockSession = options.dockSession || null;
    const cursorState = ensureCursorProviderState(dockSession);
    const cursorMode = toCursorMode(settings.mode, DEFAULT_SETTINGS.mode);
    const connectionKey = buildConnectionKey(settings, cwd, cursorMode);
    const sessionKey = dockSession?.id || "__anonymous__";

    let useFullPrompt = !cursorState.acpSessionId;
    let finalOutput = "";
    let aborted = false;
    let client = null;

    const existingConnection = this.connections.get(sessionKey);
    if (existingConnection && existingConnection.connectionKey !== connectionKey) {
      cursorState.acpSessionId = "";
      useFullPrompt = true;
    }

    const emitUpdate = (rawUpdate) => {
      const update = applyVisibleEventPolicy(rawUpdate, settings.mode, translate);
      if (update.kind === "content") {
        finalOutput += update.text;
      }
      onUpdate(update);
    };

    const throwIfAborted = () => {
      if (aborted) {
        throw createAbortError(translate);
      }
    };

    const abortRun = async () => {
      aborted = true;
      if (client) {
        await client.cancelPrompt(cursorState.acpSessionId);
        await client.close();
        this.connections.delete(sessionKey);
        client = null;
      }
    };

    if (options.signal?.aborted) {
      await abortRun();
      throw createAbortError(translate);
    }

    options.signal?.addEventListener("abort", abortRun, { once: true });

    try {
      const turnContext = await buildAgentTurnContext({
        plugin: this.plugin,
        settings,
        prompt,
        conversation,
        cwd,
        onUpdate: emitUpdate,
        translate,
        keyPrefix: "cursor",
        useFullPrompt
      });
      const promptResult = turnContext.promptResult;
      throwIfAborted();

      const promptText = promptResult.prompt;

      emitUpdate({
        kind: "notice",
        title: translate("cursor.connecting.title"),
        summary: translate("cursor.connecting.summary")
      });
      client = await this.getOrCreateClient(sessionKey, connectionKey, {
        settings,
        cwd,
        translate,
        onUpdate: emitUpdate
      });
      throwIfAborted();

      if (!cursorState.acpSessionId) {
        emitCursorAuthenticationNoticeIfNeeded(client, emitUpdate, translate);
        emitUpdate({
          kind: "notice",
          title: translate("cursor.sessionStarting.title"),
          summary: translate("cursor.sessionStarting.summary")
        });
        cursorState.acpSessionId = await client.createSession(cursorMode);
      } else if (client.activeAcpSessionId !== cursorState.acpSessionId) {
        try {
          emitCursorAuthenticationNoticeIfNeeded(client, emitUpdate, translate);
          emitUpdate({
            kind: "notice",
            title: translate("cursor.sessionLoading.title"),
            summary: translate("cursor.sessionLoading.summary")
          });
          await this.withSuppressedSessionUpdates(client, () => (
            client.loadSession(cursorState.acpSessionId, cursorMode)
          ));
        } catch (error) {
          if (!isStaleSessionError(error)) {
            throw error;
          }

          emitUpdate({
            kind: "notice",
            title: translate("cursor.sessionReloadFailed.title"),
            summary: translate("cursor.sessionReloadFailed.summary")
          });
          cursorState.acpSessionId = "";
          const reloadPromptResult = await buildPromptResultForTurnContext({
            app: this.plugin.app,
            settings,
            prompt,
            conversation,
            useFullPrompt: true
          });
          emitCursorAuthenticationNoticeIfNeeded(client, emitUpdate, translate);
          emitUpdate({
            kind: "notice",
            title: translate("cursor.sessionStarting.title"),
            summary: translate("cursor.sessionStarting.summary")
          });
          cursorState.acpSessionId = await client.createSession(cursorMode);
          throwIfAborted();
          emitDebugPromptActivity(emitUpdate, reloadPromptResult, settings, translate);
          emitUpdate({
            kind: "notice",
            title: translate("cursor.promptSent.title"),
            summary: translate("cursor.promptSent.summary")
          });
          const result = await client.prompt(cursorState.acpSessionId, reloadPromptResult.prompt);
          return await this.finishTurn({
            result,
            finalOutput,
            emitUpdate,
            throwIfAborted
          });
        }
      }

      throwIfAborted();
      emitDebugPromptActivity(emitUpdate, promptResult, settings, translate);
      emitUpdate({
        kind: "notice",
        title: translate("cursor.promptSent.title"),
        summary: translate("cursor.promptSent.summary")
      });
      const result = await client.prompt(cursorState.acpSessionId, promptText);
      return await this.finishTurn({
        result,
        finalOutput,
        emitUpdate,
        throwIfAborted
      });
    } catch (error) {
      if (aborted || error.name === "AbortError") {
        throw createAbortError(translate);
      }

      if (isAuthError(error)) {
        emitUpdate({
          kind: "error",
          title: translate("cursor.authFailed"),
          detail: error.message
        });
        throw new Error(translate("cursor.authFailed"));
      }

      if (isSpawnError(error)) {
        emitUpdate({
          kind: "error",
          title: translate("cursor.spawnFailed.title"),
          summary: translate("cursor.spawnFailed.summary"),
          detail: error.message
        });
      }

      if (isAcpTimeoutError(error)) {
        const authTimeout = isAcpMethodTimeout(error, "authenticate");
        emitUpdate({
          kind: "error",
          title: translate(authTimeout ? "cursor.authTimedOut.title" : "cursor.acpTimedOut.title"),
          summary: translate(authTimeout ? "cursor.authTimedOut.summary" : "cursor.acpTimedOut.summary"),
          detail: error.message
        });
        this.removeConnection(options.dockSession?.id);
      }

      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abortRun);
    }
  }

  async finishTurn({
    result,
    finalOutput,
    emitUpdate,
    throwIfAborted
  }) {
    const resultText = extractPromptResultText(result);
    if (!finalOutput.trim() && resultText) {
      finalOutput = resultText;
      emitUpdate({ kind: "content", text: resultText });
    }

    throwIfAborted();
    return finalOutput.trim();
  }

  async getOrCreateClient(sessionKey, connectionKey, context) {
    this.closeIdleConnections();

    const existing = this.connections.get(sessionKey);
    if (existing && existing.connectionKey === connectionKey && existing.client.isAlive()) {
      existing.lastUsedAt = Date.now();
      this.bindClientHandlers(existing.client, context);
      return existing.client;
    }

    if (existing) {
      await existing.client.close();
      this.connections.delete(sessionKey);
    }

    const client = new AcpClient({
      executablePath: expandHomePath(context.settings.cursorPath || DEFAULT_SETTINGS.cursorPath),
      extraArgs: splitExtraArgs(context.settings.cursorExtraArgs),
      cwd: context.cwd,
      permissionPolicy: resolvePermissionPolicy(
        context.settings.mode,
        context.settings.cursorPermissionPolicy
      ),
      onProcessClose: () => {
        this.connections.delete(sessionKey);
      }
    });
    this.bindClientHandlers(client, context);

    this.connections.set(sessionKey, {
      client,
      connectionKey,
      lastUsedAt: Date.now()
    });
    return client;
  }

  bindClientHandlers(client, context) {
    client.onSessionUpdate = (update) => {
      if (client.suppressSessionUpdates) {
        return;
      }
      for (const event of acpUpdateToEvents(update, context.translate)) {
        context.onUpdate(event);
      }
    };
    client.onExtensionNotice = (method, params) => {
      context.onUpdate(formatExtensionNotice(method, params, context.translate));
    };
    client.onLog = (event, details) => {
      context.onUpdate({
        kind: "activity",
        title: "Cursor ACP",
        summary: event,
        detail: formatAcpLogDetail(details)
      });
    };
    client.onStderr = (text) => {
      context.onUpdate({ kind: "activity", title: "Cursor", detail: text.trim() });
    };
    client.onProcessClose = () => {
      const sessionKey = [...this.connections.entries()]
        .find(([, entry]) => entry.client === client)?.[0];
      if (sessionKey) {
        this.connections.delete(sessionKey);
      }
    };
  }

  async withSuppressedSessionUpdates(client, callback) {
    const previous = client.suppressSessionUpdates === true;
    client.suppressSessionUpdates = true;
    try {
      return await callback();
    } finally {
      client.suppressSessionUpdates = previous;
    }
  }

  closeIdleConnections() {
    const now = Date.now();
    for (const [sessionKey, entry] of this.connections.entries()) {
      if (now - entry.lastUsedAt <= CONNECTION_IDLE_MS) {
        continue;
      }
      entry.client.close();
      this.connections.delete(sessionKey);
    }
  }

  removeConnection(dockSessionId) {
    const sessionKey = dockSessionId || "__anonymous__";
    const entry = this.connections.get(sessionKey);
    if (!entry) {
      return;
    }
    entry.client.close();
    this.connections.delete(sessionKey);
  }

  async releaseDockSession(dockSessionId) {
    const entry = this.connections.get(dockSessionId);
    if (!entry) {
      return;
    }
    await entry.client.close();
    this.connections.delete(dockSessionId);
  }

  cancelAll() {
    for (const entry of this.connections.values()) {
      entry.client.close();
    }
    this.connections.clear();
  }

  getWorkingDirectory() {
    return this.plugin.settings.workingDirectory || this.plugin.app.vault.adapter.basePath;
  }

}

function emitCursorAuthenticationNoticeIfNeeded(client, emitUpdate, translate) {
  if (client.initialized) {
    return;
  }

  emitUpdate({
    kind: "notice",
    title: translate("cursor.authenticating.title"),
    summary: translate("cursor.authenticating.summary")
  });
}

function ensureCursorProviderState(dockSession) {
  if (!dockSession) {
    return { acpSessionId: "" };
  }
  if (!dockSession.providerState || typeof dockSession.providerState !== "object") {
    dockSession.providerState = {};
  }
  if (!dockSession.providerState.cursor || typeof dockSession.providerState.cursor !== "object") {
    dockSession.providerState.cursor = { acpSessionId: "" };
  }
  if (typeof dockSession.providerState.cursor.acpSessionId !== "string") {
    dockSession.providerState.cursor.acpSessionId = "";
  }
  return dockSession.providerState.cursor;
}

function buildConnectionKey(settings, cwd, cursorMode) {
  return [
    expandHomePath(settings.cursorPath || DEFAULT_SETTINGS.cursorPath),
    settings.cursorExtraArgs || "",
    settings.cursorPermissionPolicy || DEFAULT_SETTINGS.cursorPermissionPolicy,
    cwd,
    cursorMode
  ].join("|");
}

function splitExtraArgs(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  return text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
}

function normalizePermissionPolicy(value) {
  if (value === "allow-always" || value === "reject-once") {
    return value;
  }
  return "allow-once";
}

function resolvePermissionPolicy(mode, configuredPolicy) {
  if (mode === "readOnly") {
    return "reject-once";
  }
  return normalizePermissionPolicy(configuredPolicy);
}

function extractPromptResultText(result) {
  if (!result) {
    return "";
  }
  if (typeof result.content === "string") {
    return result.content;
  }
  if (Array.isArray(result.content)) {
    return result.content
      .map((entry) => (typeof entry === "string" ? entry : entry?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof result.text === "string") {
    return result.text;
  }
  return "";
}

function formatExtensionNotice(method, params, translate) {
  if (method === "cursor/create_plan") {
    return {
      kind: "notice",
      title: translate("cursor.planAccepted.title"),
      summary: params?.name || params?.overview || translate("cursor.planAccepted.summary")
    };
  }
  if (method === "cursor/ask_question") {
    return {
      kind: "notice",
      title: translate("cursor.questionSkipped.title"),
      summary: params?.title || translate("cursor.questionSkipped.summary")
    };
  }
  if (method === "cursor/update_todos") {
    const count = Array.isArray(params?.todos) ? params.todos.length : 0;
    return {
      kind: "notice",
      title: translate("cursor.todosUpdated.title"),
      summary: translate("cursor.todosUpdated.summary", { count })
    };
  }
  if (method === "cursor/task") {
    return {
      kind: "activity",
      title: translate("cursor.subagentTask"),
      detail: params?.description || params?.prompt || ""
    };
  }
  if (method === "cursor/generate_image") {
    return {
      kind: "notice",
      title: translate("cursor.imageGenerated.title"),
      summary: params?.description || params?.filePath || ""
    };
  }
  return {
    kind: "activity",
    title: method,
    detail: JSON.stringify(params || {}, null, 2)
  };
}

function createAbortError(translate) {
  const error = new Error(translate("cursor.abortError"));
  error.name = "AbortError";
  return error;
}

function isAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = Number(error?.code);
  return code === 401
    || code === 403
    || message.includes("auth")
    || message.includes("login")
    || message.includes("unauthorized");
}

function isSpawnError(error) {
  return error?.code === "ENOENT" || String(error?.message || "").includes("spawn");
}

function isRecoverableAcpError(error) {
  const message = String(error?.message || "");
  return message.includes("ACP process closed")
    || message.includes("ACP process is not running")
    || message.includes("ACP client closed");
}

function isStaleSessionError(error) {
  if (isAcpTimeoutError(error) || isAuthError(error) || isRecoverableAcpError(error)) {
    return false;
  }

  const message = String(error?.message || "").toLowerCase();
  const code = Number(error?.code);
  return code === 404
    || code === 410
    || message.includes("session")
    || message.includes("not found")
    || message.includes("expired")
    || message.includes("invalid");
}

function isAcpTimeoutError(error) {
  return String(error?.message || "").includes("ACP request timed out");
}

function isAcpMethodTimeout(error, method) {
  return String(error?.message || "").includes(`ACP request timed out: ${method}`);
}

function formatAcpLogDetail(details) {
  if (!details || typeof details !== "object") {
    return "";
  }

  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

module.exports = {
  CursorAgent,
  _test: {
    isStaleSessionError,
    resolvePermissionPolicy,
    withSuppressedSessionUpdates: (client, callback) => (
      CursorAgent.prototype.withSuppressedSessionUpdates.call(null, client, callback)
    )
  }
};
