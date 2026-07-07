const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "obsidian") {
    return {
      normalizePath: (path) => String(path || "").replace(/\\/g, "/")
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
const { ReferenceResolver } = require("../src/view/reference/ReferenceResolver");
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
}
