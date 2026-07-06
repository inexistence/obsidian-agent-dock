const assert = require("assert");

const {
  _test: fileLinkTest
} = require("../src/view/utils/fileLinks");

{
  const target = fileLinkTest.parseLocalFileLinkTarget("/Users/bigo/Vault/主页.md:10");
  assert.deepStrictEqual(target, {
    absolutePath: "/Users/bigo/Vault/主页.md",
    line: 10,
    column: null
  });
}

{
  const target = fileLinkTest.parseLocalFileLinkTarget("/Users/bigo/My%20Vault/Note.md:12:4");
  assert.deepStrictEqual(target, {
    absolutePath: "/Users/bigo/My Vault/Note.md",
    line: 12,
    column: 4
  });
}

{
  const target = fileLinkTest.parseLocalFileLinkTarget("file:///Users/bigo/My%20Vault/Note.md:7");
  assert.deepStrictEqual(target, {
    absolutePath: "/Users/bigo/My Vault/Note.md",
    line: 7,
    column: null
  });
}

{
  assert.strictEqual(
    fileLinkTest.absolutePathToVaultPath(
      "/Users/bigo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Work/主页.md",
      "/Users/bigo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Work"
    ),
    "主页.md"
  );
}

{
  assert.strictEqual(
    fileLinkTest.absolutePathToVaultPath(
      "/Users/bigo/Other/主页.md",
      "/Users/bigo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Work"
    ),
    ""
  );
}

{
  assert.strictEqual(fileLinkTest.parseLocalFileLinkTarget("https://example.com/a.md:10"), null);
  assert.strictEqual(fileLinkTest.parseLocalFileLinkTarget("主页.md:10"), null);
}

{
  assert.deepStrictEqual(fileLinkTest.parseMentionFileTarget("@周报/TODO.md"), {
    vaultPath: "周报/TODO.md",
    line: null,
    column: null
  });
  assert.deepStrictEqual(fileLinkTest.parseMentionFileTarget("@周报/TODO.md:12:4"), {
    vaultPath: "周报/TODO.md",
    line: 12,
    column: 4
  });
  assert.deepStrictEqual(fileLinkTest.parseMentionFileTarget("@\"周报/TODO file.md\":3"), {
    vaultPath: "周报/TODO file.md",
    line: 3,
    column: null
  });
  assert.deepStrictEqual(fileLinkTest.parseMentionFileTarget("@folder/v1..md"), {
    vaultPath: "folder/v1..md",
    line: null,
    column: null
  });
  assert.strictEqual(fileLinkTest.parseMentionFileTarget("@folder/../secret.md"), null);
}

{
  assert.strictEqual(
    fileLinkTest.normalizeLocalFileMarkdownLinks(
      "[主页.md](/Users/bigo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Work/主页.md:10)"
    ),
    "[主页.md](/Users/bigo/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/Work/%E4%B8%BB%E9%A1%B5.md:10)"
  );
}

{
  assert.strictEqual(
    fileLinkTest.normalizeLocalFileMarkdownLinks("[site](https://example.com/a b)"),
    "[site](https://example.com/a b)"
  );
}

{
  assert.strictEqual(
    fileLinkTest.normalizeLocalFileMarkdownLinks("[note](/Users/bigo/Vault/Note (draft).md:10)"),
    "[note](/Users/bigo/Vault/Note%20%28draft%29.md:10)"
  );
}

{
  assert.strictEqual(
    fileLinkTest.normalizeLocalFileMarkdownLinks("[note](/Users/bigo/Vault/Question #1?.md:3:2)"),
    "[note](/Users/bigo/Vault/Question%20%231%3F.md:3:2)"
  );
}

{
  assert.strictEqual(
    fileLinkTest.normalizeLocalFileMarkdownLinks(
      "[one](/Users/bigo/Vault/One.md:1) and [two](/Users/bigo/Vault/Two (final).md:2)"
    ),
    "[one](/Users/bigo/Vault/One.md:1) and [two](/Users/bigo/Vault/Two%20%28final%29.md:2)"
  );
}

{
  assert.deepStrictEqual(
    fileLinkTest.findBareLocalFileReferences(
      "/Users/bigo/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/Work/周报/2026/TODO.md:1"
    ),
    [
      {
        index: 0,
        text: "/Users/bigo/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/Work/周报/2026/TODO.md:1"
      }
    ]
  );
}

{
  assert.deepStrictEqual(
    fileLinkTest.findBareLocalFileReferences(
      "see /Users/bigo/Vault/One.md:1 and /Users/bigo/Vault/Two.md:2:3"
    ),
    [
      {
        index: 4,
        text: "/Users/bigo/Vault/One.md:1"
      },
      {
        index: 35,
        text: "/Users/bigo/Vault/Two.md:2:3"
      }
    ]
  );
}

{
  assert.deepStrictEqual(
    fileLinkTest.findBareLocalFileReferences("/Users/bigo/Vault/A.md:1."),
    [
      {
        index: 0,
        text: "/Users/bigo/Vault/A.md:1"
      }
    ]
  );
  assert.deepStrictEqual(
    fileLinkTest.findBareLocalFileReferences("/Users/bigo/Vault/A.md:1。"),
    [
      {
        index: 0,
        text: "/Users/bigo/Vault/A.md:1"
      }
    ]
  );
  assert.deepStrictEqual(
    fileLinkTest.findBareLocalFileReferences("see (/Users/bigo/Vault/A.md:1)"),
    [
      {
        index: 5,
        text: "/Users/bigo/Vault/A.md:1"
      }
    ]
  );
  assert.deepStrictEqual(
    fileLinkTest.findBareLocalFileReferences("见（/Users/bigo/Vault/A.md:1）"),
    [
      {
        index: 2,
        text: "/Users/bigo/Vault/A.md:1"
      }
    ]
  );
}

{
  assert.deepStrictEqual(fileLinkTest.findBareLocalFileReferences("https://example.com/a/b.md:1"), []);
  assert.deepStrictEqual(fileLinkTest.findBareLocalFileReferences("@周报/TODO.md:1"), []);
}

{
  assert.deepStrictEqual(
    fileLinkTest.findMentionFileReferences("打开 @周报/TODO.md 看看"),
    [
      {
        index: 3,
        text: "@周报/TODO.md",
        type: "mention"
      }
    ]
  );
  assert.deepStrictEqual(
    fileLinkTest.findMentionFileReferences("打开 @周报/TODO.md:1。"),
    [
      {
        index: 3,
        text: "@周报/TODO.md:1",
        type: "mention"
      }
    ]
  );
  assert.deepStrictEqual(
    fileLinkTest.findMentionFileReferences("打开 @\"周报/TODO file.md\":2"),
    [
      {
        index: 3,
        text: "@\"周报/TODO file.md\":2",
        type: "mention"
      }
    ]
  );
  assert.deepStrictEqual(
    fileLinkTest.findMentionFileReferences("打开 (@周报/TODO.md)"),
    [
      {
        index: 4,
        text: "@周报/TODO.md",
        type: "mention"
      }
    ]
  );
  assert.deepStrictEqual(
    fileLinkTest.findMentionFileReferences("打开（@周报/TODO.md）"),
    [
      {
        index: 3,
        text: "@周报/TODO.md",
        type: "mention"
      }
    ]
  );
}

{
  const reference = fileLinkTest.resolveLocalFileReference(
    {
      vault: {
        getAbstractFileByPath: () => null
      }
    },
    "/Users/bigo/Library/Mobile%20Documents/iCloud~md~obsidian/Documents/Work/周报/2026/TODO.md:1",
    "/Users/bigo/Library/Mobile Documents/iCloud~md~obsidian/Documents/Work"
  );
  assert.strictEqual(reference.file, null);
  assert.strictEqual(reference.vaultPath, "周报/2026/TODO.md");
  assert.strictEqual(reference.parsed.line, 1);
}

{
  const reference = fileLinkTest.resolveMentionFileReference(
    {
      vault: {
        getAbstractFileByPath: () => null
      }
    },
    "@周报/TODO.md:1"
  );
  assert.strictEqual(reference.file, null);
  assert.strictEqual(reference.vaultPath, "周报/TODO.md");
  assert.strictEqual(reference.parsed.line, 1);
}

{
  const file = { path: "周报/TODO.md", name: "TODO.md", extension: "md" };
  const reference = fileLinkTest.resolveMentionFileReference(
    {
      vault: {
        getAbstractFileByPath: (path) => (path === "周报/TODO.md" ? file : null),
        getAllLoadedFiles: () => [file]
      }
    },
    "@周报/TODO:1"
  );
  assert.strictEqual(reference.file, file);
  assert.strictEqual(reference.vaultPath, "周报/TODO.md");
  assert.strictEqual(reference.parsed.line, 1);
}

{
  const file = { path: "周报/TODO.md", name: "TODO.md", extension: "md" };
  const reference = fileLinkTest.resolveMentionFileReference(
    {
      vault: {
        getAbstractFileByPath: () => null,
        getAllLoadedFiles: () => [file]
      }
    },
    "@TODO.md"
  );
  assert.strictEqual(reference.file, file);
  assert.strictEqual(reference.vaultPath, "周报/TODO.md");
}

{
  let failedPath = "";
  let defaultPrevented = false;
  let propagationStopped = false;
  const anchor = {
    classList: {
      add: () => {}
    },
    setAttribute: () => {},
    addEventListener: (_eventName, listener) => {
      listener({
        preventDefault: () => {
          defaultPrevented = true;
        },
        stopPropagation: () => {
          propagationStopped = true;
        }
      });
    }
  };
  fileLinkTest.attachLocalFileLinkHandler(
    anchor,
    {},
    {
      file: null,
      parsed: { line: 1, column: null },
      vaultPath: "周报/2026/TODO.md"
    },
    {
      onOpenFailed: ({ vaultPath }) => {
        failedPath = vaultPath;
      }
    }
  );
  assert.strictEqual(defaultPrevented, true);
  assert.strictEqual(propagationStopped, true);
  assert.strictEqual(failedPath, "周报/2026/TODO.md");
}

console.log("file link tests passed");
