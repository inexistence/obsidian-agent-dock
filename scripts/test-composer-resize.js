const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      ItemView: class ItemView {},
      MarkdownRenderer: class MarkdownRenderer {},
      Modal: class Modal {},
      Notice: class Notice {},
      normalizePath: (path) => String(path || "").replace(/\\/g, "/"),
      setIcon: () => {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { _test } = require("../src/view/composer/ComposerRenderer");
const { AgentDockView } = require("../src/view/AgentDockView");

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of Array.from(this.listeners.get(type) || [])) {
      listener(event);
    }
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size || 0;
  }
}

function createClassTarget() {
  const target = new FakeEventTarget();
  target.classes = new Set();
  target.addClass = (name) => target.classes.add(name);
  target.removeClass = (name) => target.classes.delete(name);
  target.toggleClass = (name, enabled) => {
    if (enabled) {
      target.classes.add(name);
    } else {
      target.classes.delete(name);
    }
  };
  return target;
}

const documentTarget = new FakeEventTarget();
const shell = createClassTarget();
shell.getBoundingClientRect = () => ({ top: 100 });
shell.capturedPointers = new Set();
shell.setPointerCapture = (pointerId) => shell.capturedPointers.add(pointerId);
shell.hasPointerCapture = (pointerId) => shell.capturedPointers.has(pointerId);
shell.releasePointerCapture = (pointerId) => shell.capturedPointers.delete(pointerId);

const inputWrap = createClassTarget();
const styleValues = new Map();
inputWrap.style = {
  getPropertyValue: (name) => styleValues.get(name) || "",
  removeProperty: (name) => styleValues.delete(name),
  setProperty: (name, value) => styleValues.set(name, value)
};
inputWrap.getBoundingClientRect = () => ({ height: 62 });

let nextFrameId = 1;
const frames = new Map();
const requestAnimationFrame = (callback) => {
  const frameId = nextFrameId;
  nextFrameId += 1;
  frames.set(frameId, callback);
  return frameId;
};
const cancelAnimationFrame = (frameId) => frames.delete(frameId);
const runFrames = () => {
  const pending = Array.from(frames.values());
  frames.clear();
  for (const callback of pending) {
    callback();
  }
};

const changedHeights = [];
let resizeStartCount = 0;
let resizeEndCount = 0;
const cleanup = _test.setupInputResizeEdge(shell, inputWrap, {
  documentTarget,
  requestAnimationFrame,
  cancelAnimationFrame,
  onInputResizeStart: () => {
    resizeStartCount += 1;
  },
  onInputHeightChanged: (height) => changedHeights.push(height),
  onInputResizeEnd: () => {
    resizeEndCount += 1;
  }
});

shell.dispatch("pointerdown", {
  button: 0,
  clientY: 104,
  pointerId: 7,
  preventDefault: () => {}
});
assert.strictEqual(resizeStartCount, 1);
assert.strictEqual(documentTarget.listenerCount("pointermove"), 1);
assert.strictEqual(documentTarget.listenerCount("pointerup"), 1);

documentTarget.dispatch("pointermove", { clientY: 96, pointerId: 7 });
documentTarget.dispatch("pointermove", { clientY: 84, pointerId: 7 });
documentTarget.dispatch("pointermove", { clientY: 70, pointerId: 7 });
assert.strictEqual(frames.size, 1, "pointer moves should coalesce into one animation frame");
assert.deepStrictEqual(changedHeights, []);

runFrames();
assert.deepStrictEqual(changedHeights, [96]);
assert.strictEqual(styleValues.get("--codex-dock-composer-input-height"), "96px");

documentTarget.dispatch("pointerup", { pointerId: 7 });
assert.strictEqual(resizeEndCount, 1);
assert.strictEqual(documentTarget.listenerCount("pointermove"), 0);
assert.strictEqual(documentTarget.listenerCount("pointerup"), 0);
assert.strictEqual(inputWrap.classes.has("is-resizing-input"), false);

shell.dispatch("pointerdown", {
  button: 0,
  clientY: 104,
  pointerId: 8,
  preventDefault: () => {}
});
documentTarget.dispatch("pointermove", { clientY: 80, pointerId: 8 });
assert.strictEqual(frames.size, 1);

cleanup();
cleanup();
runFrames();
assert.strictEqual(resizeEndCount, 2, "cleanup should finish an active resize exactly once");
assert.deepStrictEqual(changedHeights, [96], "cleanup should discard detached pending updates");
assert.strictEqual(documentTarget.listenerCount("pointermove"), 0);
assert.strictEqual(documentTarget.listenerCount("pointerup"), 0);
assert.strictEqual(documentTarget.listenerCount("pointercancel"), 0);
assert.strictEqual(shell.listenerCount("pointerdown"), 0);

function renderComposerWithScrollPosition(isNearBottom) {
  let scrollCount = 0;
  let renderCount = 0;
  const composer = {
    empty: () => {}
  };
  const view = {
    containerEl: {
      querySelector: () => composer
    },
    inputEl: null,
    isMessageListNearBottom: () => isNearBottom,
    getActiveSession: () => ({ draft: "queued draft" }),
    destroyComposerInput: () => {},
    renderComposerContent: () => {
      renderCount += 1;
    },
    scrollMessagesToBottom: () => {
      scrollCount += 1;
    }
  };

  AgentDockView.prototype.renderComposer.call(view, { preserveFocus: false });
  return { renderCount, scrollCount };
}

assert.deepStrictEqual(renderComposerWithScrollPosition(true), {
  renderCount: 1,
  scrollCount: 1
});
assert.deepStrictEqual(renderComposerWithScrollPosition(false), {
  renderCount: 1,
  scrollCount: 0
});

console.log("composer resize tests passed");
