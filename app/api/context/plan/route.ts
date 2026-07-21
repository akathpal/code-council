import { buildContextPack } from "../../../../lib/context/planner";
import type { ContextCandidate } from "../../../../lib/context/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      candidates?: ContextCandidate[];
      budgetTokens?: number;
      baselineTokens?: number;
    };

    if (!Array.isArray(payload.candidates)) {
      return Response.json(
        { error: "candidates must be an array" },
        { status: 400 },
      );
    }

    const pack = buildContextPack(
      payload.candidates,
      payload.budgetTokens ?? 12_000,
      payload.baselineTokens,
    );
    return Response.json({ pack });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 },
    );
  }
}

