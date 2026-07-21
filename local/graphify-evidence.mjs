import path from "node:path";

function normalizedSourcePath(repositoryPath, value) {
  let source = String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^["']|["']$/g, "");
  if (!source) return null;
  if (path.isAbsolute(source)) {
    source = path.relative(repositoryPath, source).replaceAll("\\", "/");
  }
  source = source.replace(/^\.\/+/, "");
  if (
    !source ||
    source === "." ||
    source === ".." ||
    source.startsWith("../") ||
    source.includes("/../") ||
    source.startsWith("agent_context/") ||
    source.startsWith("graphify-out/")
  ) {
    return null;
  }
  return source;
}

export function parseGraphifyEvidence(text, repositoryPath) {
  const nodes = [];
  const referencedPaths = [];
  const symbols = [];
  const seenPaths = new Set();
  const seenSymbols = new Set();
  const queryRanks = new Map();
  let currentQueryIndex = -1;
  let edgeCount = 0;

  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (line.startsWith("Query: ")) {
      currentQueryIndex += 1;
      continue;
    }
    if (line.startsWith("EDGE ")) {
      edgeCount += 1;
      continue;
    }
    const match = line.match(
      /^NODE\s+(.+?)\s+\[src=(.*?)\s+loc=(.*?)\s+community=(.*?)\]\s*$/,
    );
    if (!match) continue;
    const label = match[1].trim();
    const sourcePath = normalizedSourcePath(repositoryPath, match[2]);
    const location = match[3].trim();
    const rank = nodes.length;
    const queryIndex = Math.max(0, currentQueryIndex);
    const queryRank = queryRanks.get(queryIndex) ?? 0;
    queryRanks.set(queryIndex, queryRank + 1);
    nodes.push({
      label,
      sourcePath,
      location,
      rank,
      queryIndex,
      queryRank,
    });

    if (sourcePath && !seenPaths.has(sourcePath)) {
      seenPaths.add(sourcePath);
      referencedPaths.push(sourcePath);
    }
    const symbolKey = label.toLowerCase();
    if (label && !seenSymbols.has(symbolKey)) {
      seenSymbols.add(symbolKey);
      symbols.push(label);
    }
  }

  return {
    nodes,
    referencedPaths,
    symbols,
    edgeCount,
    queryCount: Math.max(1, currentQueryIndex + 1),
  };
}

export function parseGraphifyOperationEvidence(
  text,
  repositoryPath,
  operation,
  queryIndex = 0,
) {
  if (operation === "query") {
    const prefixed = String(text ?? "").startsWith("Query: ")
      ? String(text ?? "")
      : `Query: follow-up\n${String(text ?? "")}`;
    const evidence = parseGraphifyEvidence(prefixed, repositoryPath);
    return {
      ...evidence,
      nodes: evidence.nodes.map((node) => ({
        ...node,
        queryIndex: node.queryIndex + queryIndex,
      })),
    };
  }

  const nodes = [];
  const referencedPaths = [];
  const symbols = [];
  const seenPaths = new Set();
  const seenSymbols = new Set();
  const addNode = (label, sourceValue, location = "") => {
    const normalizedLabel = String(label ?? "").trim();
    const sourcePath = normalizedSourcePath(repositoryPath, sourceValue);
    if (!normalizedLabel && !sourcePath) return;
    const symbolKey = normalizedLabel.toLowerCase();
    nodes.push({
      label: normalizedLabel,
      sourcePath,
      location: String(location ?? "").trim(),
      rank: nodes.length,
      queryIndex,
      queryRank: nodes.length,
    });
    if (sourcePath && !seenPaths.has(sourcePath)) {
      seenPaths.add(sourcePath);
      referencedPaths.push(sourcePath);
    }
    if (normalizedLabel && !seenSymbols.has(symbolKey)) {
      seenSymbols.add(symbolKey);
      symbols.push(normalizedLabel);
    }
  };

  let explainLabel = "";
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (operation === "explain") {
      const nodeMatch = line.match(/^Node:\s+(.+?)\s*$/);
      if (nodeMatch) {
        explainLabel = nodeMatch[1].trim();
        continue;
      }
      const sourceMatch = line.match(/^\s*Source:\s+(.+?)(?:\s+(L\d+(?:-L?\d+)?))?\s*$/);
      if (sourceMatch) {
        addNode(explainLabel, sourceMatch[1], sourceMatch[2] ?? "");
        continue;
      }
      const connectionMatch = line.match(
        /^\s*(?:<--|-->)\s+(.+?)\s+\[[^\]]+\](?:\s+\[[^\]]+\])?\s*$/,
      );
      if (connectionMatch) addNode(connectionMatch[1], null);
      continue;
    }

    if (operation === "affected") {
      const match = line.match(
        /^\s*-\s+(.+?)\s+\[[^\]]+\]\s+(.+?)(?::(L\d+(?:-L?\d+)?))?\s*$/,
      );
      if (match) addNode(match[1], match[2], match[3] ?? "");
      continue;
    }

    if (operation === "path") {
      const pathLine = line.match(/^\s*(.+?)\s+--[^-]+-->\s+(.+?)\s*$/);
      if (pathLine) {
        addNode(pathLine[1], null);
        addNode(pathLine[2], null);
      }
    }
  }

  return {
    nodes,
    referencedPaths,
    symbols,
    edgeCount: operation === "path" ? Math.max(0, nodes.length - 1) : 0,
    queryCount: 1,
  };
}

export function mergeGraphifyEvidence(...values) {
  const nodes = [];
  const referencedPaths = [];
  const symbols = [];
  const seenNodes = new Set();
  const seenPaths = new Set();
  const seenSymbols = new Set();
  let edgeCount = 0;
  let queryCount = 0;

  for (const evidence of values.filter(Boolean)) {
    edgeCount += evidence.edgeCount ?? 0;
    queryCount += evidence.queryCount ?? 0;
    for (const node of evidence.nodes ?? []) {
      const key = `${node.queryIndex}:${node.label}:${node.sourcePath ?? ""}:${node.location ?? ""}`;
      if (seenNodes.has(key)) continue;
      seenNodes.add(key);
      nodes.push({ ...node, rank: nodes.length });
    }
    for (const sourcePath of evidence.referencedPaths ?? []) {
      if (seenPaths.has(sourcePath)) continue;
      seenPaths.add(sourcePath);
      referencedPaths.push(sourcePath);
    }
    for (const symbol of evidence.symbols ?? []) {
      const key = symbol.toLowerCase();
      if (seenSymbols.has(key)) continue;
      seenSymbols.add(key);
      symbols.push(symbol);
    }
  }

  return { nodes, referencedPaths, symbols, edgeCount, queryCount };
}
