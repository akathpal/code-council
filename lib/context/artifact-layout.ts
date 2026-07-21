import type {
  AgentContextArtifactPlan,
  RepositorySymbol,
} from "./types";

function safeSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .toLowerCase();
}

export function symbolArtifactPath(symbol: RepositorySymbol) {
  const file = safeSegment(symbol.filePath).replace(/\.[^.]+$/, "");
  const name = safeSegment(symbol.name) || "anonymous";
  return `agent_context/symbols/${file}/${name}.md`;
}

export function planAgentContextArtifacts(
  symbols: RepositorySymbol[],
  previousHashes: Record<string, string> = {},
): AgentContextArtifactPlan[] {
  const repositoryArtifact: AgentContextArtifactPlan = {
    kind: "repository",
    outputPath: "agent_context/repository.md",
    sourcePaths: [...new Set(symbols.map((symbol) => symbol.filePath))].sort(),
    sourceHashes: [...new Set(symbols.map((symbol) => symbol.contentHash))].sort(),
    regenerate: symbols.some(
      (symbol) => previousHashes[symbol.filePath] !== symbol.contentHash,
    ),
  };

  const symbolArtifacts = symbols.map((symbol) => ({
    kind: "symbol" as const,
    outputPath: symbolArtifactPath(symbol),
    sourcePaths: [symbol.filePath],
    sourceHashes: [symbol.contentHash],
    regenerate: previousHashes[symbol.filePath] !== symbol.contentHash,
  }));

  return [repositoryArtifact, ...symbolArtifacts].sort((left, right) =>
    left.outputPath.localeCompare(right.outputPath),
  );
}

export const AGENT_CONTEXT_SYSTEM_FILES = [
  "agent_context/README.md",
  "agent_context/manifest.json",
  "agent_context/repository.md",
  "agent_context/modules/*.md",
  "agent_context/symbols/**/*.md",
  "agent_context/decisions/*.md",
  "agent_context/conventions/*.md",
  "agent_context/failures/*.md",
] as const;
