import { checkHealth } from "../lib/health.server";
import prisma from "../db.server";

// Public, unauthenticated, and returns no sensitive detail. Used by the host's health probe.
export const loader = async () => {
  const result = await checkHealth({
    pingDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
  });
  return Response.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
};
