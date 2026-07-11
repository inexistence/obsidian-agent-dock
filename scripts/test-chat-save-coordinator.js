const assert = require("assert");

const { ChatSaveCoordinator } = require("../src/storage/ChatSaveCoordinator");

async function testFlushWaitsForInFlightSaveAndLatestState() {
  const resolvers = [];
  const saved = [];
  const coordinator = new ChatSaveCoordinator(async (state) => {
    saved.push(state.id);
    await new Promise((resolve) => resolvers.push(resolve));
  });

  const first = coordinator.request({ id: "first" });
  coordinator.request({ id: "second" });
  let flushed = false;
  const flush = coordinator.flush().then(() => {
    flushed = true;
  });

  await Promise.resolve();
  assert.deepEqual(saved, ["first"]);
  assert.equal(flushed, false, "flush must wait for the active write");
  resolvers.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(saved, ["first", "second"], "the newest queued state should be saved next");
  assert.equal(flushed, false, "flush must also wait for the queued replacement write");
  resolvers.shift()();
  await first;
  await flush;
  assert.equal(flushed, true);
}

testFlushWaitsForInFlightSaveAndLatestState()
  .then(() => console.log("Chat save coordinator tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
