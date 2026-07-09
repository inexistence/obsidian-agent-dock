const { getTurnVisualAffect } = require("../../affect/WorkingAffectStore");

const TURN_STATUS_PREVIEW_KINDS = ["thinking", "success", "celebrate", "error", "stopped"];
const PROMPT_TONE_PREVIEW_KINDS = [
  "alert",
  "serious",
  "reassuring",
  "challenging",
  "laughing",
  "starry-eyed",
  "excited-open",
  "surprised",
  "admiring",
  "celebratory",
  "playful",
  "confident",
  "absorbed",
  "close",
  "patient",
  "restrained",
  "composed",
  "tense-focused",
  "warm-focused",
  "focused",
  "warm-open",
  "calm",
  "steady"
];
const PROMPT_TONE_STATUS_META = {
  alert: { mode: "alert-loop", color: "#b45309" },
  serious: { mode: "serious", color: "#6f5a4f" },
  reassuring: { mode: "settle", color: "#4d7c5a" },
  challenging: { mode: "alert", color: "#7c5aa6" },
  laughing: { mode: "excited", color: "#d27a2f" },
  "starry-eyed": { mode: "starry", color: "#c18b1f" },
  "excited-open": { mode: "excited", color: "#ea7a1a" },
  surprised: { mode: "glint", color: "#7a9f32" },
  admiring: { mode: "warm", color: "#8b6f3f" },
  celebratory: { mode: "celebrate", color: "#d45f4f" },
  playful: { mode: "glint", color: "#8a9635" },
  confident: { mode: "lock", color: "#4f63b6" },
  absorbed: { mode: "absorbed", color: "#2f766f" },
  close: { mode: "warm", color: "#b76e79" },
  patient: { mode: "warm-focus", color: "#5f8a72" },
  restrained: { mode: "quiet", color: "#7b8190" },
  composed: { mode: "settle", color: "#3f7f88" },
  "tense-focused": { mode: "focus-loop", color: "#6b7280" },
  "warm-focused": { mode: "warm-focus", color: "#3f8f7a" },
  focused: { mode: "focus-loop", color: "#2f78b7" },
  "warm-open": { mode: "glint", color: "#7a9f32" },
  calm: { mode: "quiet", color: "#6d8fa3" },
  steady: { mode: "steady", color: "#65758b" }
};
const TURN_VISUAL_MIN_CHANGE_MS = 3600;
const TURN_VISUAL_FAST_CHANGE_MS = 1800;
const TURN_VISUAL_FAST_LABELS = new Set(["alert", "serious", "celebratory"]);
const TURN_VISUAL_LABEL_PRIORITY = {
  alert: 100,
  serious: 92,
  "tense-focused": 86,
  celebratory: 78,
  confident: 72,
  "starry-eyed": 68,
  challenging: 64,
  laughing: 62,
  absorbed: 60,
  focused: 58,
  "warm-focused": 56,
  composed: 54,
  reassuring: 50,
  surprised: 46,
  admiring: 44,
  playful: 42,
  "warm-open": 38,
  patient: 36,
  close: 34,
  calm: 28,
  restrained: 24,
  steady: 0
};

class TurnStatusController {
  constructor(options) {
    this.translate = options.translate;
    this.getAffectToneLabel = options.getAffectToneLabel;
    this.prefersReducedMotion = options.prefersReducedMotion;
    this.emotiveFeedback = options.emotiveFeedback;
  }

  getStatusPreviewKinds() {
    return TURN_STATUS_PREVIEW_KINDS;
  }

  getPromptTonePreviewKinds() {
    return PROMPT_TONE_PREVIEW_KINDS;
  }

  renderStatus(item, message, providedStatus = null) {
    const status = providedStatus || this.getStatus(message);
    if (!status) {
      return;
    }
    const isFirstThinkingRender = status.kind === "thinking" && !message.emotiveFeedbackPlayed?.thinking;
    const statusClasses = [
      "codex-dock__turn-status",
      `codex-dock__turn-status--${status.kind}`
    ];
    const toneMeta = status.kind === "thinking" && status.toneKind
      ? this.getPromptToneStatusMeta(status.toneKind)
      : null;
    if (toneMeta) {
      statusClasses.push("codex-dock__turn-status--tone");
      statusClasses.push(`codex-dock__turn-status--tone-${toneMeta.mode}`);
    }
    if (status.play || (isFirstThinkingRender && !toneMeta)) {
      statusClasses.push("is-fresh");
    }
    const isSwitchingIn = message.turnVisualStatusChanged === true;
    if (isSwitchingIn) {
      statusClasses.push("is-switching-in");
      message.turnVisualStatusChanged = false;
    }
    if (status.play && status.kind === "error") {
      statusClasses.push("is-alerting");
    } else if (status.play && status.kind === "stopped") {
      statusClasses.push("is-settling");
    }

    const statusSlot = item.createDiv({ cls: "codex-dock__turn-status-slot" });
    const statusEl = statusSlot.createSpan({
      cls: statusClasses.join(" "),
      attr: {
        "data-feedback-kind": status.kind,
        "data-status-key": this.getStatusRenderKey(status)
      }
    });
    statusEl.createSpan({
      cls: "codex-dock__turn-status-label",
      text: status.label
    });
    if (toneMeta) {
      statusEl.style.setProperty("--codex-dock-turn-status-color", toneMeta.color);
      if (toneMeta.mode === "starry") {
        this.renderStarryEffects(statusEl);
      }
    }
    if (isSwitchingIn) {
      window.setTimeout(() => {
        statusEl.removeClass("is-switching-in");
      }, 280);
    }

    if (status.kind === "thinking") {
      if (!message.emotiveFeedbackPlayed) {
        message.emotiveFeedbackPlayed = {};
      }
      if (isFirstThinkingRender) {
        message.emotiveFeedbackPlayed.thinking = true;
      }
      window.requestAnimationFrame(() => {
        if (item.isConnected && statusEl.isConnected) {
          this.emotiveFeedback.play(item, statusEl, "thinking");
        }
      });
      return;
    }

    if (status.play) {
      window.requestAnimationFrame(() => {
        if (item.isConnected && statusEl.isConnected) {
          this.emotiveFeedback.play(item, statusEl, status.kind);
        }
      });
      if (message.emotiveFeedback) {
        message.emotiveFeedback.played = true;
      }
    }
    if (status.transient) {
      this.emotiveFeedback.settleTransientStatus(statusEl, status.kind);
    }
  }

  renderStarryEffects(statusEl) {
    const positions = [
      { x: "-13px", y: "-9px", size: "5px" },
      { x: "11px", y: "-12px", size: "7px" },
      { x: "calc(100% - 2px)", y: "-5px", size: "5px" },
      { x: "calc(100% + 8px)", y: "12px", size: "6px" },
      { x: "23px", y: "calc(100% + 2px)", size: "4px" }
    ];
    positions.forEach((position, index) => {
      const spark = statusEl.createSpan({
        cls: `codex-dock__turn-status-spark codex-dock__turn-status-spark--${index + 1}`,
        attr: {
          "aria-hidden": "true"
        }
      });
      spark.style.setProperty("--spark-x", position.x);
      spark.style.setProperty("--spark-y", position.y);
      spark.style.setProperty("--spark-size", position.size);
    });
    statusEl.createSpan({
      cls: "codex-dock__turn-status-scan",
      attr: {
        "aria-hidden": "true"
      }
    });
  }

  getStatus(message) {
    if (!message || message.role !== "assistant") {
      return null;
    }
    if (message.turnVisualAwaitingFinalFeedback && message.turnVisualFinalHoldStatus) {
      return message.turnVisualFinalHoldStatus;
    }
    if (message.isLoading || message.turnVisualAwaitingFinalFeedback) {
      return {
        kind: "thinking",
        label: message.loadingToneLabel || this.translate("turnStatus.thinking"),
        toneKind: message.loadingToneKind || "",
        play: false
      };
    }
    const feedback = message.emotiveFeedback;
    if (!feedback || !feedback.kind) {
      return null;
    }
    if (feedback.played) {
      return null;
    }
    return {
      kind: feedback.kind,
      label: feedback.label || this.getLabel(feedback.kind),
      play: feedback.play !== false,
      transient: feedback.transient !== false
    };
  }

  getLabel(kind) {
    if (kind === "success") {
      return this.translate("turnStatus.success");
    }
    if (kind === "celebrate") {
      return this.translate("turnStatus.celebrate");
    }
    if (kind === "error") {
      return this.translate("turnStatus.error");
    }
    if (kind === "stopped") {
      return this.translate("turnStatus.stopped");
    }
    return this.translate("turnStatus.thinking");
  }

  getPromptToneStatusMeta(toneKind) {
    return PROMPT_TONE_STATUS_META[toneKind] || PROMPT_TONE_STATUS_META.steady;
  }

  updateAffect(message, update) {
    if (!message?.isLoading) {
      return;
    }
    const nextAffect = getTurnVisualAffect(message.turnVisualAffect, update);
    const label = nextAffect?.label || "";
    if (!label) {
      return;
    }
    const hadVisibleTone = Boolean(message.loadingToneKind);
    message.turnVisualAffect = nextAffect;
    if (!this.shouldApplyLabel(message, label)) {
      return;
    }
    if (!hadVisibleTone) {
      message.turnVisualSuppressNextTransition = true;
    }
    message.loadingToneKind = label;
    message.loadingToneLabel = this.getAffectToneLabel(label);
  }

  shouldApplyLabel(message, label) {
    const currentLabel = message.loadingToneKind || "";
    if (!currentLabel) {
      message.turnVisualLastChangedAt = Date.now();
      message.turnVisualPendingLabel = "";
      message.turnVisualPendingCount = 0;
      return true;
    }
    if (currentLabel === label) {
      if (!message.turnVisualLastChangedAt) {
        message.turnVisualLastChangedAt = Date.now();
      }
      message.turnVisualPendingLabel = "";
      message.turnVisualPendingCount = 0;
      return true;
    }

    const now = Date.now();
    const lastChangedAt = Number(message.turnVisualLastChangedAt || 0);
    const elapsed = lastChangedAt ? now - lastChangedAt : Number.POSITIVE_INFINITY;
    const currentPriority = this.getLabelPriority(currentLabel);
    const candidatePriority = this.getLabelPriority(label);
    const isHigherPriority = candidatePriority > currentPriority;
    const isLowerPriority = candidatePriority < currentPriority;
    const fastLabel = TURN_VISUAL_FAST_LABELS.has(label);
    const minDelay = (fastLabel || isHigherPriority) ? TURN_VISUAL_FAST_CHANGE_MS : TURN_VISUAL_MIN_CHANGE_MS;
    const pendingCount = message.turnVisualPendingLabel === label
      ? Number(message.turnVisualPendingCount || 0) + 1
      : 1;

    message.turnVisualPendingLabel = label;
    message.turnVisualPendingCount = pendingCount;

    if (isLowerPriority && elapsed < TURN_VISUAL_MIN_CHANGE_MS) {
      return false;
    }

    if (elapsed < minDelay && pendingCount < 2) {
      return false;
    }

    message.turnVisualLastChangedAt = now;
    message.turnVisualPendingLabel = "";
    message.turnVisualPendingCount = 0;
    message.turnVisualStatusChanged = Boolean(currentLabel && currentLabel !== label);
    return true;
  }

  getLabelPriority(label) {
    return TURN_VISUAL_LABEL_PRIORITY[label] ?? TURN_VISUAL_LABEL_PRIORITY.steady;
  }

  getStatusRenderKey(status) {
    if (!status) {
      return "";
    }
    return [
      status.kind || "",
      status.toneKind || "",
      status.label || ""
    ].join(":");
  }

  captureOutgoingStatus(item, message) {
    if (this.prefersReducedMotion()) {
      return null;
    }
    if (message?.turnVisualSuppressNextTransition) {
      message.turnVisualSuppressNextTransition = false;
      return null;
    }
    const oldStatusEl = item?.querySelector?.(".codex-dock__turn-status:not(.is-exiting)");
    if (!oldStatusEl) {
      return null;
    }
    if (oldStatusEl.getAttr("data-feedback-kind") !== "thinking") {
      return null;
    }
    const nextStatus = this.getStatus(message);
    const oldKey = oldStatusEl.getAttr("data-status-key") || oldStatusEl.textContent || "";
    const nextKey = this.getStatusRenderKey(nextStatus);
    if (!nextKey || oldKey === nextKey) {
      return null;
    }
    return oldStatusEl.cloneNode(true);
  }

  attachOutgoingStatus(item, outgoingStatus) {
    if (!outgoingStatus) {
      return;
    }
    const statusSlot = item?.querySelector?.(".codex-dock__turn-status-slot");
    if (!statusSlot) {
      return;
    }
    outgoingStatus.addClass("is-exiting");
    outgoingStatus.removeClass("is-fresh");
    outgoingStatus.removeClass("is-switching-in");
    statusSlot.appendChild(outgoingStatus);
    window.setTimeout(() => {
      if (outgoingStatus.isConnected) {
        outgoingStatus.remove();
      }
    }, 280);
  }

  getRemainingDisplayMs(message) {
    const label = message?.loadingToneKind || "";
    const changedAt = Number(message?.turnVisualLastChangedAt || 0);
    if (!label || label === "steady" || !changedAt) {
      return 0;
    }

    const minimumMs = TURN_VISUAL_FAST_LABELS.has(label)
      ? TURN_VISUAL_FAST_CHANGE_MS
      : TURN_VISUAL_MIN_CHANGE_MS;
    return Math.max(0, minimumMs - (Date.now() - changedAt));
  }
}

module.exports = {
  TurnStatusController
};
