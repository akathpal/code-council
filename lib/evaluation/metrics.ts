export interface EvaluationRecord {
  strategy: string;
  success: boolean;
  testsPassed: number;
  testsTotal: number;
  humanApproved: boolean | null;
  reviewComments: number;
  costUsd: number;
  latencyMs: number;
  confidence: number;
}

export interface EvaluationSummary {
  runs: number;
  successRate: number;
  testPassRate: number;
  humanApprovalRate: number | null;
  commentsPerRun: number;
  averageCostUsd: number;
  costPerSuccessUsd: number | null;
  medianLatencyMs: number;
  brierScore: number;
}

function average(values: number[]) {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

export function summarizeEvaluations(
  records: EvaluationRecord[],
): EvaluationSummary {
  const successful = records.filter((record) => record.success);
  const reviewed = records.filter((record) => record.humanApproved !== null);
  const testsPassed = records.reduce(
    (sum, record) => sum + record.testsPassed,
    0,
  );
  const testsTotal = records.reduce(
    (sum, record) => sum + record.testsTotal,
    0,
  );
  const totalCost = records.reduce((sum, record) => sum + record.costUsd, 0);

  return {
    runs: records.length,
    successRate:
      records.length === 0 ? 0 : successful.length / records.length,
    testPassRate: testsTotal === 0 ? 0 : testsPassed / testsTotal,
    humanApprovalRate:
      reviewed.length === 0
        ? null
        : reviewed.filter((record) => record.humanApproved).length /
          reviewed.length,
    commentsPerRun: average(records.map((record) => record.reviewComments)),
    averageCostUsd: average(records.map((record) => record.costUsd)),
    costPerSuccessUsd:
      successful.length === 0 ? null : totalCost / successful.length,
    medianLatencyMs: median(records.map((record) => record.latencyMs)),
    brierScore: average(
      records.map((record) => {
        const outcome = record.success ? 1 : 0;
        return (record.confidence - outcome) ** 2;
      }),
    ),
  };
}

