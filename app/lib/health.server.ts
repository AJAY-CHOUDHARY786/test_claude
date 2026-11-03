/** Health check logic. The database ping is injected so it can be tested without a database. */
export interface HealthResult {
  status: "ok" | "degraded";
  checks: { database: "ok" | "fail" };
  timestamp: string;
}

export interface HealthDeps {
  pingDatabase: () => Promise<void>;
  now?: () => Date;
  timeoutMs?: number;
}

export async function checkHealth(deps: HealthDeps): Promise<HealthResult> {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let database: "ok" | "fail" = "ok";
  try {
    await Promise.race([
      deps.pingDatabase(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } catch {
    // Details are deliberately not returned to callers.
    database = "fail";
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { status: database === "ok" ? "ok" : "degraded", checks: { database }, timestamp: now().toISOString() };
}
