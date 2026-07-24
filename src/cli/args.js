function parseArgsTemplate(template, prompt, defaultArgs) {
  const tokens = [];
  const source = template || defaultArgs;
  let current = "";
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(char) && !quote) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens.map((token) => token.replace(/\{\{prompt\}\}/g, prompt));
}

function withOutputLastMessage(args, outputPath) {
  if (!args.includes("-o") && !args.includes("--output-last-message")) {
    const execIndex = args.indexOf("exec");
    if (execIndex >= 0) {
      return [
        ...args.slice(0, execIndex + 1),
        "--output-last-message",
        outputPath,
        ...args.slice(execIndex + 1)
      ];
    }
  }

  return args;
}

function withJsonOutput(args) {
  if (args.includes("--json")) {
    return args;
  }

  const execIndex = args.indexOf("exec");
  if (execIndex >= 0) {
    return [
      ...args.slice(0, execIndex + 1),
      "--json",
      ...args.slice(execIndex + 1)
    ];
  }

  return args;
}

function withModel(args, model) {
  const selectedModel = String(model || "").trim();
  if (!selectedModel) {
    return args;
  }

  const execIndex = args.indexOf("exec");
  if (execIndex >= 0) {
    return [
      ...args.slice(0, execIndex),
      "--model",
      selectedModel,
      ...args.slice(execIndex)
    ];
  }

  return ["--model", selectedModel, ...args];
}

module.exports = {
  parseArgsTemplate,
  withJsonOutput,
  withModel,
  withOutputLastMessage
};
