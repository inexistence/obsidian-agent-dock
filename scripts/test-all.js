const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const node = process.execPath;

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function collectJsFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsFiles(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(absolute);
    }
  }

  return files;
}

function runStep(label, command, args) {
  const start = Date.now();
  console.log(`\n> ${label}`);
  console.log(`  ${[command, ...args].join(" ")}`);

  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${label} failed with exit code ${process.exitCode}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ok] ${label} (${elapsed}s)`);
}

function runSyntaxChecks(files) {
  for (const file of files) {
    runStep(`syntax: ${relative(file)}`, node, ["--check", relative(file)]);
  }
}

function main() {
  const testScripts = fs.readdirSync(path.join(root, "scripts"))
    .filter((name) => /^test-.*\.js$/.test(name))
    .filter((name) => name !== path.basename(__filename))
    .sort()
    .map((name) => path.join("scripts", name));

  const syntaxFiles = [
    ...collectJsFiles(path.join(root, "src")),
    ...collectJsFiles(path.join(root, "scripts"))
  ].sort((a, b) => relative(a).localeCompare(relative(b)));

  runStep("build main.js", node, ["scripts/build-main.js"]);
  runStep("syntax: main.js", node, ["--check", "main.js"]);

  for (const script of testScripts) {
    runStep(script, node, [script]);
  }

  runSyntaxChecks(syntaxFiles);

  console.log("\nAll checks passed.");
}

try {
  main();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(process.exitCode || 1);
}
