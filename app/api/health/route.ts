import { adapterRegistry } from "../../../lib/adapters/registry";

export async function GET() {
  return Response.json({
    ok: true,
    product: "code-council",
    protocol: "claude-propose-codex-critique-claude-revise-codex-execute",
    adapters: adapterRegistry.map(
      ({ id, displayName, kind, trustBoundary }) => ({
        id,
        displayName,
        kind,
        trustBoundary,
      }),
    ),
  });
}
