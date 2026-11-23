import assert from "node:assert/strict";
import test from "node:test";
import { fixtureResponse, scriptedBackend } from "../analyst/backends.mjs";
import { HOLD, SOURCES, makeCorpus, verifyReceipt } from "../analyst/semantic-data.mjs";
import { calibratePolicy, trainingViews } from "../analyst/semantic-policy.mjs";
import { pairedComparison, runSemantic } from "../analyst/semantic-replay.mjs";
import { chooseWithPi } from "../analyst/semantic-selector.mjs";

const toolCall = (source, id = "mock") => ({ type: "toolCall", name: "choose_source", id, arguments: { source } });

function mock(...content) {
  const { model } = scriptedBackend();
  return { model, stream: () => fixtureResponse(model, content) };
}

test("development and holdout use disjoint families, paired views and all eight sources", () => {
  const dev = makeCorpus("dev");
  const corpus = makeCorpus("test");
  const devFamilies = new Set(trainingViews(dev).map(({ family }) => family));
  const testViews = trainingViews(corpus);
  assert.equal(dev.packets.length, 72);
  assert.equal(corpus.packets.length, 144);
  assert.equal(testViews.length, 80);
  assert.equal(new Set(testViews.map(({ family }) => family)).size, 16);
  assert.ok(testViews.every(({ family }) => !devFamilies.has(family)));
  assert.deepEqual(new Set(testViews.map(({ source }) => source)), new Set([...SOURCES, HOLD]));
  const paired = new Map();
  for (const packet of corpus.packets) {
    const labels = paired.get(packet.viewKey) ?? new Set();
    labels.add(corpus.truth.get(packet.id).label);
    paired.set(packet.viewKey, labels);
  }
  assert.equal([...paired.values()].filter((labels) => labels.has("expected") && labels.has("suspicious")).length, 64);
  assert.equal([...paired.values()].filter((labels) => labels.size === 1 && labels.has("needs_review")).length, 16);
});

test("receipts are matched by binding; an unrelated positive or missing record cannot clear a case", () => {
  const corpus = makeCorpus("test");
  const packet = corpus.packets.find(({ id }) => corpus.truth.get(id).label === "suspicious");
  const gold = corpus.truth.get(packet.id).source;
  const unrelated = SOURCES.find((source) => source !== gold);
  packet.receipts.get(unrelated).conformance = true;
  assert.equal(verifyReceipt(packet, gold).verdict, "suspicious");
  assert.equal(verifyReceipt(packet, unrelated).verdict, "insufficient_evidence");
  packet.receipts.delete(gold);
  assert.equal(verifyReceipt(packet, gold).verdict, "insufficient_evidence");
  assert.equal(verifyReceipt(packet, HOLD).verdict, "insufficient_evidence");
});

test("Pi gets only contextual inputs and cannot fetch verifier contents or labels", async () => {
  const { view } = makeCorpus("dev").packets[0];
  const { model } = scriptedBackend();
  let requests = 0;
  const backend = { model, stream(model, context) {
    requests++;
    const payload = JSON.parse(context.messages.find(({ role }) => role === "user").content[0].text);
    assert.deepEqual(payload, view);
    return fixtureResponse(model, [toolCall("calendar")]);
  } };
  const result = await chooseWithPi({ ...view, privateBinding: "secret", gold: "approval" }, backend);
  assert.equal(requests, 1);
  assert.equal(result.source, "calendar");
});

test("Pi holds on timeout, unrecognized sources and multiple choices", async () => {
  const { view } = makeCorpus("dev").packets[0];
  for (const backend of [mock(toolCall("no-such-source")), mock(toolCall("backup"), toolCall("approval", "second"))]) {
    assert.deepEqual((await chooseWithPi(view, backend)).source, HOLD);
  }
  const backend = { model: scriptedBackend().model, stream: () => new Promise(() => {}) };
  const timeout = await chooseWithPi(view, backend, { timeoutMs: 10 });
  assert.equal(timeout.source, HOLD);
  assert.equal(timeout.reason, "timeout");
});

test("capture binding rejects missing, noisy or mismatched telemetry", () => {
  assert.throws(() => makeCorpus("test", { incomplete: true, cases: new Map() }), /complete fan-out/u);
  const cases = new Map(Array.from({ length: 144 }, (_, index) => [`case-${index + 1}`, { complete: true }]));
  const corpus = makeCorpus("test", { incomplete: false, cases });
  assert.equal(corpus.captureBound, true);
  assert.equal(new Set(corpus.packets.map(({ captureId }) => captureId)).size, 144);
  cases.get("case-1").complete = false;
  assert.throws(() => makeCorpus("test", { incomplete: false, cases }), /complete fan-out/u);
});

test("calibration and family-paired comparisons are reproducible", async () => {
  const dev = makeCorpus("dev");
  assert.deepEqual(calibratePolicy(dev).config, calibratePolicy(dev).config);
  const result = await runSemantic(makeCorpus("test"), dev, null);
  assert.equal(result.results.oracle.summary.correctSelections, 80);
  assert.equal(result.results.oracle.summary.retainedRoutine, 0);
  assert.equal(result.results["lexical-policy"].summary.retainedAnomalies, 64);
  const model = new Map([["sample", { family: "first", correct: true }]]);
  const baseline = new Map([["sample", { family: "first", correct: false }]]);
  assert.deepEqual(pairedComparison(model, baseline, 100).familyBootstrap95, [1, 1]);
});
