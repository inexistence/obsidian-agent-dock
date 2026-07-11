async function writeJsonAtomically(adapter, path, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (typeof adapter.rename !== "function") {
    await adapter.write(path, content);
    return;
  }
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const temporaryPath = `${path}.tmp-${suffix}`;
  const backupPath = `${path}.bak-${suffix}`;
  let movedExistingFile = false;
  await adapter.write(temporaryPath, content);
  try {
    if (await adapter.exists(path)) {
      await adapter.rename(path, backupPath);
      movedExistingFile = true;
    }
    await adapter.rename(temporaryPath, path);
  } catch (error) {
    try {
      if (await adapter.exists(temporaryPath)) {
        await adapter.remove(temporaryPath);
      }
    } catch {
      // Preserve the original replacement failure.
    }
    if (movedExistingFile) {
      try {
        if (!await adapter.exists(path) && await adapter.exists(backupPath)) {
          await adapter.rename(backupPath, path);
        }
      } catch {
        // Preserve the original replacement failure.
      }
    }
    throw error;
  }
  if (movedExistingFile) {
    try {
      await adapter.remove(backupPath);
    } catch {
      // The replacement is already committed; a leftover backup is safer than reporting a failed save.
    }
  }
}

module.exports = {
  writeJsonAtomically
};
