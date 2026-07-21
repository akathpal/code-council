import {
  computeConfidence,
  decideEscalation,
} from "../../../lib/council/confidence";
import type { ConfidenceSignals } from "../../../lib/council/types";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      signals?: ConfidenceSignals;
      targetConfidence?: number;
      currentTier?: "single_agent" | "peer_critique" | "full_council";
    };

    if (!payload.signals) {
      return Response.json({ error: "signals are required" }, { status: 400 });
    }

    return Response.json({
      confidence: computeConfidence(payload.signals),
      decision: decideEscalation(
        payload.signals,
        payload.targetConfidence ?? 0.82,
        payload.currentTier,
      ),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 400 },
    );
  }
}

