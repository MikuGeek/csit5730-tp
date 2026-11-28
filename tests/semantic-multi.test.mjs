import assert from "node:assert/strict";
import test from "node:test";
import { fixtureResponse, scriptedBackend } from "../analyst/backends.mjs";
import { makeMultiCorpus, verifyMultiReceipt } from "../analyst/semantic-multi-data.mjs";
import { runMultiSemantic } from "../analyst/semantic-multi-replay.mjs";
import { chooseSourcesWithPi } from "../analyst/semantic-selector.mjs";

const view = {
  rule: "fanout", distinct: 8, bulletin: "Check the destination pool and effective maintenance window.",
  handoff: "The approved pool and shifted window both applied.",
};
const batch = ["batch", ["network", "calendar"], view.bulletin, view.handoff];
const unknown = ["unknown", [], view.bulletin, "Neither choice was confirmed."];
const toolCall = (sources, id = "selection") =>
  ({ type: "toolCall", id, name: "choose_sources", arguments: { sources } });

function backend(...content) {
  const { model } = scriptedBackend();
  return { model, stream: (model) => fixtureResponse(model, content) };
}

test("Pi can choose a list of checks or explicitly request review in one call", async () => {
  const { model } = scriptedBackend();
  let requests = 0;
  const request = { model, stream(model, context) {
    requests++;
    const payload = JSON.parse(context.messages.find(({ role }) => role === "user").content[0].text);
    assert.deepEqual(payload, view);
    return fixtureResponse(model, [toolCall(["calendar", "network"])]);
  } };
  const choice = await chooseSourcesWithPi({ ...view, labels: ["network"], receipts: "private" }, request);
  assert.deepEqual(choice.sources, ["calendar", "network"]);
  assert.equal(choice.reason, "model_selection");
  assert.equal(requests, 1);
  const review = await chooseSourcesWithPi(view, backend(toolCall([])));
  assert.deepEqual(review.sources, []);
  assert.equal(review.reason, "model_selection");
});

test("duplicate or unknown choices and multiple calls cannot produce a plan", async () => {
  for (const response of [
    [toolCall(["network", "network"])],
    [toolCall(["network", "invented"])],
    [toolCall(["calendar"]), toolCall(["network"], "second")],
  ]) {
    const choice = await chooseSourcesWithPi(view, backend(...response));
    assert.deepEqual(choice.sources, []);
    assert.notEqual(choice.reason, "model_selection");
  }
});

test("an incomplete selection cannot clear a case whose other check would pass", () => {
  const [{ incidents }] = makeMultiCorpus([batch]);
  const [normal, anomaly] = incidents;
  assert.equal(verifyMultiReceipt(normal, ["network"]), "needs_review");
  assert.equal(verifyMultiReceipt(normal, ["network", "rollout"]), "needs_review");
  assert.equal(verifyMultiReceipt(normal, ["calendar", "network"]), "expected");
  assert.equal(verifyMultiReceipt(anomaly, ["network"]), "needs_review");
  assert.equal(verifyMultiReceipt(anomaly, ["calendar", "network"]), "suspicious");
  normal.receipts.set("calendar", anomaly.receipts.get("calendar"));
  assert.equal(verifyMultiReceipt(normal, ["calendar", "network"]), "needs_review");
});

test("scoring separates extra checks, missed checks, and missed suspicious verdicts", async () => {
  const { model } = scriptedBackend();
  let requests = 0;
  const request = { model, stream(model, context) {
    requests++;
    const payload = JSON.parse(context.messages.find(({ role }) => role === "user").content[0].text);
    const sources = payload.handoff === view.handoff ? ["rollout", "network"] : [];
    return fixtureResponse(model, [toolCall(sources)]);
  } };
  const result = await runMultiSemantic(makeMultiCorpus([batch, unknown]), request);
  assert.equal(requests, 2);
  const { summary } = result.results.pi;
  assert.equal(summary.exactMatchRate, 0.5);
  assert.equal(summary.meanExtraChecks, 0.5);
  assert.equal(summary.meanMissingChecks, 0.5);
  assert.equal(summary.verdictAccuracy, 1 / 3);
  assert.equal(summary.anomaliesSentToReview, 1);
  assert.equal(summary.anomaliesMarkedExpected, 0);
  assert.equal(result.results.all_sources.summary.exactMatchRate, 0);
  assert.equal(result.results.all_sources.summary.verdictAccuracy, 1);
});

test("scoring ignores selection order and does not credit failed abstentions", async () => {
  const matched = await runMultiSemantic(makeMultiCorpus([batch]), backend(toolCall(["calendar", "network"])));
  assert.equal(matched.results.pi.summary.exactMatchRate, 1);
  assert.equal(matched.results.pi.summary.verdictAccuracy, 1);
  const failed = await runMultiSemantic(makeMultiCorpus([unknown]), backend(toolCall(["invented"])));
  assert.equal(failed.results.pi.summary.exactMatchRate, 0);
  assert.equal(failed.results.pi.summary.failedDecisions, 1);
  assert.equal(failed.results.pi.rows[0].incidents[0].verdict, "needs_review");
});
