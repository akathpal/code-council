import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const repositories = sqliteTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    installationId: text("installation_id"),
    cloneUrl: text("clone_url"),
    lastIndexedSha: text("last_indexed_sha"),
    memoryStatus: text("memory_status").notNull().default("pending"),
    ...timestamps,
  },
  (table) => [
    index("repositories_owner_name_idx").on(table.owner, table.name),
    index("repositories_memory_status_idx").on(table.memoryStatus),
  ],
);

export const agentConnections = sqliteTable(
  "agent_connections",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    adapterKind: text("adapter_kind").notNull(),
    endpoint: text("endpoint"),
    capabilitiesJson: text("capabilities_json").notNull().default("{}"),
    status: text("status").notNull().default("disconnected"),
    lastHealthcheckAt: text("last_healthcheck_at"),
    ...timestamps,
  },
  (table) => [
    index("agent_connections_provider_idx").on(table.provider),
    index("agent_connections_status_idx").on(table.status),
  ],
);

export const memoryArtifacts = sqliteTable(
  "memory_artifacts",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    path: text("path"),
    symbol: text("symbol"),
    contentHash: text("content_hash").notNull(),
    sourceCommitSha: text("source_commit_sha").notNull(),
    summary: text("summary").notNull(),
    evidenceJson: text("evidence_json").notNull().default("[]"),
    confidence: real("confidence").notNull().default(0.5),
    generator: text("generator").notNull().default("deterministic"),
    generatorVersion: text("generator_version").notNull().default("v1"),
    supersedesId: text("supersedes_id"),
    validFrom: text("valid_from").notNull().default(sql`CURRENT_TIMESTAMP`),
    validTo: text("valid_to"),
    retrievalCount: integer("retrieval_count").notNull().default(0),
    successfulUseCount: integer("successful_use_count").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("memory_repository_kind_idx").on(table.repositoryId, table.kind),
    index("memory_repository_hash_idx").on(
      table.repositoryId,
      table.contentHash,
    ),
    index("memory_repository_valid_idx").on(
      table.repositoryId,
      table.validTo,
    ),
  ],
);

export const councilDefinitions = sqliteTable("council_definitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  protocolJson: text("protocol_json").notNull(),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  ...timestamps,
});

export const councilRuns = sqliteTable(
  "council_runs",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    definitionId: text("definition_id")
      .notNull()
      .references(() => councilDefinitions.id),
    task: text("task").notNull(),
    taskClass: text("task_class").notNull().default("general"),
    riskTier: text("risk_tier").notNull().default("routine"),
    baseCommitSha: text("base_commit_sha").notNull(),
    contextPackId: text("context_pack_id"),
    strategy: text("strategy").notNull(),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("context"),
    confidence: real("confidence"),
    verdict: text("verdict"),
    deliverableRef: text("deliverable_ref"),
    costMicros: integer("cost_micros").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (table) => [
    index("runs_repository_created_idx").on(
      table.repositoryId,
      table.createdAt,
    ),
    index("runs_status_idx").on(table.status),
    index("runs_strategy_idx").on(table.strategy),
  ],
);

export const councilEvents = sqliteTable(
  "council_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => councilRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    stage: text("stage").notNull(),
    eventType: text("event_type").notNull(),
    agentId: text("agent_id"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("events_run_sequence_idx").on(table.runId, table.sequence),
    index("events_run_stage_idx").on(table.runId, table.stage),
  ],
);

export const evaluations = sqliteTable(
  "evaluations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => councilRuns.id, { onDelete: "cascade" }),
    success: integer("success", { mode: "boolean" }),
    testsPassed: integer("tests_passed").notNull().default(0),
    testsTotal: integer("tests_total").notNull().default(0),
    staticChecksPassed: integer("static_checks_passed").notNull().default(0),
    staticChecksTotal: integer("static_checks_total").notNull().default(0),
    humanApproved: integer("human_approved", { mode: "boolean" }),
    reviewComments: integer("review_comments").notNull().default(0),
    reviewDebtScore: integer("review_debt_score").notNull().default(0),
    confidence: real("confidence"),
    costMicros: integer("cost_micros").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("evaluations_run_idx").on(table.runId),
    index("evaluations_success_idx").on(table.success),
  ],
);

export const humanFeedback = sqliteTable(
  "human_feedback",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => councilRuns.id, { onDelete: "cascade" }),
    githubReviewId: text("github_review_id"),
    verdict: text("verdict").notNull(),
    severity: text("severity").notNull().default("medium"),
    comment: text("comment").notNull(),
    filePath: text("file_path"),
    line: integer("line"),
    authorHash: text("author_hash"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("feedback_run_idx").on(table.runId),
    index("feedback_severity_idx").on(table.severity),
  ],
);
