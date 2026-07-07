function createCodeMirrorComposerInput(options = {}) {
  const modules = loadCodeMirrorModules();
  if (!modules) {
    options.onUnavailable?.();
    return null;
  }

  const {
    defaultKeymap,
    Decoration,
    EditorState,
    EditorView,
    history,
    historyKeymap,
    keymap,
    ViewPlugin,
    WidgetType
  } = modules;
  const parent = options.parent;
  if (!parent) {
    return null;
  }

  class LinkPreviewWidget extends WidgetType {
    constructor(label) {
      super();
      this.label = label;
    }

    eq(other) {
      return other.label === this.label;
    }

    toDOM() {
      const span = document.createElement("span");
      span.className = "codex-dock__cm-link-preview";
      span.textContent = this.label;
      return span;
    }

    ignoreEvent() {
      return false;
    }
  }

  const linkPreviewPlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = buildLinkPreviewDecorations(view, Decoration, LinkPreviewWidget);
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLinkPreviewDecorations(update.view, Decoration, LinkPreviewWidget);
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations
  });

  const rootEl = parent.createDiv({ cls: "codex-dock__cm-input" });
  rootEl.dataset.placeholder = options.placeholder || "";
  const view = new EditorView({
    parent: rootEl,
    state: EditorState.create({
      doc: options.value || "",
      extensions: [
        history ? history() : [],
        keymap ? keymap.of([...(defaultKeymap || []), ...(historyKeymap || [])]) : [],
        EditorView.lineWrapping,
        linkPreviewPlugin,
        EditorView.updateListener.of((update) => {
          rootEl.classList.toggle("is-empty", update.state.doc.length === 0);
          if (update.docChanged) {
            rootEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }),
        EditorView.theme({
          "&": {
            background: "transparent"
          },
          ".cm-scroller": {
            fontFamily: "inherit"
          }
        })
      ]
    })
  });
  rootEl.classList.toggle("is-empty", view.state.doc.length === 0);

  return new CodeMirrorComposerInput(rootEl, view);
}

class CodeMirrorComposerInput {
  constructor(rootEl, view) {
    this.rootEl = rootEl;
    this.view = view;
    this.isCodeMirrorComposerInput = true;
    this.isDestroyed = false;
  }

  get value() {
    return this.view.state.doc.toString();
  }

  set value(nextValue) {
    const value = String(nextValue || "");
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: value
      },
      selection: {
        anchor: value.length
      }
    });
  }

  get selectionStart() {
    return this.view.state.selection.main.from;
  }

  set selectionStart(position) {
    const end = this.selectionEnd;
    this.setSelectionRange(position, Math.max(position, end));
  }

  get selectionEnd() {
    return this.view.state.selection.main.to;
  }

  set selectionEnd(position) {
    this.setSelectionRange(this.selectionStart, position);
  }

  get isConnected() {
    return this.rootEl.isConnected;
  }

  focus() {
    this.view.focus();
  }

  addEventListener(type, listener, options) {
    this.rootEl.addEventListener(type, listener, getEventOptions(type, options));
  }

  removeEventListener(type, listener, options) {
    this.rootEl.removeEventListener(type, listener, getEventOptions(type, options));
  }

  contains(target) {
    return this.rootEl.contains(target);
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;
    this.view.destroy();
  }

  setSelectionRange(start, end = start) {
    const length = this.view.state.doc.length;
    const anchor = clampPosition(start, length);
    const head = clampPosition(end, length);
    this.view.dispatch({
      selection: {
        anchor,
        head
      },
      scrollIntoView: true
    });
  }
}

function buildLinkPreviewDecorations(view, Decoration, LinkPreviewWidget) {
  const ranges = [];
  const text = view.state.doc.toString();
  const selection = view.state.selection.main;
  for (const range of getMarkdownLinkPreviewRanges(text, selection)) {
    ranges.push(Decoration.replace({
      widget: new LinkPreviewWidget(range.label),
      inclusive: false
    }).range(range.from, range.to));
  }
  return Decoration.set(ranges, true);
}

function getMarkdownLinkPreviewRanges(text, selection) {
  const ranges = [];
  const source = String(text || "");
  const ignoredRanges = getMarkdownCodeRanges(source);
  const markdownLinkPattern = /(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  for (const match of source.matchAll(markdownLinkPattern)) {
    const from = match.index;
    const to = from + match[0].length;
    if (selectionIntersects(selection, from, to) || rangeIntersectsAny(from, to, ignoredRanges)) {
      continue;
    }
    ranges.push({
      from,
      to,
      label: match[2],
      target: match[3],
      embed: match[1] === "!"
    });
  }
  const wikiLinkPattern = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
  for (const match of source.matchAll(wikiLinkPattern)) {
    const from = match.index;
    const to = from + match[0].length;
    if (selectionIntersects(selection, from, to) || rangeIntersectsAny(from, to, ignoredRanges)) {
      continue;
    }
    const target = match[2];
    ranges.push({
      from,
      to,
      label: match[3] || getPathName(target),
      target,
      embed: match[1] === "!"
    });
  }
  ranges.sort((left, right) => left.from - right.from);
  return ranges;
}

function getMarkdownCodeRanges(source) {
  const ranges = [];
  const text = String(source || "");
  const fencePattern = /(^|\n)(`{3,}|~{3,})[^\n]*(?:\n[\s\S]*?\n\2(?=\n|$)|[\s\S]*$)/g;
  for (const match of text.matchAll(fencePattern)) {
    const from = match.index + match[1].length;
    const to = from + match[0].length - match[1].length;
    ranges.push({ from, to });
  }

  const inlinePattern = /`+[^`\n]*`+/g;
  for (const match of text.matchAll(inlinePattern)) {
    const from = match.index;
    const to = from + match[0].length;
    if (!rangeIntersectsAny(from, to, ranges)) {
      ranges.push({ from, to });
    }
  }
  ranges.sort((left, right) => left.from - right.from);
  return ranges;
}

function getPathName(path) {
  return String(path || "").split("/").filter(Boolean).pop() || String(path || "");
}

function selectionIntersects(selection, from, to) {
  if (!selection) {
    return false;
  }
  if (selection.from === selection.to) {
    return selection.from >= from && selection.from < to;
  }
  return selection.from < to && selection.to > from;
}

function rangeIntersectsAny(from, to, ranges) {
  return ranges.some((range) => from < range.to && to > range.from);
}

function createSelection(from, to = from) {
  return { from, to };
}

function clampPosition(position, length) {
  const value = Number.isFinite(position) ? position : length;
  return Math.max(0, Math.min(length, value));
}

function getEventOptions(type, options) {
  if (type !== "blur" && type !== "focus") {
    return options;
  }
  if (typeof options === "boolean") {
    return true;
  }
  return {
    ...(options || {}),
    capture: true
  };
}

function loadCodeMirrorModules() {
  try {
    const { EditorState } = require("@codemirror/state");
    const { Decoration, EditorView, keymap, ViewPlugin, WidgetType } = require("@codemirror/view");
    const commands = loadOptionalCodeMirrorCommands();
    if (!EditorState || !EditorView || !Decoration || !ViewPlugin || !WidgetType) {
      return null;
    }
    return {
      defaultKeymap: commands.defaultKeymap,
      Decoration,
      EditorState,
      EditorView,
      history: commands.history,
      historyKeymap: commands.historyKeymap,
      keymap,
      ViewPlugin,
      WidgetType
    };
  } catch (error) {
    return null;
  }
}

function loadOptionalCodeMirrorCommands() {
  try {
    return require("@codemirror/commands") || {};
  } catch (error) {
    return {};
  }
}

module.exports = {
  createCodeMirrorComposerInput,
  _test: {
    buildLinkPreviewDecorations,
    createSelection,
    getEventOptions,
    getMarkdownCodeRanges,
    getMarkdownLinkPreviewRanges,
    getPathName,
    rangeIntersectsAny,
    selectionIntersects
  }
};
