const assert = require("assert");

const {
  replacePastedImageEmbedsForRendering,
  saveClipboardImageFile,
  _test
} = require("../src/view/reference/ClipboardImageReference");

function createApp(configPath, activePath = "Notes/Today.md") {
  return {
    vault: {
      getConfig(key) {
        return key === "attachmentFolderPath" ? configPath : "";
      }
    },
    workspace: {
      getActiveFile() {
        return {
          path: activePath,
          parent: {
            path: _test.normalizeVaultPath(activePath).split("/").slice(0, -1).join("/")
          }
        };
      }
    }
  };
}

assert.strictEqual(
  _test.createPastedImageBaseName(new Date(2026, 6, 7, 1, 2, 3, 4)),
  "pasted-image20260707-010203-004"
);

assert.strictEqual(_test.normalizeVaultPath("\\Inbox//Images/"), "Inbox/Images");
assert.strictEqual(_test.joinVaultPath("Notes", "./Images"), "Notes/Images");
assert.strictEqual(_test.getImageExtension({ name: "", type: "image/jpeg" }), "jpg");
assert.strictEqual(_test.getImageExtension({ name: "clip.weird-name", type: "image/png" }), "png");
assert.strictEqual(_test.getImageExtension({ name: "", type: "image/svg+xml" }), "svg");
assert.strictEqual(_test.isGenericClipboardImageFile({ name: "image.tiff" }), true);
assert.strictEqual(_test.isGenericClipboardImageFile({ name: "diagram.png" }), false);

assert.strictEqual(_test.resolvePasteFolder(createApp("")), ".agent-dock-cache/pasted-images");
assert.strictEqual(_test.resolveObsidianAttachmentFolder(createApp("/")), "");
assert.strictEqual(_test.resolveObsidianAttachmentFolder(createApp("./", "Daily/2026-07-07.md")), "Daily");
assert.strictEqual(_test.resolveObsidianAttachmentFolder(createApp("./attachments", "Daily/2026-07-07.md")), "Daily/attachments");
assert.strictEqual(_test.resolveObsidianAttachmentFolder(createApp("Assets/Pasted")), "Assets/Pasted");
assert.strictEqual(_test.isCacheImagePath(".agent-dock-cache/pasted-images/a.png"), true);
assert.strictEqual(_test.isCacheImagePath("Attachments/a.png"), false);
assert.strictEqual(
  replacePastedImageEmbedsForRendering({
    vault: {
      adapter: {
        getResourcePath(path) {
          return `app://local/${path}`;
        }
      }
    }
  }, "请看 ![[.agent-dock-cache/pasted-images/chart.png]]"),
  "请看 ![](<app://local/.agent-dock-cache/pasted-images/chart.png>)"
);
assert.strictEqual(
  _test.replacePastedImageEmbedsForRendering({ vault: { adapter: {} } }, "![[Attachments/chart.png]]"),
  "![[Attachments/chart.png]]"
);
assert.strictEqual(
  _test.getPastedImageAbsolutePath(
    { vault: { adapter: { basePath: "/Users/example/Vault" } } },
    ".agent-dock-cache/pasted-images/chart.png"
  ),
  "/Users/example/Vault/.agent-dock-cache/pasted-images/chart.png"
);

{
  const firstFile = {
    name: "image.png",
    type: "image/png",
    size: 1234,
    lastModified: 0
  };
  const duplicateFile = {
    name: "image.png",
    type: "image/png",
    size: 1234,
    lastModified: 0
  };
  const files = _test.extractClipboardImageFiles({
    items: [{
      kind: "file",
      type: "image/png",
      getAsFile: () => firstFile
    }],
    files: [duplicateFile]
  });
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0], firstFile);
}

{
  const pngRepresentation = {
    name: "image.png",
    type: "image/png",
    size: 1234,
    lastModified: 0
  };
  const tiffRepresentation = {
    name: "image.tiff",
    type: "image/tiff",
    size: 4321,
    lastModified: 0
  };
  const files = _test.extractClipboardImageFiles({
    items: [
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => pngRepresentation
      },
      {
        kind: "file",
        type: "image/tiff",
        getAsFile: () => tiffRepresentation
      }
    ],
    files: []
  });
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0], pngRepresentation);
}

{
  const files = _test.extractClipboardImageFiles({
    items: [],
    files: [
      { name: "diagram-a.png", type: "image/png", size: 1, lastModified: 10 },
      { name: "diagram-b.png", type: "image/png", size: 2, lastModified: 20 }
    ]
  });
  assert.strictEqual(files.length, 2);
}

runAsyncTests()
  .then(() => {
    console.log("clipboard image reference tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

async function runAsyncTests() {
  {
    const targetFolder = ".agent-dock-cache/pasted-images";
    let targetFolderExists = false;
    let createFolderCalls = 0;
    const createdFiles = new Map();
    const app = {
      vault: {
        adapter: {
          async exists(path) {
            return path === ".agent-dock-cache" || (path === targetFolder && targetFolderExists);
          }
        },
        getAbstractFileByPath() {
          return null;
        },
        async createFolder(path) {
          assert.strictEqual(path, targetFolder);
          createFolderCalls += 1;
          targetFolderExists = true;
          throw new Error("Folder already exists.");
        },
        async createBinary(path, buffer) {
          createdFiles.set(path, buffer);
        }
      }
    };
    const savedPath = await saveClipboardImageFile(app, {
      name: "",
      type: "image/png",
      arrayBuffer: async () => new ArrayBuffer(0)
    }, {
      cleanup: false,
      now: new Date(2026, 6, 7, 1, 2, 3, 4)
    });
    assert.strictEqual(createFolderCalls, 1);
    assert.strictEqual(savedPath, ".agent-dock-cache/pasted-images/pasted-image20260707-010203-004.png");
    assert.strictEqual(createdFiles.has(savedPath), true);
  }

  {
    const adapter = createAdapter({
      ".agent-dock-cache/pasted-images/old.png": {
        mtime: 100,
        content: true
      },
      ".agent-dock-cache/pasted-images/new.png": {
        mtime: 900,
        content: true
      },
      ".agent-dock-cache/pasted-images/readme.md": {
        mtime: 100,
        content: true
      }
    });
    const removed = await _test.cleanupExpiredPastedImages(
      { vault: { adapter } },
      { nowMs: 1000, maxAgeMs: 500 }
    );
    assert.strictEqual(removed, 1);
    assert.strictEqual(await adapter.exists(".agent-dock-cache/pasted-images/old.png"), false);
    assert.strictEqual(await adapter.exists(".agent-dock-cache/pasted-images/new.png"), true);
    assert.strictEqual(await adapter.exists(".agent-dock-cache/pasted-images/readme.md"), true);
  }

  {
    const adapter = createAdapter({
      ".agent-dock-cache/pasted-images/session.png": {
        mtime: 100,
        content: true
      },
      "Attachments/session.png": {
        mtime: 100,
        content: true
      }
    });
    const removed = await _test.deletePastedImagePaths(
      { vault: { adapter } },
      [
        ".agent-dock-cache/pasted-images/session.png",
        "Attachments/session.png"
      ]
    );
    assert.strictEqual(removed, 1);
    assert.strictEqual(await adapter.exists(".agent-dock-cache/pasted-images/session.png"), false);
    assert.strictEqual(await adapter.exists("Attachments/session.png"), true);
  }
}

function createAdapter(initialFiles) {
  const files = new Map(Object.entries(initialFiles));
  return {
    async exists(path) {
      if (files.has(path)) {
        return true;
      }
      const prefix = `${path.replace(/\/+$/, "")}/`;
      return Array.from(files.keys()).some((filePath) => filePath.startsWith(prefix));
    },
    async list(folder) {
      const normalizedFolder = folder.replace(/\/+$/, "");
      const prefix = `${normalizedFolder}/`;
      const listedFiles = [];
      const listedFolders = new Set();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) {
          continue;
        }
        const remainder = filePath.slice(prefix.length);
        if (!remainder.includes("/")) {
          listedFiles.push(filePath);
          continue;
        }
        listedFolders.add(`${prefix}${remainder.split("/")[0]}`);
      }
      return {
        files: listedFiles,
        folders: Array.from(listedFolders)
      };
    },
    async stat(path) {
      return files.get(path) || null;
    },
    async remove(path) {
      files.delete(path);
    }
  };
}
