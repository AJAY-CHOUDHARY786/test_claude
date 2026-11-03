import { Link, useSearchParams } from "react-router";
import type { ReactNode } from "react";

export const Stars = ({ n }: { n: number }) => (
  <span className="pr-stars" role="img" aria-label={`${n} out of 5 stars`}>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>
);

export const fmtDate = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "–");

const TONES: Record<string, "success" | "warning" | "critical" | "info" | "neutral"> = {
  PUBLISHED: "success", PENDING: "warning", REJECTED: "critical", HIDDEN: "neutral",
  SENT: "success", QUEUED: "info", SENDING: "info", FAILED: "critical", CANCELLED: "neutral", SKIPPED: "neutral", COMPLETED: "success",
};
export const StatusBadge = ({ status }: { status: string }) => <s-badge tone={TONES[status] ?? "neutral"}>{status.charAt(0) + status.slice(1).toLowerCase()}</s-badge>;

export function Locked({ what, plan = "Advanced" }: { what: string; plan?: string }) {
  return (
    <s-banner tone="info" heading={`${what} is not part of your current plan`}>
      <s-paragraph>Upgrade to {plan} to use it. Your existing reviews and storefront widgets keep working.</s-paragraph>
      <s-button slot="secondary-actions" href="/app/billing">View plans</s-button>
    </s-banner>
  );
}

export function Pager({ total, page, limit }: { total: number; page: number; limit: number }) {
  const [params] = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / limit));
  const to = (p: number) => { const q = new URLSearchParams(params); q.set("page", String(p)); return `?${q.toString()}`; };
  return (
    <nav className="pr-pager" aria-label="Pagination">
      {page > 1 ? <Link className="pr-btn" to={to(page - 1)}>Previous</Link> : <span className="pr-btn" aria-disabled="true" style={{ opacity: 0.5 }}>Previous</span>}
      <span className="pr-muted">Page {page} of {pages} ({total} total)</span>
      {page < pages ? <Link className="pr-btn" to={to(page + 1)}>Next</Link> : <span className="pr-btn" aria-disabled="true" style={{ opacity: 0.5 }}>Next</span>}
    </nav>
  );
}

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="pr-field"><label>{label}</label>{children}{hint && <small>{hint}</small>}</div>
);

export const Notice = ({ data }: { data: { ok?: boolean; message?: string; error?: string } | undefined }) =>
  data?.message || data?.error ? <s-banner tone={data.error ? "critical" : "success"}>{data.error ?? data.message}</s-banner> : null;
