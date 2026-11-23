import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { liveBackend, scriptedBackend } from "./backends.mjs";
import { FIXED, policyRouter, sanitizeCase } from "./evidence.mjs";
import { triage } from "./triage.mjs";

const RULES = ["fanout", "canary", "unexpected_exec"];
const MODES = ["rules", ...Object.keys(FIXED), "policy-router", "adaptive"];

export function parseCapture(input) {
  const lines = input.trim().split("\n");
  if (lines.some((line) => line.length > 24_000)) throw new Error("capture record exceeds size limit");
  const records = lines.map((line) => JSON.parse(line));
  if (records[0]?.kind !== "session" || records[0].version !== 1 || records.at(-1)?.kind !== "summary") {
    throw new Error("expected one version-1 capture with a final summary");
  }
  const summary = records.at(-1);
  const alerts = new Map();
  const cases = new Map();
  let incomplete = summary.clean !== true || summary.drops !== 0 || summary.uncorrelated !== 0;
  for (const record of records.slice(1, -1)) {
    if (record.kind === "alert" && /^case-[1-9][0-9]{0,11}$/u.test(record.id) && RULES.includes(record.rule)) {
      if (alerts.has(record.id)) throw new Error("duplicate alert id");
      alerts.set(record.id, record.rule);
    } else if (record.kind === "case") {
      const incident = sanitizeCase(record);
      if (alerts.get(incident.id) !== "fanout" || cases.has(incident.id)) throw new Error("unlinked or duplicate case");
      cases.set(incident.id, incident);
    } else if (record.kind === "capture_gap") {
      incomplete = true;
    } else {
      throw new Error("unexpected capture record");
    }
  }
  for (const rule of RULES) {
    const count = [...alerts.values()].filter((value) => value === rule).length;
    if (count !== summary.alerts?.[rule]) throw new Error("capture alert count mismatch");
    if (rule === "fanout" && count !== cases.size) throw new Error("missing fanout case");
  }
  if (incomplete) for (const incident of cases.values()) incident.complete = false;
  return { alerts, cases, incomplete };
}

function targets(capture, labels) {
  const known = new Map();
  for (const row of labels?.cases ?? []) {
    if (!capture.cases.has(row.id) || known.has(row.id) || !["expected", "suspicious"].includes(row.label)) {
      throw new Error("invalid or duplicate ground-truth row");
    }
    known.set(row.id, row.label);
  }
  if (labels && known.size !== capture.cases.size) throw new Error("ground truth must cover each fanout case");
  return [...capture.cases.values()].map((incident) => ({ incident, label: known.get(incident.id) ?? null }));
}

export function metrics(rows) {
  const positives = rows.filter(({ label }) => label === "suspicious");
  const negatives = rows.filter(({ label }) => label === "expected");
  const latencies = rows.map(({ latencyMs }) => latencyMs).sort((first, second) => first - second);
  return {
    cases: rows.length,
    positives: positives.length,
    negatives: negatives.length,
    retainedRecall: positives.length ? positives.filter(({ verdict }) => verdict !== "expected").length / positives.length : null,
    explicitSuspiciousRecall: positives.length ? positives.filter(({ verdict }) => verdict === "suspicious").length / positives.length : null,
    falseAlertsRetained: negatives.length ? negatives.filter(({ verdict }) => verdict !== "expected").length : null,
    explicitFalseSuspicious: negatives.length ? negatives.filter(({ verdict }) => verdict === "suspicious").length : null,
    abstentions: rows.filter(({ verdict }) => verdict === "insufficient_evidence").length,
    meanRequests: rows.length ? rows.reduce((sum, { requests }) => sum + requests.length, 0) / rows.length : null,
    p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : null,
  };
}

export async function replay(capture, labels, backend, concurrency = 1) {
  const tasks = targets(capture, labels).flatMap((target) => MODES.map((mode) => ({ ...target, mode })));
  const results = new Array(tasks.length);
  let cursor = 0;
  async function run() {
    while (cursor < tasks.length) {
      const index = cursor++;
      const { incident, label, mode } = tasks[index];
      const start = performance.now();
      let verdict;
      if (mode === "rules") {
        verdict = { verdict: "suspicious", citations: [], requests: [], turns: 0, reason: "local_rule" };
      } else if (mode === "policy-router") {
        verdict = { ...policyRouter(incident), turns: 0 };
      } else {
        verdict = await triage(incident, mode, backend);
      }
      results[index] = { id: incident.id, label, mode, latencyMs: performance.now() - start, ...verdict };
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  const summaries = Object.fromEntries(MODES.map((mode) => [mode, metrics(results.filter((row) => row.mode === mode))]));
  const controls = Object.keys(FIXED);
  return {
    backend: backend.model.id,
    captureIncomplete: capture.incomplete,
    localOnlyAlerts: [...capture.alerts].filter(([, rule]) => rule !== "fanout").map(([id, rule]) => ({ id, rule })),
    summaries,
    matchedRecall: Object.fromEntries(["rules", ...controls, "policy-router"].map((mode) => {
      const baseline = summaries[mode];
      const adaptive = summaries.adaptive;
      const matched = baseline.retainedRecall !== null && baseline.retainedRecall === adaptive.retainedRecall;
      return [mode, { matched, falseAlertsRetainedReduction: matched && baseline.falseAlertsRetained !== null
        ? baseline.falseAlertsRetained - adaptive.falseAlertsRetained : null }];
    })),
    cases: results,
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    capture: { type: "string" }, labels: { type: "string" }, backend: { type: "string", default: "scripted" },
    concurrency: { type: "string", default: "1" },
  } });
  if (!values.capture || !["scripted", "live"].includes(values.backend)) {
    throw new Error("usage: npm run replay -- --capture FILE [--labels FILE] [--backend scripted|live] [--concurrency N]");
  }
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("concurrency must be 1–8");
  const capture = parseCapture(await readFile(values.capture, "utf8"));
  const labels = values.labels ? JSON.parse(await readFile(values.labels, "utf8")) : null;
  const backend = values.backend === "live" ? liveBackend() : scriptedBackend();
  console.log(JSON.stringify(await replay(capture, labels, backend, concurrency), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(({ message }) => {
    console.error(message);
    process.exitCode = 1;
  });
}
