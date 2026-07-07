const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      normalizePath: (path) => String(path || "").replace(/\\/g, "/"),
      setIcon: () => {}
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  extractMentionReferences,
  formatMentionToken,
  getMentionMatch,
  replaceObsidianOpenLinks
} = require("../src/view/reference/mention");
const {
  ReferenceDropParser,
  createReferenceDropDebugInfo,
  extractReferenceCandidatesFromText,
  isLocalFileReference
} = require("../src/view/reference/ReferenceDropParser");
const { ReferenceController } = require("../src/view/reference/ReferenceController");
const { ReferenceResolver } = require("../src/view/reference/ReferenceResolver");
const { _test: codeMirrorComposerTest } = require("../src/view/composer/CodeMirrorComposerInput");
const { _test: composerRendererTest } = require("../src/view/composer/ComposerRenderer");
const { buildPromptWithMetadata } = require("../src/prompt");
const { DEFAULT_SETTINGS } = require("../src/settings");

assert.strictEqual(formatMentionToken("Notes/Today.md"), "[[Notes/Today.md]]");
assert.strictEqual(formatMentionToken("Images/pasted image.png"), "![[Images/pasted image.png]]");
assert.strictEqual(formatMentionToken("Notes/Today.md", { embed: true }), "![[Notes/Today.md]]");

assert.deepStrictEqual(getMentionMatch("请看 [[Not", 8), {
  start: 3,
  end: 8,
  query: "Not",
  trigger: "wiki"
});
assert.deepStrictEqual(getMentionMatch("请看 ![[ima", 10), {
  start: 3,
  end: 10,
  query: "ima",
  trigger: "embed-wiki"
});
assert.deepStrictEqual(getMentionMatch("请看 @Not", 7), {
  start: 3,
  end: 7,
  query: "Not",
  trigger: "mention"
});

assert.deepStrictEqual(
  extractMentionReferences("看 [[Notes/Today.md]] 和 ![[Images/pasted image.png]]"),
  [
    { path: "Notes/Today.md", name: "Today.md" },
    { path: "Images/pasted image.png", name: "pasted image.png" }
  ]
);

assert.deepStrictEqual(
  extractMentionReferences("旧语法 @\"Notes/Today note.md\" 仍兼容"),
  [
    { path: "Notes/Today note.md", name: "Today note.md" }
  ]
);

assert.strictEqual(
  replaceObsidianOpenLinks("obsidian://open?file=Images%2Fpasted%20image.png"),
  "![[Images/pasted image.png]]"
);

assert.deepStrictEqual(
  extractReferenceCandidatesFromText(
    "file:///Users/bigo/Desktop/remote-cursor-workspace/%E6%94%B6%E8%97%8F/2026-03-19-AI-Agent%E5%B8%B8%E8%A7%81%E5%B7%A5%E4%BD%9C%E6%B5%81%E6%A8%A1%E5%BC%8F.md"
  ),
  ["/Users/bigo/Desktop/remote-cursor-workspace/收藏/2026-03-19-AI-Agent常见工作流模式.md"]
);
assert.strictEqual(isLocalFileReference("file:///Users/bigo/Desktop/Note.md"), true);
assert.strictEqual(isLocalFileReference("Notes/Today.md"), false);
assert.strictEqual(composerRendererTest.hasFileDropPayload({ files: [{ name: "Note.md" }] }), true);
assert.strictEqual(composerRendererTest.hasFileDropPayload({ items: [{ kind: "file" }] }), true);
assert.strictEqual(composerRendererTest.hasFileDropPayload({ types: ["text/plain"], getData: () => "hello" }), false);

assert.deepStrictEqual(
  codeMirrorComposerTest.getMarkdownLinkPreviewRanges(
    "看 [x](zzzzz) 和 [y](Notes/y.md) 还有 [[Notes/Today.md]] 与 [[Notes/Tomorrow.md|明天]]",
    codeMirrorComposerTest.createSelection(0)
  ),
  [
    { from: 2, to: 12, label: "x", target: "zzzzz", embed: false },
    { from: 15, to: 30, label: "y", target: "Notes/y.md", embed: false },
    { from: 34, to: 52, label: "Today.md", target: "Notes/Today.md", embed: false },
    { from: 55, to: 79, label: "明天", target: "Notes/Tomorrow.md", embed: false }
  ]
);
assert.deepStrictEqual(
  codeMirrorComposerTest.getMarkdownLinkPreviewRanges(
    "看 [x](zzzzz)",
    codeMirrorComposerTest.createSelection(5)
  ),
  []
);
assert.deepStrictEqual(
  codeMirrorComposerTest.getMarkdownLinkPreviewRanges(
    "看 [x](zzzzz)",
    codeMirrorComposerTest.createSelection(12)
  ),
  [{ from: 2, to: 12, label: "x", target: "zzzzz", embed: false }]
);
assert.deepStrictEqual(
  codeMirrorComposerTest.getMarkdownLinkPreviewRanges(
    "看 `[x](zzzzz)`",
    codeMirrorComposerTest.createSelection(0)
  ),
  []
);
assert.deepStrictEqual(
  codeMirrorComposerTest.getMarkdownLinkPreviewRanges(
    "```md\n[x](zzzzz)\n```\n看 [y](ok)",
    codeMirrorComposerTest.createSelection(0)
  ),
  [{ from: 23, to: 30, label: "y", target: "ok", embed: false }]
);

{
  const dataTransfer = {
    items: [
      {
        getAsFile() {
          return null;
        },
        webkitGetAsEntry() {
          return {
            fullPath: "/Folder/Nested.md",
            name: "Nested.md",
            isFile: true,
            isDirectory: false
          };
        }
      },
      {
        getAsFile() {
          return null;
        },
        webkitGetAsEntry() {
          return {
            fullPath: "/RootOnly.md",
            name: "RootOnly.md",
            isFile: true,
            isDirectory: false
          };
        }
      }
    ],
    files: [],
    types: [],
    getData: () => ""
  };
  assert.deepStrictEqual(
    new ReferenceDropParser().extractCandidates(dataTransfer, createReferenceDropDebugInfo(dataTransfer))
      .map((candidate) => candidate.path),
    ["/Folder/Nested.md", "RootOnly.md"]
  );
}

{
  const resolver = new ReferenceResolver({
    vault: {
      getAllLoadedFiles() {
        return [
          { path: "Notes/image plan.md", name: "image plan.md" },
          { path: "Images/image.png", name: "image.png" },
          { path: "Images/image.webp", name: "image.webp" }
        ];
      }
    }
  });
  assert.deepStrictEqual(
    resolver.getVaultPathSuggestions("image", { preferImages: true }).map((suggestion) => suggestion.path),
    ["Images/image.png", "Images/image.webp", "Notes/image plan.md"]
  );
}

runAsyncTests()
  .then(() => {
    console.log("obsidian link tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

async function runAsyncTests() {
  const app = {
    vault: {
      adapter: {
        basePath: "/Users/example/Vault"
      },
      getAbstractFileByPath(path) {
        if (path === "Images/pasted image.png") {
          return { path, name: "pasted image.png" };
        }
        return null;
      },
      getAllLoadedFiles() {
        return [];
      }
    }
  };
  const result = await buildPromptWithMetadata(
    app,
    DEFAULT_SETTINGS,
    "请看 ![[Images/pasted image.png]]",
    [{ role: "user", content: "请看 ![[Images/pasted image.png]]" }]
  );
  assert(result.prompt.includes("Referenced Obsidian paths:"));
  assert(result.prompt.includes("- Images/pasted image.png (file)"));

  {
    let draft = "";
    const app = {
      vault: {
        adapter: {
          basePath: "/Users/bigo/Vault"
        },
        getAbstractFileByPath() {
          return null;
        },
        getAllLoadedFiles() {
          return [];
        }
      }
    };
    const controller = new ReferenceController({
      app,
      plugin: {
        app,
        settings: {
          debugActivity: false
        }
      },
      getActiveSession: () => ({ draft }),
      persistSessionChange: (session) => {
        draft = session.draft;
      },
      updateContextStatus: () => {},
      onInputValueChanged: () => {},
      translate: (key) => key
    });
    controller.setElements({
      inputEl: {
        value: "看 ",
        selectionStart: 2,
        selectionEnd: 2,
        focus: () => {}
      },
      mentionChipsEl: null,
      mentionMenuEl: null
    });
    const externalPath = "/Users/bigo/Desktop/remote-cursor-workspace/收藏/2026-03-19-AI-Agent常见工作流模式.md";
    const externalName = "2026-03-19-AI-Agent常见工作流模式.md";
    const accepted = controller.handleReferenceDrop({
      items: [
        {
          getAsFile() {
            return {
              path: externalPath,
              name: externalName,
              type: "text/markdown",
              size: 100,
              lastModified: 0
            };
          },
          webkitGetAsEntry() {
            return {
              fullPath: `/${externalName}`,
              name: externalName,
              isFile: true,
              isDirectory: false
            };
          }
        }
      ],
      files: [
        {
          path: externalPath,
          name: externalName,
          type: "text/markdown",
          size: 100,
          lastModified: 0
        }
      ],
      types: [],
      getData: () => ""
    });
    assert.strictEqual(accepted, true);
    assert.strictEqual(
      controller.inputEl.value,
      `看 [${externalName}](${encodeURI(externalPath)}) `
    );
    assert.strictEqual(draft, controller.inputEl.value);
  }
}
