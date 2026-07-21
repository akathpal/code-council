import { cliInstallers } from "../../../lib/onboarding/installers";
import {
  GRAPHIFY_MINIMUM_VERSION,
  GRAPHIFY_PACKAGE,
} from "../../../lib/context/graphify";

export async function GET() {
  return Response.json({
    runnerProtocolVersion: "1.0",
    required: [cliInstallers.codex, cliInstallers.claude],
    managedContextEngine: {
      id: "graphify",
      package: GRAPHIFY_PACKAGE,
      minimumVersion: GRAPHIFY_MINIMUM_VERSION,
      role: "local deterministic code graph",
    },
    note: "Detection and installation execute only in the local runner after user confirmation.",
  });
}
