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

const { ChatStorage } = require("../src/storage/ChatStorage");

async function testPruneDeletesAssociatedPastedImages() {
  const removedFiles = [];
  const deletedImagePaths = [];
  const adapter = {
    async exists() {
      return true;
    },
    async list(path) {
      assert.strictEqual(path, ".obsidian/plugins/agent-dock/sessions");
      return {
        files: [
          ".obsidian/plugins/agent-dock/sessions/keep.json",
          ".obsidian/plugins/agent-dock/sessions/delete.json"
        ],
        folders: []
      };
    },
    async read(path) {
      assert.strictEqual(path, ".obsidian/plugins/agent-dock/sessions/delete.json");
      return JSON.stringify({
        pastedImagePaths: [
          ".agent-dock-cache/pasted-images/a.png",
          ".agent-dock-cache/pasted-images/a.png",
          "",
          "Attachments/not-cache.png"
        ]
      });
    },
    async remove(path) {
      removedFiles.push(path);
    }
  };
  const storage = new ChatStorage({
    manifest: {
      id: "agent-dock",
      dir: ".obsidian/plugins/agent-dock"
    },
    app: {
      vault: {
        adapter
      }
    },
    async deletePastedImageCacheFiles(paths) {
      deletedImagePaths.push(paths);
    }
  });

  await storage.pruneSessionFiles(new Set(["keep.json"]));

  assert.deepStrictEqual(removedFiles, [".obsidian/plugins/agent-dock/sessions/delete.json"]);
  assert.deepStrictEqual(deletedImagePaths, [[
    ".agent-dock-cache/pasted-images/a.png",
    "Attachments/not-cache.png"
  ]]);
}

testPruneDeletesAssociatedPastedImages()
  .then(() => {
    console.log("chat storage tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
