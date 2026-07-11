async function writeJsonAtomically(adapter, path, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (typeof adapter.rename !== "function") {
    await adapter.write(path, content);
    return;
  }
  const temporaryPath = `${path}.tmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await adapter.write(temporaryPath, content);
  try {
    await adapter.rename(temporaryPath, path);
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath);
      }
    } catch {
      // Preserve the original replacement failure.
    }
    throw error;
  }
}

module.exports = {
  writeJsonAtomically
};
