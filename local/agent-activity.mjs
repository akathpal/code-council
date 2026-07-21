function cleanText(value, maximum = 2_000) {
  return String(value ?? "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim()
    .slice(0, maximum);
}

function activityStatus(value, completed = false) {
  if (completed) {
    return value === "failed" || value === "error" ? "failed" : "complete";
  }
  return value === "completed" ? "complete" : value === "failed" ? "failed" : "running";
}

function codexItemActivity(message) {
  const item = message.params?.item;
  if (!item?.id || !["item/started", "item/completed"].includes(message.method)) {
    return [];
  }
  const completed = message.method === "item/completed";
  const base = {
    id: `codex:${item.id}`,
    agent: "codex",
    status: activityStatus(item.status, completed),
  };

  if (item.type === "commandExecution") {
    return [{
      ...base,
      kind: "command",
      label: completed ? "Command finished" : "Running command",
      detail: cleanText(item.command),
      output: completed ? cleanText(item.aggregatedOutput, 4_000) : "",
      exitCode: item.exitCode ?? null,
    }];
  }
  if (item.type === "fileChange") {
    const paths = (item.changes ?? [])
      .map((change) => change.path ?? change.filePath)
      .filter(Boolean);
    return [{
      ...base,
      kind: "file",
      label: completed ? "Files updated" : "Updating files",
      detail: cleanText(paths.join(", ") || item.path || "Working tree"),
    }];
  }
  if (item.type === "read") {
    return [{
      ...base,
      kind: "read",
      label: completed ? "File inspected" : "Reading file",
      detail: cleanText(item.path ?? item.filePath ?? item.name),
    }];
  }
  if (item.type === "listFiles") {
    return [{
      ...base,
      kind: "search",
      label: completed ? "Files listed" : "Listing files",
      detail: cleanText(item.path ?? item.directory ?? "Repository"),
    }];
  }
  if (item.type === "reasoning") {
    return [{
      ...base,
      kind: "thinking",
      label: completed ? "Analysis complete" : "Analyzing repository",
      detail: "",
    }];
  }
  return [];
}

function claudeToolDetail(block) {
  const input = block.input ?? {};
  if (block.name === "Bash") return cleanText(input.command);
  if (block.name === "Read") return cleanText(input.file_path ?? input.path);
  if (block.name === "Glob") return cleanText(input.pattern);
  if (block.name === "Grep") {
    return cleanText(
      [input.pattern, input.path].filter(Boolean).join(" · "),
    );
  }
  if (["Edit", "Write"].includes(block.name)) {
    return cleanText(input.file_path ?? input.path);
  }
  return cleanText(JSON.stringify(input), 1_000);
}

function claudeActivity(message) {
  if (message.type !== "assistant") return [];
  return (message.message?.content ?? [])
    .filter((block) => block.type === "tool_use" && block.id)
    .map((block) => ({
      id: `claude:${block.id}`,
      agent: "claude",
      kind:
        block.name === "Bash"
          ? "command"
          : ["Edit", "Write"].includes(block.name)
            ? "file"
            : block.name === "Read"
              ? "read"
              : "search",
      label:
        block.name === "Bash"
          ? "Running command"
          : block.name === "Read"
            ? "Reading file"
            : block.name === "Glob" || block.name === "Grep"
              ? "Searching repository"
              : `${block.name} tool`,
      detail: claudeToolDetail(block),
      status: "running",
    }));
}

export function agentActivityFromLine(agent, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return [];
  }
  if (agent === "codex") return codexItemActivity(message);
  if (agent === "claude") return claudeActivity(message);
  return [];
}

export function mergeAgentActivity(current, updates, at = new Date().toISOString()) {
  const entries = [...(current ?? [])];
  for (const update of updates) {
    const index = entries.findIndex((entry) => entry.id === update.id);
    const previous = index >= 0 ? entries[index] : null;
    const next = {
      ...previous,
      ...update,
      startedAt: previous?.startedAt ?? at,
      updatedAt: at,
      endedAt: update.status === "running" ? null : at,
    };
    if (index >= 0) entries[index] = next;
    else entries.push(next);
  }
  return entries.slice(-80);
}
