const assert = require("assert");

const { normalizePluginData, normalizeSettings } = require("../src/settings");

const settings = normalizeSettings({
  mode: "fullAccess",
  memoryEnabled: true,
  affectEnabled: true,
  personaPreset: "legacy",
  interactiveArgs: "--legacy",
  showToneCapsule: false,
  cursorPermissionPolicy: "allow-always"
});

assert.equal(settings.mode, "readOnly");
assert.equal(settings.showToneCapsule, false);
assert.equal(settings.cursorPermissionPolicy, "allow-always");
assert.equal(Object.hasOwn(settings, "memoryEnabled"), false);
assert.equal(Object.hasOwn(settings, "affectEnabled"), false);
assert.equal(Object.hasOwn(settings, "personaPreset"), false);
assert.equal(Object.hasOwn(settings, "interactiveArgs"), false);

assert.equal(
  normalizeSettings({ mode: "workspaceWrite" }).mode,
  "readOnly",
  "workspace write must not survive loading without an explicit acknowledgment"
);
assert.equal(
  normalizeSettings({ mode: "workspaceWrite", workspaceWriteAcknowledged: true }).mode,
  "workspaceWrite"
);

const data = normalizePluginData({
  schemaVersion: 3,
  settings: { agentId: "cursor" },
  chatState: { activeSessionId: "session-1", sessionIndex: [] },
  affectState: { working: { tone: "legacy" } }
});
assert.deepEqual(Object.keys(data).sort(), ["chatState", "schemaVersion", "settings"]);
assert.equal(data.settings.agentId, "cursor");
assert.equal(data.chatState.activeSessionId, "session-1");

const migratedV2 = normalizePluginData({
  schemaVersion: 2,
  settings: {
    agentId: "cursor",
    workingDirectory: "/tmp/project",
    persistChatHistory: false
  },
  chatState: {
    activeSessionId: "legacy-session",
    sessionIndex: [{
      id: "legacy-session",
      title: "Legacy chat",
      createdAt: 1000,
      updatedAt: 2000
    }]
  },
  affectState: { working: { tone: "legacy" } }
});
assert.equal(migratedV2.schemaVersion, 3);
assert.equal(migratedV2.settings.agentId, "cursor");
assert.equal(migratedV2.settings.workingDirectory, "/tmp/project");
assert.equal(migratedV2.settings.persistChatHistory, false);
assert.equal(migratedV2.chatState.activeSessionId, "legacy-session");
assert.equal(migratedV2.chatState.sessionIndex[0].title, "Legacy chat");
assert.equal(Object.hasOwn(migratedV2, "affectState"), false);

console.log("settings tests passed");
