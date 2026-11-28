import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { liveBackend } from "./backends.mjs";
import { SOURCES } from "./semantic-data.mjs";
import { makeMultiCorpus, verifyMultiReceipt } from "./semantic-multi-data.mjs";
import { chooseSourcesWithPi } from "./semantic-selector.mjs";

function score(document, { sources, reason }) {
  const { id, requiredSources } = document;
  const extraChecks = sources.filter((source) => !requiredSources.includes(source));
  const missingChecks = requiredSources.filter((source) => !sources.includes(source));
  const failed = reason !== "model_selection" && reason !== "all_sources";
  return {
    id, requiredSources, selectedSources: sources, selectionReason: reason, failed,
    extraChecks, missingChecks, exactMatch: !failed && !extraChecks.length && !missingChecks.length,
    incidents: document.incidents.map((incident) => ({
      expectedVerdict: incident.expectedVerdict, verdict: verifyMultiReceipt(incident, sources),
    })),
  };
}

function summarize(rows) {
  const incidents = rows.flatMap(({ incidents }) => incidents);
  const anomalies = incidents.filter(({ expectedVerdict }) => expectedVerdict === "suspicious");
  const exactMatches = rows.filter(({ exactMatch }) => exactMatch).length;
  const explicitAnomalies = anomalies.filter(({ verdict }) => verdict === "suspicious").length;
  return {
    documents: rows.length,
    exactMatches,
    exactMatchRate: exactMatches / rows.length,
    meanExtraChecks: rows.reduce((total, { extraChecks }) => total + extraChecks.length, 0) / rows.length,
    meanMissingChecks: rows.reduce((total, { missingChecks }) => total + missingChecks.length, 0) / rows.length,
    documentsMissingChecks: rows.filter(({ missingChecks }) => missingChecks.length).length,
    failedDecisions: rows.filter(({ failed }) => failed).length,
    incidents: incidents.length,
    verdictAccuracy: incidents.filter(({ expectedVerdict, verdict }) => verdict === expectedVerdict).length / incidents.length,
    anomalies: anomalies.length,
    explicitAnomalies,
    missedSuspiciousVerdicts: anomalies.length - explicitAnomalies,
    anomaliesSentToReview: anomalies.filter(({ verdict }) => verdict === "needs_review").length,
    anomaliesMarkedExpected: anomalies.filter(({ verdict }) => verdict === "expected").length,
  };
}

function report(rows) {
  const groups = Object.groupBy(rows, ({ requiredSources }) => requiredSources.length);
  const byRequiredChecks = Object.fromEntries(Object.entries(groups).map(([count, cases]) => [count, summarize(cases)]));
  return { summary: summarize(rows), byRequiredChecks, rows };
}

export async function runMultiSemantic(corpus, backend = null) {
  const allSources = { sources: SOURCES, reason: "all_sources" };
  const results = { all_sources: report(corpus.map((document) => score(document, allSources))) };
  if (backend) {
    const rows = [];
    for (const document of corpus) {
      rows.push(score(document, await chooseSourcesWithPi(document.view, backend)));
    }
    results.pi = report(rows);
  }
  return { model: backend?.model.id ?? null, results };
}

async function main() {
  const { values } = parseArgs({ options: { live: { type: "boolean", default: false } } });
  const result = await runMultiSemantic(makeMultiCorpus(), values.live ? liveBackend() : null);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(({ message }) => {
    console.error(message);
    process.exitCode = 1;
  });
}
