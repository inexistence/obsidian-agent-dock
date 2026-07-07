const { setIcon } = require("obsidian");

class ImagePreviewController {
  constructor({ containerEl, translate }) {
    this.containerEl = containerEl;
    this.translate = translate;
    this.overlayEl = null;
    this.keydownHandler = null;
    this.previouslyFocusedEl = null;
    this.zoom = 1;
    this.imageEl = null;
    this.frameEl = null;
    this.wrapEl = null;
    this.zoomLabelEl = null;
    this.baseWidth = 0;
    this.baseHeight = 0;
    this.availableWidth = 0;
    this.availableHeight = 0;
    this.resizeObserver = null;
    this.resizeFrame = null;
  }

  decorate(markdownEl) {
    for (const imageEl of markdownEl.querySelectorAll("img")) {
      imageEl.classList.add("codex-dock__previewable-image");
      imageEl.setAttribute("tabindex", "0");
      imageEl.setAttribute("role", "button");
      imageEl.setAttribute("aria-label", this.translate("view.openImagePreview"));
      imageEl.setAttribute("title", this.translate("view.openImagePreview"));
      imageEl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.open(imageEl);
      });
      imageEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.open(imageEl);
      });
    }
  }

  open(sourceImageEl) {
    const src = sourceImageEl?.currentSrc || sourceImageEl?.src || sourceImageEl?.getAttribute("src") || "";
    if (!src) {
      return;
    }

    this.close();
    this.previouslyFocusedEl = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const overlay = this.containerEl.createDiv({
      cls: "codex-dock__image-preview",
      attr: {
        role: "dialog",
        "aria-modal": "true",
        "aria-label": this.translate("view.imagePreview")
      }
    });
    const backdrop = overlay.createDiv({ cls: "codex-dock__image-preview-backdrop" });
    const stage = overlay.createDiv({ cls: "codex-dock__image-preview-stage" });
    const toolbar = stage.createDiv({ cls: "codex-dock__image-preview-toolbar" });
    toolbar.createDiv({
      cls: "codex-dock__image-preview-title",
      text: this.getTitle(sourceImageEl, src)
    });
    const controls = toolbar.createDiv({ cls: "codex-dock__image-preview-controls" });
    const zoomOutButton = this.createButton(controls, "minus", "view.zoomOutImagePreview");
    this.zoomLabelEl = controls.createSpan({
      cls: "codex-dock__image-preview-zoom",
      text: "100%"
    });
    const zoomInButton = this.createButton(controls, "plus", "view.zoomInImagePreview");
    const resetZoomButton = this.createButton(controls, "maximize-2", "view.resetImagePreviewZoom");
    const closeButton = toolbar.createEl("button", {
      cls: "codex-dock__image-preview-close",
      attr: {
        type: "button",
        "aria-label": this.translate("view.closeImagePreview"),
        title: this.translate("view.closeImagePreview")
      }
    });
    setIcon(closeButton, "x");
    const imageWrap = stage.createDiv({ cls: "codex-dock__image-preview-wrap" });
    this.wrapEl = imageWrap;
    this.frameEl = imageWrap.createDiv({ cls: "codex-dock__image-preview-frame" });
    this.imageEl = this.frameEl.createEl("img", {
      cls: "codex-dock__image-preview-img",
      attr: {
        src,
        alt: sourceImageEl.alt || ""
      }
    });
    this.imageEl.addEventListener("load", () => this.refreshBaseSize(), { once: true });
    if (this.imageEl.complete && this.imageEl.naturalWidth > 0) {
      requestAnimationFrame(() => this.refreshBaseSize());
    }
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.scheduleBaseSizeRefresh());
      this.resizeObserver.observe(imageWrap);
    }

    const close = () => this.close();
    backdrop.addEventListener("click", close);
    closeButton.addEventListener("click", close);
    zoomOutButton.addEventListener("click", () => this.adjustZoom(-0.25));
    zoomInButton.addEventListener("click", () => this.adjustZoom(0.25));
    resetZoomButton.addEventListener("click", () => this.setZoom(1));
    overlay.addEventListener("wheel", (event) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.adjustZoom(event.deltaY > 0 ? -0.15 : 0.15);
    }, { capture: true, passive: false });
    this.keydownHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.key === "Tab") {
        this.trapFocus(event);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        event.stopPropagation();
        this.adjustZoom(0.25);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "-") {
        event.preventDefault();
        event.stopPropagation();
        this.adjustZoom(-0.25);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        event.stopPropagation();
        this.setZoom(1);
      }
    };
    window.addEventListener("keydown", this.keydownHandler, true);
    this.overlayEl = overlay;
    this.setZoom(1);
    requestAnimationFrame(() => this.refreshBaseSize());
    closeButton.focus();
  }

  createButton(containerEl, icon, labelKey) {
    const button = containerEl.createEl("button", {
      cls: "codex-dock__image-preview-tool",
      attr: {
        type: "button",
        "aria-label": this.translate(labelKey),
        title: this.translate(labelKey)
      }
    });
    setIcon(button, icon);
    return button;
  }

  adjustZoom(delta) {
    this.setZoom(this.zoom + delta);
  }

  setZoom(value) {
    this.zoom = Math.min(5, Math.max(0.25, Number(value) || 1));
    this.applyZoom();
  }

  scheduleBaseSizeRefresh() {
    if (this.resizeFrame !== null) {
      return;
    }
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.refreshBaseSize();
    });
  }

  refreshBaseSize() {
    const imageEl = this.imageEl;
    const wrapEl = this.wrapEl;
    if (!imageEl || !wrapEl) {
      return;
    }

    const style = window.getComputedStyle(wrapEl);
    const paddingX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const wrapRect = wrapEl.getBoundingClientRect();
    const availableWidth = Math.max(1, wrapRect.width - paddingX);
    const availableHeight = Math.max(1, wrapRect.height - paddingY);
    const naturalWidth = imageEl.naturalWidth || availableWidth;
    const naturalHeight = imageEl.naturalHeight || availableHeight;
    const fitScale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight);
    const baseWidth = Math.max(1, naturalWidth * fitScale);
    const baseHeight = Math.max(1, naturalHeight * fitScale);
    const changed = Math.abs(this.availableWidth - availableWidth) > 0.5
      || Math.abs(this.availableHeight - availableHeight) > 0.5
      || Math.abs(this.baseWidth - baseWidth) > 0.5
      || Math.abs(this.baseHeight - baseHeight) > 0.5;
    if (!changed) {
      return;
    }

    this.availableWidth = availableWidth;
    this.availableHeight = availableHeight;
    this.baseWidth = baseWidth;
    this.baseHeight = baseHeight;
    this.applyZoom();
  }

  applyZoom() {
    if (this.wrapEl) {
      this.wrapEl.style.overflow = this.zoom > 1.001 ? "auto" : "hidden";
    }
    if (this.frameEl) {
      if (this.baseWidth > 0) {
        const frameWidth = Math.round(this.baseWidth * this.zoom);
        const frameHeight = Math.round(this.baseHeight * this.zoom);
        this.frameEl.style.width = `${frameWidth}px`;
        this.frameEl.style.height = `${frameHeight}px`;
        this.frameEl.style.marginLeft = frameWidth < this.availableWidth ? "auto" : "0";
        this.frameEl.style.marginRight = frameWidth < this.availableWidth ? "auto" : "0";
        const verticalMargin = Math.max(0, Math.floor((this.availableHeight - frameHeight) / 2));
        this.frameEl.style.marginTop = `${verticalMargin}px`;
        this.frameEl.style.marginBottom = `${verticalMargin}px`;
      } else {
        this.frameEl.style.width = `${this.zoom * 100}%`;
        this.frameEl.style.height = "auto";
        this.frameEl.style.margin = "0 auto";
      }
    }
    if (this.zoomLabelEl) {
      this.zoomLabelEl.setText(`${Math.round(this.zoom * 100)}%`);
    }
  }

  getTitle(sourceImageEl, src) {
    const label = String(sourceImageEl?.alt || sourceImageEl?.getAttribute("aria-label") || "").trim();
    if (label && label !== this.translate("view.openImagePreview")) {
      return label;
    }
    const decodedName = this.getNameFromSource(src);
    return decodedName || this.translate("view.imagePreview");
  }

  getNameFromSource(src) {
    const cleanSrc = String(src || "").split("#")[0].split("?")[0];
    const name = cleanSrc.split("/").filter(Boolean).pop() || "";
    if (!name) {
      return "";
    }
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }

  trapFocus(event) {
    if (!this.overlayEl) {
      return;
    }
    const focusable = Array.from(this.overlayEl.querySelectorAll(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    )).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      this.overlayEl.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  close() {
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler, true);
      this.keydownHandler = null;
    }
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.imageEl = null;
    this.frameEl = null;
    this.wrapEl = null;
    this.zoomLabelEl = null;
    this.baseWidth = 0;
    this.baseHeight = 0;
    this.availableWidth = 0;
    this.availableHeight = 0;
    this.resizeFrame = null;
    this.zoom = 1;
    if (this.previouslyFocusedEl?.isConnected) {
      this.previouslyFocusedEl.focus();
    }
    this.previouslyFocusedEl = null;
  }
}

module.exports = {
  ImagePreviewController
};
