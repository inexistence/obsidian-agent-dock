const assert = require("assert");

const { writeJsonAtomically } = require("../src/storage/atomicJson");

async function testAtomicJsonReplacesOnlyAfterTemporaryWrite() {
  const files = new Map([["state.json", "old"]]);
  const operations = [];
  const adapter = {
    async write(path, content) {
      operations.push(["write", path]);
      files.set(path, content);
    },
    async rename(from, to) {
      operations.push(["rename", from, to]);
      if (files.has(to)) {
        throw new Error(`Destination already exists: ${to}`);
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    async exists(path) {
      return files.has(path);
    },
    async remove(path) {
      files.delete(path);
    }
  };

  await writeJsonAtomically(adapter, "state.json", { version: 2 });
  assert.equal(JSON.parse(files.get("state.json")).version, 2);
  assert.equal(operations[0][0], "write");
  assert.notEqual(operations[0][1], "state.json", "the destination must not be overwritten directly");
  assert.equal(operations[1][0], "rename");
  assert.equal(operations[1][1], "state.json", "the old destination should move out of the way first");
  assert.equal(operations[2][0], "rename");
  assert.equal(operations[2][2], "state.json", "the completed temporary file should become the destination");
  assert.equal(Array.from(files.keys()).some((path) => path.includes(".bak-")), false, "the backup should be removed after replacement");
}

async function testAtomicJsonRestoresOriginalWhenReplacementFails() {
  const files = new Map([["state.json", "old"]]);
  const adapter = {
    async write(path, content) {
      files.set(path, content);
    },
    async rename(from, to) {
      if (from.includes(".tmp-") && to === "state.json") {
        throw new Error("replacement failed");
      }
      if (files.has(to)) {
        throw new Error(`Destination already exists: ${to}`);
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    async exists(path) {
      return files.has(path);
    },
    async remove(path) {
      files.delete(path);
    }
  };

  await assert.rejects(() => writeJsonAtomically(adapter, "state.json", { version: 2 }), /replacement failed/);
  assert.equal(files.get("state.json"), "old", "a failed replacement must restore the original file");
  assert.equal(Array.from(files.keys()).some((path) => path.includes(".tmp-") || path.includes(".bak-")), false);
}

testAtomicJsonReplacesOnlyAfterTemporaryWrite()
  .then(testAtomicJsonRestoresOriginalWhenReplacementFails)
  .then(() => console.log("Atomic JSON tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
