import { useEffect } from "react";
import { data, Form, useActionData, useFetcher, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server.ts";
import { denyIfLacking, requireMerchant, writeAudit } from "../services/shop.server.ts";
import { exportRows } from "../services/reviews.server.ts";
import { CsvError, MAX_CSV_BYTES, parseCsv, toCsv, validateImportRows } from "../lib/csv.ts";
import { hasFeature } from "../lib/plans.ts";
import { Notice, fmtDate } from "../components/ui.tsx";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop, ent } = await requireMerchant(request);
  const jobs = await prisma.importJob.findMany({ where: { shopId: shop.id, status: { not: "PREVIEW" } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, totalRows: true, importedRows: true, skippedRows: true, createdAt: true } });
  return { jobs, canImport: hasFeature(ent, "csv.import"), canExport: hasFeature(ent, "csv.export") };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, ent, actor } = await requireMerchant(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "export") {
    const denied = denyIfLacking(ent, "csv.export");
    if (denied) return denied;
    await writeAudit(shop.id, actor, "reviews.exported");
    return { csv: toCsv(await exportRows(shop.id)), filename: `reviews-${new Date().toISOString().slice(0, 10)}.csv` };
  }

  const denied = denyIfLacking(ent, "csv.import");
  if (denied) return denied;

  if (intent === "preview") {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return data({ error: "Choose a CSV file first." }, { status: 422 });
    if (file.size > MAX_CSV_BYTES) return data({ error: "That file is larger than 5 MB. Split it into smaller files." }, { status: 422 });
    let result;
    try { result = validateImportRows(parseCsv(await file.text()), new Date()); }
    catch (e) { return data({ error: e instanceof CsvError ? e.message : "That file could not be read as CSV." }, { status: 422 }); }
    if (!result.valid.length) return { error: "No importable rows were found.", problems: result.errors.slice(0, 50) };
    const job = await prisma.importJob.create({ data: { shopId: shop.id, status: "PREVIEW", totalRows: result.total, errorCount: result.errors.length, skippedRows: result.duplicatesInFile, errorReport: JSON.parse(JSON.stringify(result.errors.slice(0, 200))), rows: JSON.parse(JSON.stringify(result.valid)) } });
    return { preview: { jobId: job.id, valid: result.valid.length, total: result.total, duplicates: result.duplicatesInFile, problems: result.errors.slice(0, 50), problemCount: result.errors.length } };
  }

  if (intent === "confirm") {
    const job = await prisma.importJob.findFirst({ where: { id: String(form.get("jobId") ?? ""), shopId: shop.id, status: "PREVIEW" } });
    if (!job) return data({ error: "That preview has expired. Upload the file again." }, { status: 404 });
    await prisma.$transaction([
      prisma.importJob.updateMany({ where: { id: job.id, shopId: shop.id }, data: { status: "QUEUED" } }),
      prisma.job.create({ data: { shopId: shop.id, type: "IMPORT", payload: { importJobId: job.id } } }),
    ]);
    await writeAudit(shop.id, actor, "reviews.import_started", job.id);
    return { message: "Import started. It runs in the background and appears in the list below." };
  }
  return data({ error: "Unknown action" }, { status: 400 });
};

type Result = { message?: string; error?: string; problems?: { line: number; message: string }[]; preview?: { jobId: string; valid: number; total: number; duplicates: number; problems: { line: number; message: string }[]; problemCount: number } };

export default function ImportExport() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as Result | undefined;
  const busy = useNavigation().state !== "idle";
  const exporter = useFetcher<{ csv?: string; filename?: string; error?: string }>();
  useEffect(() => {
    const out = exporter.data;
    if (!out?.csv) return;
    const url = URL.createObjectURL(new Blob([out.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = out.filename ?? "reviews.csv"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }, [exporter.data]);
  const p = result?.preview;
  return (
    <s-page heading="Import and export">
      <Notice data={result} />
      <s-section heading="Import reviews from a CSV file">
        {!d.canImport ? <s-banner tone="info">Importing needs an active plan.</s-banner> : (<>
          <s-paragraph>Required columns: product_id, rating, body. Optional: title, reviewer_name, status (published, pending or hidden), created_at (a date), reply. Use a file exported from your previous review app, or one you made yourself. Nothing is saved until you confirm the preview.</s-paragraph>
          <Form method="post" encType="multipart/form-data" className="pr-row">
            <input type="file" name="file" accept=".csv,text/csv" required />
            <button className="pr-btn primary" name="intent" value="preview" disabled={busy}>Check file</button>
          </Form>
          {result?.problems && <ProblemTable rows={result.problems} />}
          {p && (
            <div style={{ marginTop: 16 }}>
              <s-banner tone={p.problemCount ? "warning" : "success"} heading={`${p.valid} of ${p.total} rows are ready to import`}>
                {p.problemCount > 0 && <s-paragraph>{p.problemCount} row(s) have problems and will be skipped. {p.duplicates > 0 ? `${p.duplicates} duplicate row(s) in the file are ignored. ` : ""}Reviews you already imported before are skipped automatically.</s-paragraph>}
              </s-banner>
              {p.problems.length > 0 && <ProblemTable rows={p.problems} />}
              <Form method="post"><input type="hidden" name="jobId" value={p.jobId} /><button className="pr-btn primary" name="intent" value="confirm" disabled={busy}>Import {p.valid} reviews</button></Form>
            </div>)}
        </>)}
      </s-section>
      <s-section heading="Recent imports">
        {d.jobs.length === 0 ? <s-paragraph>No imports yet.</s-paragraph> : (
          <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Date</th><th>Status</th><th>Rows</th><th>Imported</th><th>Skipped</th></tr></thead>
            <tbody>{d.jobs.map((j) => <tr key={j.id}><td>{fmtDate(j.createdAt)}</td><td>{j.status.charAt(0) + j.status.slice(1).toLowerCase()}</td><td>{j.totalRows}</td><td>{j.importedRows}</td><td>{j.skippedRows}</td></tr>)}</tbody></table></div>)}
      </s-section>
      <s-section heading="Export reviews">
        <s-paragraph>Download all your reviews as a CSV file. Cells that start with =, +, - or @ are prefixed with an apostrophe so spreadsheet programs cannot run them as formulas.</s-paragraph>
        <exporter.Form method="post"><button className="pr-btn primary" name="intent" value="export" disabled={!d.canExport || exporter.state !== "idle"}>{exporter.state !== "idle" ? "Preparing…" : "Download CSV"}</button></exporter.Form>
        {exporter.data?.error && <s-banner tone="critical">{exporter.data.error}</s-banner>}
      </s-section>
    </s-page>
  );
}

function ProblemTable({ rows }: { rows: { line: number; message: string }[] }) {
  return <div className="pr-table-wrap"><table className="pr-table"><thead><tr><th>Line</th><th>Problem</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i}><td>{r.line}</td><td>{r.message}</td></tr>)}</tbody></table></div>;
}
