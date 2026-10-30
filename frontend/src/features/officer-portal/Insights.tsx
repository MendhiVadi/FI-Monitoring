import { useEffect, useId, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../shared/firebase/functions";
import contract from "../../shared/contracts/dispute.json";
import { signOutStaff, useStaffSession } from "../auth/staffSession";
import { Spinner } from "../auth/Spinner";
import { STATUS_ORDER, TERMINAL_STATUSES, statusLabel } from "../tickets/ticketStatus";
import { PortalHeader } from "./PortalHeader";
import { formatMs } from "./presentation";
import { styles } from "./portal.styles";
import "./portal.css";

// getInsights (viewer+), cached server-side for 10 minutes (vault/Wave-2-Spec.md §4).
interface InsightsData {
  generatedAt: number;
  byStatus: Record<string, number>;
  byCategory: { label: string; count: number }[];
  byState: { state: string; count: number }[];
  byCaseType: { citizen_vs_government: number; person_vs_person: number; unknown: number };
  ageing: { d0_7: number; d8_30: number; d31_90: number; d90p: number };
  weeklyIntake: { weekStart: number; count: number }[];
  overdue: { acknowledge: number; resolve: number };
  documents: { uploaded: number; flagged: number; reviewed: number };
}
interface Row { label: string; count: number }
// Created once, with the same bounded wait as the other staff calls.
const requestInsights = httpsCallable<Record<string, never>, InsightsData>(functions, "getInsights", { timeout: 30_000 });
const weekLabel = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const { acknowledgeDays, resolveDays } = contract.serviceTargets;
const CASE_TYPES: Record<string, { label: string }> = contract.documents.caseTypes;

// States with fewer than 3 cases fold into "Other", so small counts cannot point at one case.
function foldStates(rows: { state: string; count: number }[]): Row[] {
  let other = 0;
  const kept = rows.filter(row => { if (row.state === "Other" || num(row.count) < 3) { other += num(row.count); return false; } return true; });
  return [...kept.map(row => ({ label: row.state, count: num(row.count) })).sort((a, b) => b.count - a.count), ...(other ? [{ label: "Other", count: other }] : [])];
}
const caseTypeLabel = (id: string, fallback: string) => (Object.hasOwn(CASE_TYPES, id) && CASE_TYPES[id].label) || fallback;

// One series per chart: the row header and the number carry the data; the bar
// only shows scale, so it is hidden from assistive technology. `shares` is off
// where the rows overlap (flagged documents are also uploaded ones).
function BarTable({ title, rows, rowHeader = "Group", note, empty = "No cases recorded yet.", shares = true }: {
  title: string; rows: Row[]; rowHeader?: string; note?: string; empty?: string; shares?: boolean;
}) {
  const id = useId();
  const max = Math.max(1, ...rows.map(row => row.count)), sum = rows.reduce((total, row) => total + row.count, 0);
  return (
    <section className="insights-card" style={styles.modalSectionCard} aria-labelledby={id}>
      <h2 id={id} className="insights-card-title">{title}</h2>
      {note && <p className="insights-card-note">{note}</p>}
      {sum === 0 ? <p style={styles.fieldHint}>{empty}</p> : (
        <table className="insights-bars" aria-labelledby={id}>
          <thead className="sr-only"><tr><th scope="col">{rowHeader}</th><th scope="col">{shares ? "Share" : "Scale"}</th><th scope="col">Count</th></tr></thead>
          <tbody>
            {rows.map(row => {
              const share = Math.round((row.count / sum) * 100);
              return (
                <tr key={row.label} title={shares ? `${row.label}: ${row.count} (${share}%)` : `${row.label}: ${row.count}`}>
                  <th scope="row">{row.label}</th>
                  <td className="insights-bar-cell">
                    {shares && <span className="sr-only">{share}%</span>}
                    <span aria-hidden="true" className="insights-bar" style={{ width: `${row.count ? Math.max(2, (row.count / max) * 100) : 0}%` }} />
                  </td>
                  <td className="insights-count">{row.count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Change over time reads best as columns on a shared baseline. The columns are
// one image with a spoken summary; the exact figures sit in the table view.
function WeeklyIntake({ weeks }: { weeks: { weekStart: number; count: number }[] }) {
  const id = useId();
  const rows = weeks.filter(week => typeof week.weekStart === "number").map(week => ({ label: weekLabel.format(new Date(week.weekStart)), count: num(week.count) }));
  const max = Math.max(1, ...rows.map(row => row.count)), sum = rows.reduce((total, row) => total + row.count, 0);
  const peak = rows.reduce<Row | null>((best, row) => !best || row.count > best.count ? row : best, null);
  const latest = rows.at(-1);
  const summary = [`${plural(sum, "new case")} in the last ${rows.length} weeks`,
    latest && `${latest.count} in the week of ${latest.label}`,
    peak && peak.count > 0 && `busiest week ${peak.label} with ${peak.count}`].filter(Boolean).join("; ") + ".";
  return (
    <section className="insights-card insights-card--wide" style={styles.modalSectionCard} aria-labelledby={id}>
      <h2 id={id} className="insights-card-title">New cases per week</h2>
      <p className="insights-card-note">Weeks start Monday 00:00 IST; the last column is the current week so far.</p>
      {rows.length === 0 ? <p style={styles.fieldHint}>No cases recorded yet.</p> : (
        <>
          <div className="insights-columns" role="img" aria-label={summary}>
            {rows.map(row => (
              <div key={row.label} className="insights-week" title={`Week of ${row.label}: ${row.count}`}>
                {/* Direct labels on the current and the busiest week only. */}
                <span className="insights-week-value">{row === latest || (row === peak && row.count > 0) ? row.count : ""}</span>
                <span className="insights-week-track">
                  <span className="insights-week-bar" style={{ height: `${row.count ? Math.max(2, (row.count / max) * 100) : 0}%` }} />
                </span>
                <span className="insights-week-label">{row.label}</span>
              </div>
            ))}
          </div>
          <details className="insights-table-view">
            <summary>Table view</summary>
            <table>
              <thead><tr><th scope="col">Week of</th><th scope="col">New cases</th></tr></thead>
              <tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.count}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

export function Insights() {
  const { email } = useStaffSession();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; data: InsightsData | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    requestInsights({}).then(({ data }) => { if (live) setResult({ attempt, data, error: null }); }, err => {
      if (!live) return;
      const code = (err as { code?: string })?.code;
      const error = code === "functions/unauthenticated" || code === "functions/permission-denied"
        ? "Your session ended or this account cannot see insights. Sign in again."
        : "Insights could not be loaded. No figures are shown because the request failed. Check your connection and retry.";
      setResult(previous => ({ attempt, data: previous?.data ?? null, error }));
    });
    return () => { live = false; };
  }, [attempt]);
  const loading = result?.attempt !== attempt;
  const data = result?.data ?? null, error = loading ? null : result?.error ?? null;
  const byStatus = data?.byStatus ?? {};
  const total = Object.values(byStatus).reduce((sum, value) => sum + num(value), 0);
  const notClosed = Object.entries(byStatus).reduce((sum, [id, value]) => TERMINAL_STATUSES.has(id) ? sum : sum + num(value), 0);
  const overdueAck = num(data?.overdue?.acknowledge), overdueResolve = num(data?.overdue?.resolve);
  const docs = { uploaded: num(data?.documents?.uploaded), flagged: num(data?.documents?.flagged), reviewed: num(data?.documents?.reviewed) };
  const tiles = [
    { key: "total", label: "All cases", value: total, sub: "Every report in the registry", accent: "rgba(255,255,255,0.25)" },
    { key: "open", label: "Not closed", value: notClosed, sub: "Open, investigating or inspection scheduled", accent: "#3b82f6" },
    { key: "overdue", label: "Overdue", value: overdueAck + overdueResolve,
      sub: `${overdueAck} not acknowledged in ${acknowledgeDays} days · ${overdueResolve} not resolved in ${resolveDays} days`, accent: "#f97316" },
    { key: "flagged", label: "Documents flagged", value: docs.flagged, sub: `Of ${docs.uploaded} uploaded · ${docs.reviewed} reviewed by staff`, accent: "#f59e0b" },
  ];

  return (
    <div className="officer-portal" style={styles.portalContainer}>
      <PortalHeader officerEmail={email} onLogout={() => void signOutStaff()} confirmLeave={() => true} current="insights" />
      <main style={styles.portalMain}>
        <div className="portal-registry-head">
          <div>
            <h1 style={{ fontSize: "1.4rem", margin: 0, color: "var(--text)" }}>Insights</h1>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              {data ? `Figures as of ${formatMs(data.generatedAt)}; refreshed at most every 10 minutes. No personal data is shown.`
                : "Registry-wide counts. No personal data is shown."}
            </p>
          </div>
          <button type="button" className="portal-btn" style={styles.modalSecondaryBtn} disabled={loading} onClick={() => setAttempt(n => n + 1)}>
            {loading ? <><Spinner /> Loading…</> : "Refresh"}
          </button>
        </div>
        {error && <div role="alert" style={{ ...styles.fieldError, marginBottom: "1rem" }}><span>{error}</span></div>}
        {loading && !data && <p role="status" style={styles.fieldHint}>Loading insights…</p>}
        {data && (
          <>
            <div className="portal-metrics" role="group" aria-label="Headline figures">
              {tiles.map(tile => (
                <div key={tile.key} className="portal-metric portal-metric--static" style={{ borderLeftColor: tile.accent }}>
                  <span className="portal-metric-label">{tile.label}</span>
                  <span className="portal-metric-value" style={{ color: "var(--text)" }}>{tile.value}</span>
                  <span className="portal-metric-sub">{tile.sub}</span>
                </div>
              ))}
            </div>
            <div className="insights-grid">
              <WeeklyIntake weeks={data.weeklyIntake ?? []} />
              <BarTable title="Cases by status" rowHeader="Status"
                rows={STATUS_ORDER.map(id => ({ label: statusLabel(id, true), count: num(byStatus[id]) }))} />
              <BarTable title="Open cases by age" rowHeader="Age" note="Cases not yet closed, by days since filing."
                rows={[{ label: "0–7 days", count: num(data.ageing?.d0_7) }, { label: "8–30 days", count: num(data.ageing?.d8_30) },
                  { label: "31–90 days", count: num(data.ageing?.d31_90) }, { label: "Over 90 days", count: num(data.ageing?.d90p) }]} />
              <BarTable title="Cases by category" rowHeader="Category"
                rows={(data.byCategory ?? []).map(row => ({ label: row.label, count: num(row.count) })).sort((a, b) => b.count - a.count)} />
              <BarTable title="Cases by state" rowHeader="State" note="States with fewer than 3 cases are counted under Other."
                rows={foldStates(data.byState ?? [])} />
              <BarTable title="Cases by type" rowHeader="Case type" rows={[
                { label: caseTypeLabel("citizen_vs_government", "Citizen vs government"), count: num(data.byCaseType?.citizen_vs_government) },
                { label: caseTypeLabel("person_vs_person", "Person vs person"), count: num(data.byCaseType?.person_vs_person) },
                { label: "Not recorded", count: num(data.byCaseType?.unknown) }]} />
              <BarTable title="Documents" rowHeader="Documents" note="Counts of uploaded files, not cases." empty="No documents uploaded yet." shares={false} rows={[
                { label: "Uploaded", count: docs.uploaded }, { label: "Flagged by screening", count: docs.flagged },
                { label: "Reviewed by staff", count: docs.reviewed }]} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
