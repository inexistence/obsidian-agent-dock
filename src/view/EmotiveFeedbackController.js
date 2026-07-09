const anime = require("../vendor/anime.umd.min");

const FEEDBACK_HIDE_DELAY_MS = {
  success: 1200,
  celebrate: 1400,
  error: 1500,
  stopped: 1200,
  thinking: 0
};
class EmotiveFeedbackController {
  constructor(options = {}) {
    this.prefersReducedMotion = options.prefersReducedMotion || (() => false);
    this.getAnime = options.getAnime || (() => anime);
    this.getLayerRoot = options.getLayerRoot || null;
    this.onTransientStatusRemoved = options.onTransientStatusRemoved || null;
    this.messageIds = new WeakMap();
    this.starryFeedback = new WeakMap();
    this.nextMessageId = 1;
  }

  play(messageEl, statusEl, kind) {
    if (!messageEl || !statusEl || !kind) {
      return;
    }

    if (kind !== "thinking") {
      this.clearParticles(messageEl, { scope: "dock" });
    }
    const anime = this.getAnime();
    if (this.prefersReducedMotion() || typeof anime?.animate !== "function") {
      return;
    }

    if (kind === "success") {
      this.playSuccess(messageEl, statusEl);
    } else if (kind === "celebrate") {
      this.playCelebrate(messageEl, statusEl);
    } else if (kind === "thinking") {
      this.playThinking(messageEl, statusEl);
    }

  }

  settleTransientStatus(statusEl, kind) {
    this.hideTransientStatus(statusEl, kind);
  }

  hideTransientStatus(statusEl, kind) {
    const delay = FEEDBACK_HIDE_DELAY_MS[kind] || 0;
    if (!delay || statusEl.dataset.feedbackHiding === "true") {
      return;
    }
    statusEl.dataset.feedbackHiding = "true";
    const messageEl = statusEl.closest(".codex-dock__message");

    window.setTimeout(() => {
      if (!statusEl.isConnected) {
        this.notifyTransientStatusRemoved(messageEl);
        return;
      }
      statusEl.classList.remove("is-fresh");
      const anime = this.getAnime();
      if (this.prefersReducedMotion() || typeof anime?.animate !== "function") {
        if (!this.revealFooterMeta(statusEl, { animated: false })) {
          this.removeStatusSlot(statusEl);
        }
        return;
      }
      if (this.revealFooterMeta(statusEl, { animated: true })) {
        return;
      }
      anime.animate(statusEl, {
        opacity: 0,
        translateY: -4,
        scale: 0.96,
        duration: 240,
        ease: "in(2)",
        onComplete: () => this.collapseStatusSlot(statusEl)
      });
    }, delay);
  }

  revealFooterMeta(statusEl, options = {}) {
    const footerEl = statusEl.closest(".codex-dock__message-footer--handoff");
    const metaEl = footerEl?.querySelector(".codex-dock__message-footer-meta--pending");
    const slotEl = statusEl.closest(".codex-dock__turn-status-slot");
    if (!footerEl || !metaEl || !slotEl) {
      return false;
    }
    const messageEl = footerEl.closest(".codex-dock__message");

    const complete = () => {
      this.cleanupStatusEffects(statusEl);
      slotEl.remove();
      metaEl.classList.remove("codex-dock__message-footer-meta--pending");
      footerEl.classList.add("codex-dock__message-footer--settled");
      footerEl.classList.remove("codex-dock__message-footer--status");
      footerEl.classList.remove("codex-dock__message-footer--handoff");
      this.notifyTransientStatusRemoved(messageEl);
    };

    if (!options.animated) {
      complete();
      return true;
    }

    const anime = this.getAnime();
    if (typeof anime?.animate !== "function") {
      complete();
      return true;
    }

    anime.animate(statusEl, {
      opacity: 0,
      translateY: -4,
      scale: 0.96,
      duration: 220,
      ease: "in(2)"
    });
    anime.animate(metaEl, {
      opacity: [0, 1],
      translateY: [3, 0],
      duration: 260,
      delay: 70,
      ease: "out(3)",
      onComplete: complete
    });
    return true;
  }

  collapseStatusSlot(statusEl) {
    const slotEl = statusEl.closest(".codex-dock__turn-status-slot");
    if (!slotEl || !slotEl.isConnected) {
      this.cleanupStatusEffects(statusEl);
      statusEl.remove();
      this.notifyTransientStatusRemoved(statusEl);
      return;
    }

    const messageEl = slotEl.closest(".codex-dock__message");
    const rect = slotEl.getBoundingClientRect();
    slotEl.style.height = `${rect.height}px`;
    slotEl.style.minHeight = `${rect.height}px`;
    this.cleanupStatusEffects(statusEl);
    statusEl.remove();

    const anime = this.getAnime();
    if (typeof anime?.animate !== "function") {
      slotEl.remove();
      this.notifyTransientStatusRemoved(messageEl);
      return;
    }

    anime.animate(slotEl, {
      height: 0,
      minHeight: 0,
      marginTop: 0,
      marginBottom: 0,
      opacity: 0,
      duration: 220,
      ease: "inOut(2)",
      onComplete: () => {
        slotEl.remove();
        this.notifyTransientStatusRemoved(messageEl);
      }
    });
  }

  removeStatusSlot(statusEl) {
    const messageEl = statusEl.closest(".codex-dock__message");
    const slotEl = statusEl.closest(".codex-dock__turn-status-slot");
    this.cleanupStatusEffects(statusEl);
    if (slotEl) {
      slotEl.remove();
    } else {
      statusEl.remove();
    }
    this.notifyTransientStatusRemoved(messageEl);
  }

  notifyTransientStatusRemoved(messageEl) {
    if (typeof this.onTransientStatusRemoved === "function") {
      this.onTransientStatusRemoved(messageEl);
    }
  }

  playSuccess(messageEl, statusEl) {
    this.pulseStatus(statusEl);
  }

  playCelebrate(messageEl, statusEl) {
    const anime = this.getAnime();
    if (typeof anime?.animate !== "function") {
      return;
    }
    this.playStatusClass(statusEl, "is-glinting", 820);
    this.pulseStatus(statusEl, { scale: 1.045, duration: 500 });
    const { x, y } = this.getStatusPoint(messageEl, statusEl);
    const colors = ["var(--color-yellow)", "var(--color-green)", "var(--color-red)", "var(--color-blue)", "var(--text-normal)"];
    const particles = Array.from({ length: 22 }, (_, index) => {
      const spread = index / 21;
      return this.createParticle(messageEl, {
        x: x - 44 + spread * 82,
        y: y + 8,
        color: colors[index % colors.length],
        size: index % 2 ? 6 : 8,
        type: index % 3 === 0 ? "shard" : "",
        rotation: index * 23
      });
    });

    anime.animate(particles, {
      opacity: [0, 1, 1, 0],
      scale: [0.42, 1, 1, 0.78],
      translateX: (_, index) => Math.cos(index * 1.7) * (18 + (index % 5) * 9),
      translateY: (_, index) => [-8, -70 - (index % 6) * 9, 28 + (index % 4) * 9],
      rotate: (_, index) => `${index % 2 ? 120 : -95}deg`,
      delay: anime.stagger ? anime.stagger(16, { from: "center" }) : 0,
      duration: 1120,
      ease: "out(3)",
      onComplete: () => this.clearParticles(messageEl)
    });
  }

  playThinking(messageEl, statusEl) {
    if (!statusEl?.classList?.contains("codex-dock__turn-status--tone-starry")) {
      return;
    }
    this.playStarryStatus(statusEl);
  }

  playStarryStatus(statusEl) {
    const anime = this.getAnime();
    if (!statusEl || typeof anime?.animate !== "function" || statusEl.dataset.starryFeedbackPlaying === "true") {
      return;
    }
    const sparks = Array.from(statusEl.querySelectorAll(".codex-dock__turn-status-spark"));
    if (sparks.length === 0) {
      return;
    }
    statusEl.dataset.starryFeedbackPlaying = "true";
    const record = {
      animations: [],
      timers: []
    };
    this.starryFeedback.set(statusEl, record);
    const sparkMotion = [
      { phase: 0, duration: 1180, x: -3, y: -7, scale: 1.28, rotate: 18 },
      { phase: 260, duration: 1460, x: 2, y: -8, scale: 1.42, rotate: -16 },
      { phase: 520, duration: 1040, x: 4, y: -4, scale: 1.18, rotate: 20 },
      { phase: 140, duration: 1340, x: 3, y: 6, scale: 1.3, rotate: -18 },
      { phase: 680, duration: 1540, x: -2, y: 5, scale: 1.2, rotate: 14 }
    ];

    sparks.forEach((spark, index) => {
      const motion = sparkMotion[index % sparkMotion.length];
      const timer = window.setTimeout(() => {
        const timerIndex = record.timers.indexOf(timer);
        if (timerIndex >= 0) {
          record.timers.splice(timerIndex, 1);
        }
        if (!spark.isConnected) {
          return;
        }
        const animation = anime.animate(spark, {
          opacity: [0, index % 2 ? 0.96 : 0.82, 0.22, index % 3 === 0 ? 0.72 : 0.38, 0],
          scale: [0.28, motion.scale, 0.72, index % 3 === 0 ? 1.04 : 0.84, 0.34],
          translateX: [0, motion.x * 0.36, motion.x, motion.x * 0.42, 0],
          translateY: [0, motion.y * 0.44, motion.y, motion.y * 0.48, 0],
          rotate: ["0deg", `${motion.rotate}deg`, `${motion.rotate * 0.35}deg`, `${motion.rotate * -0.24}deg`, "0deg"],
          duration: motion.duration,
          loop: true,
          ease: "inOut(2)"
        });
        record.animations.push(animation);
      }, motion.phase);
      record.timers.push(timer);
    });
  }

  cleanupStatusEffects(rootEl) {
    if (!rootEl) {
      return;
    }
    const statusEls = rootEl.classList?.contains("codex-dock__turn-status")
      ? [rootEl]
      : Array.from(rootEl.querySelectorAll?.(".codex-dock__turn-status") || []);
    statusEls.forEach((statusEl) => this.cleanupStarryStatus(statusEl));
  }

  cleanupStarryStatus(statusEl) {
    const record = this.starryFeedback.get(statusEl);
    if (!record) {
      return;
    }
    record.timers.forEach((timer) => window.clearTimeout(timer));
    record.timers.length = 0;
    record.animations.forEach((animation) => {
      if (typeof animation?.cancel === "function") {
        animation.cancel();
      } else if (typeof animation?.pause === "function") {
        animation.pause();
      }
    });
    record.animations.length = 0;
    const anime = this.getAnime();
    if (typeof anime?.remove === "function") {
      anime.remove(Array.from(statusEl.querySelectorAll(".codex-dock__turn-status-spark")));
    }
    this.starryFeedback.delete(statusEl);
    delete statusEl.dataset.starryFeedbackPlaying;
  }

  pulseStatus(statusEl, options = {}) {
    const anime = this.getAnime();
    if (!statusEl || typeof anime?.animate !== "function") {
      return;
    }
    anime.animate(statusEl, {
      scale: [1, options.scale || 1.035, 1],
      duration: options.duration || 420,
      ease: "out(3)"
    });
  }

  playStatusClass(statusEl, className, duration) {
    if (!statusEl || !className) {
      return;
    }
    statusEl.classList.remove(className);
    // Force the CSS animation to restart when debug preview buttons are clicked repeatedly.
    statusEl.offsetWidth;
    statusEl.classList.add(className);
    window.setTimeout(() => {
      if (statusEl.isConnected) {
        statusEl.classList.remove(className);
      }
    }, duration);
  }

  createParticle(messageEl, options) {
    const layer = this.getLayer(messageEl, options);
    const particle = document.createElement("span");
    particle.className = ["codex-dock__feedback-particle", options.type || ""].filter(Boolean).join(" ");
    particle.dataset.feedbackMessageId = this.getMessageId(messageEl);
    particle.style.left = `${options.x}px`;
    particle.style.top = `${options.y}px`;
    particle.style.setProperty("--feedback-color", options.color || "var(--interactive-accent)");
    particle.style.setProperty("--feedback-size", `${options.size || 7}px`);
    particle.style.rotate = `${options.rotation || 0}deg`;
    layer.appendChild(particle);
    return particle;
  }

  getLayer(messageEl, options = {}) {
    const root = this.getFeedbackRoot(messageEl, options);
    let layer = root.querySelector(":scope > .codex-dock__feedback-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "codex-dock__feedback-layer";
      layer.setAttribute("aria-hidden", "true");
      root.appendChild(layer);
    }
    return layer;
  }

  getFeedbackRoot(messageEl, options = {}) {
    if (options.scope === "message") {
      return messageEl;
    }
    const root = typeof this.getLayerRoot === "function" ? this.getLayerRoot() : null;
    return root || messageEl;
  }

  clearParticles(messageEl, options = {}) {
    const layer = this.getLayer(messageEl, options);
    const messageId = this.getMessageId(messageEl);
    layer.querySelectorAll(`.codex-dock__feedback-particle[data-feedback-message-id="${messageId}"]`)
      .forEach((particle) => particle.remove());
  }

  getStatusPoint(messageEl, statusEl, options = {}) {
    const layer = this.getLayer(messageEl, options);
    const layerRect = layer.getBoundingClientRect();
    const statusRect = statusEl.getBoundingClientRect();
    return {
      x: statusRect.left - layerRect.left + 9,
      y: statusRect.top - layerRect.top + statusRect.height / 2
    };
  }

  getMessageId(messageEl) {
    let id = this.messageIds.get(messageEl);
    if (!id) {
      id = String(this.nextMessageId);
      this.nextMessageId += 1;
      this.messageIds.set(messageEl, id);
    }
    return id;
  }
}

module.exports = {
  EmotiveFeedbackController
};
