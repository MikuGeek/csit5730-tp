import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { liveBackend } from "./backends.mjs";
import { parseCapture } from "./replay.mjs";
import { HOLD, makeCorpus, verifyReceipt } from "./semantic-data.mjs";
import { calibratePolicy } from "./semantic-policy.mjs";
import { chooseWithPi } from "./semantic-selector.mjs";

const FAILURES = new Set(["timeout", "provider_failure", "invalid_selection", "invalid_context"]);

function percentile(values, quantile) {
  return values.length ? [...values].sort((first, second) => first - second)[Math.ceil(values.length * quantile) - 1] : null;
}

function describe(rows, decisions, hasSelector) {
  const positive = rows.filter((row) => row.label === "suspicious");
  const negative = rows.filter((row) => row.label === "expected");
  const ambiguous = rows.filter((row) => row.label === "needs_review");
  return {
    cases: rows.length,
    uniqueViews: decisions.size,
    correctSelections: hasSelector ? [...decisions.values()].filter(({ correct }) => correct).length : null,
    correctUnambiguousSelections: hasSelector ? [...decisions.values()].filter(({ correct, source }) => correct && source !== HOLD).length : null,
    unambiguousViews: [...decisions.values()].filter(({ source }) => source !== HOLD).length,
    retainedAnomalies: positive.filter(({ verdict }) => verdict !== "expected").length,
    explicitAnomalies: positive.filter(({ verdict }) => verdict === "suspicious").length,
    anomalies: positive.length,
    retainedRoutine: negative.filter(({ verdict }) => verdict !== "expected").length,
    routine: negative.length,
    ambiguous: ambiguous.length,
    ambiguousHeldWithoutRead: hasSelector ? ambiguous.filter(({ selection }) => selection === HOLD).length : null,
    ambiguousRetained: ambiguous.filter(({ verdict }) => verdict !== "expected").length,
    meanTotalReads: rows.reduce((sum, { reads }) => sum + reads, 0) / rows.length,
    p95SelectMs: hasSelector ? percentile([...decisions.values()].map(({ latencyMs }) => latencyMs), 0.95) : null,
    failedDecisions: [...decisions.values()].filter(({ reason }) => FAILURES.has(reason)).length,
  };
}

export function pairedComparison(model, baseline, draws = 10_000) {
  const families = new Map();
  for (const [key, entry] of model) {
    const control = baseline.get(key);
    if (!control || control.family !== entry.family) throw new Error("cannot pair different corpora");
    const group = families.get(entry.family) ?? { wins: 0, losses: 0, views: 0 };
    group.wins += Number(entry.correct && !control.correct);
    group.losses += Number(!entry.correct && control.correct);
    group.views++;
    families.set(entry.family, group);
  }
  const groups = [...families.values()];
  const sum = (field) => groups.reduce((value, group) => value + group[field], 0);
  let seed = 5730;
  const samples = Array.from({ length: draws }, () => {
    let delta = 0;
    let views = 0;
    for (const ignored of groups) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const group = groups[Math.floor(seed / 2 ** 32 * groups.length)];
      delta += group.wins - group.losses;
      views += group.views;
    }
    return delta / views;
  });
  return {
    families: groups.length, wins: sum("wins"), losses: sum("losses"), views: sum("views"),
    accuracyDelta: (sum("wins") - sum("losses")) / sum("views"),
    familyBootstrap95: [percentile(samples, 0.025), percentile(samples, 0.975)],
  };
}

export async function runSemantic(corpus, dev, backend, concurrency = 4) {
  const policy = calibratePolicy(dev);
  const views = [...new Map(corpus.packets.map((packet) => [packet.viewKey, packet])).values()];
  const modes = ["rules", "fixed", "lexical-policy", ...(backend ? ["pi-semantic"] : []), "oracle"];
  const results = {};
  const viewResults = {};
  for (const mode of modes) {
    const decisions = new Map();
    let cursor = 0;
    async function worker() {
      while (cursor < views.length) {
        const { id, viewKey, view } = views[cursor++];
        const start = performance.now();
        const recorded = mode === "pi-semantic" ? await chooseWithPi(view, backend) : {
          source: mode === "lexical-policy" ? policy.choose(view) : mode === "fixed" ? policy.fallback :
            mode === "oracle" ? corpus.truth.get(id).source : HOLD,
          reason: mode,
          latencyMs: performance.now() - start,
        };
        decisions.set(viewKey, recorded);
      }
    }
    await Promise.all(Array.from({ length: mode === "pi-semantic" ? concurrency : 1 }, worker));
    const rows = corpus.packets.map((packet) => {
      const gold = corpus.truth.get(packet.id);
      const decision = decisions.get(packet.viewKey);
      const verdict = mode === "rules" ? { verdict: "suspicious", reason: "local_rule" } : verifyReceipt(packet, decision.source);
      return { id: packet.id, captureId: packet.captureId, ...gold, selection: decision.source, selectionReason: decision.reason,
        reads: mode === "rules" ? 0 : 1 + Number(decision.source !== HOLD), ...verdict };
    });
    viewResults[mode] = new Map(views.map(({ viewKey, id }) => {
      const gold = corpus.truth.get(id);
      const decision = decisions.get(viewKey);
      return [viewKey, { ...gold, ...decision, source: gold.source, selection: decision.source,
        correct: decision.source === gold.source && !FAILURES.has(decision.reason) }];
    }));
    results[mode] = { summary: describe(rows, viewResults[mode], mode !== "rules"), rows };
  }
  const comparison = backend ? pairedComparison(viewResults["pi-semantic"], viewResults["lexical-policy"]) : null;
  return { fingerprint: corpus.fingerprint, calibrationFingerprint: dev.fingerprint, captureBound: corpus.captureBound,
    model: backend?.model.id ?? null, calibration: policy.config, fixedSource: policy.fallback, comparison, results };
}

async function main() {
  const { values } = parseArgs({ options: {
    split: { type: "string", default: "test" }, capture: { type: "string" }, live: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
  } });
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("concurrency must be 1–8");
  const capture = values.capture ? parseCapture(await readFile(values.capture, "utf8")) : null;
  if (values.live && values.split === "test" && !capture) throw new Error("for a live holdout run attach the measured VPS capture");
  const corpus = makeCorpus(values.split, capture);
  const dev = makeCorpus("dev");
  const backend = values.live ? liveBackend() : null;
  console.log(JSON.stringify(await runSemantic(corpus, dev, backend, concurrency), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(({ message }) => {
    console.error(message);
    process.exitCode = 1;
  });
}
