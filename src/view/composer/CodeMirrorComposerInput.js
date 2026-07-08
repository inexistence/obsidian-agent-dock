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

  class InlinePreviewWidget extends WidgetType {
    constructor(label, className) {
      super();
      this.label = label;
      this.className = className;
    }

    eq(other) {
      return other.label === this.label && other.className === this.className;
    }

    toDOM() {
      const span = document.createElement("span");
      span.className = this.className;
      span.textContent = this.label;
      return span;
    }

    ignoreEvent() {
      return false;
    }
  }

  const inlinePreviewPlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.decorations = buildInlinePreviewDecorations(view, Decoration, InlinePreviewWidget);
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildInlinePreviewDecorations(update.view, Decoration, InlinePreviewWidget);
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
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (options.handleKeydown?.(event)) {
              event.stopPropagation();
              return true;
            }
            const isComposing = event.isComposing || event.keyCode === 229;
            if (event.key === "Enter" && !event.shiftKey && !isComposing) {
              event.preventDefault();
              event.stopPropagation();
              options.onSubmit?.();
              return true;
            }
            return false;
          }
        }),
        keymap ? keymap.of([...(defaultKeymap || []), ...(historyKeymap || [])]) : [],
        EditorView.lineWrapping,
        inlinePreviewPlugin,
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
  console.info("[Agent Dock] CodeMirror composer enabled", {
    history: Boolean(history),
    keymap: Boolean(keymap)
  });

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

function buildInlinePreviewDecorations(view, Decoration, InlinePreviewWidget) {
  const specs = [];
  const text = view.state.doc.toString();
  const selection = view.state.selection.main;
  for (const range of getMarkdownBlockPreviewRanges(text, selection)) {
    specs.push({
      from: range.lineFrom,
      to: range.lineFrom,
      order: -1,
      create: () => Decoration.line({
        class: range.lineClassName
      }).range(range.lineFrom)
    });
    specs.push({
      from: range.markerFrom,
      to: range.markerTo,
      order: 0,
      create: () => {
        const spec = { inclusive: false };
        if (range.markerLabel) {
          spec.widget = new InlinePreviewWidget(range.markerLabel, range.markerClassName);
        }
        return Decoration.replace(spec).range(range.markerFrom, range.markerTo);
      }
    });
  }
  for (const range of getMarkdownLinkPreviewRanges(text, selection)) {
    specs.push({
      from: range.from,
      to: range.to,
      order: 0,
      create: () => Decoration.replace({
        widget: new InlinePreviewWidget(range.label, "codex-dock__cm-link-preview"),
        inclusive: false
      }).range(range.from, range.to)
    });
  }
  for (const range of getMarkdownInlineCodePreviewRanges(text, selection)) {
    specs.push({
      from: range.from,
      to: range.to,
      order: 0,
      create: () => Decoration.replace({
        widget: new InlinePreviewWidget(range.label, "codex-dock__cm-code"),
        inclusive: false
      }).range(range.from, range.to)
    });
  }
  for (const range of getMarkdownInlineStylePreviewRanges(text, selection)) {
    specs.push({
      from: range.from,
      to: range.contentFrom,
      order: 0,
      create: () => Decoration.replace({ inclusive: false }).range(range.from, range.contentFrom)
    });
    specs.push({
      from: range.contentFrom,
      to: range.contentTo,
      order: 1,
      create: () => Decoration.mark({
        class: range.className
      }).range(range.contentFrom, range.contentTo)
    });
    specs.push({
      from: range.contentTo,
      to: range.to,
      order: 2,
      create: () => Decoration.replace({ inclusive: false }).range(range.contentTo, range.to)
    });
  }
  const ranges = specs.sort((left, right) => (
    left.from - right.from
    || left.to - right.to
    || left.order - right.order
  )).map((spec) => spec.create());
  return Decoration.set(ranges, true);
}

function getMarkdownBlockPreviewRanges(text, selection) {
  const source = String(text || "");
  const ranges = [];
  const ignoredRanges = getMarkdownCodeRanges(source).filter((range) => range.kind === "fence");
  let lineFrom = 0;

  for (const lineText of source.split("\n")) {
    const lineTo = lineFrom + lineText.length;
    if (
      lineText
      && !selectionIntersectsLine(selection, lineFrom, lineTo)
      && !rangeIntersectsAny(lineFrom, lineTo, ignoredRanges)
    ) {
      const range = getMarkdownBlockPreviewRangeForLine(lineText, lineFrom);
      if (range) {
        ranges.push(range);
      }
    }
    lineFrom = lineTo + 1;
  }

  return ranges;
}

function getMarkdownBlockPreviewRangeForLine(lineText, lineFrom) {
  const headingMatch = /^(#{1,6})([ \t]+)(\S.*)$/.exec(lineText);
  if (headingMatch) {
    const level = headingMatch[1].length;
    return {
      kind: "heading",
      lineFrom,
      lineClassName: `codex-dock__cm-heading codex-dock__cm-heading-${level}`,
      markerFrom: lineFrom,
      markerTo: lineFrom + headingMatch[1].length + headingMatch[2].length,
      markerLabel: "",
      markerClassName: ""
    };
  }

  const quoteMatch = /^([ \t]*)(>[ \t]?)(.*)$/.exec(lineText);
  if (quoteMatch) {
    return {
      kind: "blockquote",
      lineFrom,
      lineClassName: "codex-dock__cm-blockquote",
      markerFrom: lineFrom,
      markerTo: lineFrom + quoteMatch[1].length + quoteMatch[2].length,
      markerLabel: quoteMatch[1],
      markerClassName: "codex-dock__cm-block-marker"
    };
  }

  const unorderedListMatch = /^([ \t]*)([-+*])([ \t]+)(\S.*)$/.exec(lineText);
  if (unorderedListMatch) {
    return {
      kind: "unordered-list",
      lineFrom,
      lineClassName: "codex-dock__cm-list codex-dock__cm-list-unordered",
      markerFrom: lineFrom,
      markerTo: lineFrom + unorderedListMatch[1].length + unorderedListMatch[2].length + unorderedListMatch[3].length,
      markerLabel: `${unorderedListMatch[1]}\u2022 `,
      markerClassName: "codex-dock__cm-list-marker"
    };
  }

  const orderedListMatch = /^([ \t]*)(\d{1,9})([.)])([ \t]+)(\S.*)$/.exec(lineText);
  if (orderedListMatch) {
    return {
      kind: "ordered-list",
      lineFrom,
      lineClassName: "codex-dock__cm-list codex-dock__cm-list-ordered",
      markerFrom: lineFrom,
      markerTo: lineFrom + orderedListMatch[1].length + orderedListMatch[2].length + orderedListMatch[3].length + orderedListMatch[4].length,
      markerLabel: `${orderedListMatch[1]}${orderedListMatch[2]}${orderedListMatch[3]} `,
      markerClassName: "codex-dock__cm-list-marker"
    };
  }

  return null;
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

function getMarkdownInlineCodePreviewRanges(text, selection) {
  const ranges = [];
  for (const range of getMarkdownCodeRanges(text)) {
    if (range.kind !== "inline" || selectionIntersects(selection, range.from, range.to)) {
      continue;
    }
    ranges.push({
      from: range.from,
      to: range.to,
      label: String(text || "").slice(range.contentFrom, range.contentTo)
    });
  }
  return ranges;
}

function getMarkdownInlineStylePreviewRanges(text, selection) {
  const source = String(text || "");
  const ranges = [];
  const codeRanges = getMarkdownCodeRanges(source);
  const linkRanges = getMarkdownLinkSourceRanges(source);
  const ignoredRanges = [...codeRanges, ...linkRanges];
  const stylePatterns = [
    { kind: "bold", className: "codex-dock__cm-strong", pattern: /\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, markerLength: 2 },
    { kind: "bold", className: "codex-dock__cm-strong", pattern: /__([^\s_](?:[\s\S]*?[^\s_])?)__/g, markerLength: 2 },
    { kind: "strikethrough", className: "codex-dock__cm-strikethrough", pattern: /~~([^\s~](?:[\s\S]*?[^\s~])?)~~/g, markerLength: 2 },
    { kind: "italic", className: "codex-dock__cm-emphasis", pattern: /(?<!\*)\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?!\*)/g, markerLength: 1 },
    { kind: "italic", className: "codex-dock__cm-emphasis", pattern: /(?<![\w_])_([^\s_](?:[^_\n]*?[^\s_])?)_(?![\w_])/g, markerLength: 1 }
  ];

  for (const config of stylePatterns) {
    for (const match of source.matchAll(config.pattern)) {
      const from = match.index;
      const to = from + match[0].length;
      const contentFrom = from + config.markerLength;
      const contentTo = to - config.markerLength;
      if (
        selectionIntersects(selection, from, to)
        || rangeIntersectsAny(from, to, ignoredRanges)
        || rangeIntersectsAny(from, to, ranges)
      ) {
        continue;
      }
      ranges.push({
        from,
        to,
        contentFrom,
        contentTo,
        className: config.className,
        kind: config.kind
      });
    }
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
    ranges.push({ from, to, contentFrom: from, contentTo: to, kind: "fence" });
  }

  const inlinePattern = /`+[^`\n]*`+/g;
  for (const match of text.matchAll(inlinePattern)) {
    const from = match.index;
    const to = from + match[0].length;
    if (!rangeIntersectsAny(from, to, ranges)) {
      const markerLength = getInlineCodeMarkerLength(match[0]);
      ranges.push({
        from,
        to,
        contentFrom: from + markerLength,
        contentTo: Math.max(from + markerLength, to - markerLength),
        kind: "inline"
      });
    }
  }
  ranges.sort((left, right) => left.from - right.from);
  return ranges;
}

function getMarkdownLinkSourceRanges(source) {
  const ranges = [];
  const text = String(source || "");
  const markdownLinkPattern = /(!?)\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  for (const match of text.matchAll(markdownLinkPattern)) {
    ranges.push({ from: match.index, to: match.index + match[0].length, kind: "link" });
  }
  const wikiLinkPattern = /(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g;
  for (const match of text.matchAll(wikiLinkPattern)) {
    ranges.push({ from: match.index, to: match.index + match[0].length, kind: "link" });
  }
  return ranges;
}

function getInlineCodeMarkerLength(value) {
  const match = /^`+/.exec(String(value || ""));
  return match ? match[0].length : 1;
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

function selectionIntersectsLine(selection, from, to) {
  if (!selection) {
    return false;
  }
  if (selection.from === selection.to) {
    return selection.from >= from && selection.from <= to;
  }
  return selection.from <= to && selection.to >= from;
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
    buildInlinePreviewDecorations,
    createSelection,
    getEventOptions,
    getMarkdownBlockPreviewRanges,
    getMarkdownInlineCodePreviewRanges,
    getMarkdownInlineStylePreviewRanges,
    getMarkdownCodeRanges,
    getMarkdownLinkPreviewRanges,
    getPathName,
    rangeIntersectsAny,
    selectionIntersects,
    selectionIntersectsLine
  }
};
