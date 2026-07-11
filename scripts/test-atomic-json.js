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
}

testAtomicJsonReplacesOnlyAfterTemporaryWrite()
  .then(() => console.log("Atomic JSON tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
