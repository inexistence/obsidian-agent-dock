const assert = require("assert");

const {
  codexJsonEventToUpdates,
  updateLatestAgentMessageOutput
} = require("../src/agents/codex/jsonEvents");

const translate = (key, params = {}) => {
  const messages = {
    "codex.started": "{label} 已开始",
    "codex.completed": "{label} 已完成",
    "codex.failed": "{label} 已失败",
    "codex.exitCode": "退出码：{code}"
  };
  return String(messages[key] || key).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => (
    params[name] === undefined || params[name] === null ? match : String(params[name])
  ));
};

{
  const [update] = codexJsonEventToUpdates({
    type: "item.started",
    item: {
      type: "command_execution",
      command: "/bin/zsh -lc 'git status'",
      exit_code: null
    }
  }, translate);

  assert.equal(update.kind, "tool");
  assert.equal(update.toolType, "command");
  assert(update.title.includes("已开始"), "started command should keep started title");
  assert(!update.summary.includes("{code}"), "null exit code should not leak a placeholder");
  assert(!update.summary.includes("退出码"), "started command should omit missing exit code");
}

{
  const [update] = codexJsonEventToUpdates({
    type: "item.completed",
    item: {
      type: "command_execution",
      command: "/bin/zsh -lc 'git status'",
      exit_code: 0
    }
  }, translate);

  assert.equal(update.kind, "tool");
  assert.equal(update.toolType, "command");
  assert(update.title.includes("已完成"), "completed command should keep completed title");
  assert(update.summary.includes("退出码：0"), "completed command should show exit code");
}

{
  const [update] = codexJsonEventToUpdates({
    type: "item.completed",
    item: {
      type: "web_search",
      query: "Obsidian plugin"
    }
  }, translate);

  assert.equal(update.kind, "tool");
  assert.equal(update.toolType, "web_search");
}

{
  const [update] = codexJsonEventToUpdates({
    type: "item.completed",
    item: {
      type: "agent_message",
      phase: "commentary",
      text: "我先核对本地记录。"
    }
  }, translate);

  assert.equal(update.kind, "reasoning", "commentary should be rendered as progress, not answer content");
  assert.equal(update.detail, "我先核对本地记录。");
  assert.equal(update.agentMessagePhase, "commentary");
  assert.equal(update.discrete, true, "complete commentary messages should remain discrete progress items");
}

{
  const [update] = codexJsonEventToUpdates({
    type: "item.completed",
    item: {
      type: "agent_message",
      phase: "final_answer",
      text: "这是最终回答。"
    }
  }, translate);

  assert.equal(update.kind, "content", "only the final answer should become answer content");
  assert.equal(update.text, "这是最终回答。");
  assert.equal(update.agentMessagePhase, "final_answer");
}

{
  const [update] = codexJsonEventToUpdates({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: "Legacy Codex output"
    }
  }, translate);

  assert.equal(update.kind, "content", "agent messages without a phase should remain backward compatible");
  assert.equal(update.agentMessagePhase, "");
}

{
  const intermediate = {
    kind: "content",
    text: "我重新核对一下优先级。",
    agentMessagePhase: "final_answer"
  };
  const finalAnswer = {
    kind: "content",
    text: "今天最适合做一个不影响明天封板的小闭环。",
    agentMessagePhase: "final_answer"
  };
  let output = updateLatestAgentMessageOutput("", intermediate);
  output = updateLatestAgentMessageOutput(output, finalAnswer);
  assert.equal(
    output,
    finalAnswer.text,
    "complete Codex agent messages must replace the final output instead of concatenating"
  );
}
