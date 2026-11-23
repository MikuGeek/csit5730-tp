import assert from "node:assert/strict";
import test from "node:test";
import { fixtureResponse, scriptedBackend } from "../analyst/backends.mjs";
import { parseCapture, replay } from "../analyst/replay.mjs";
import { triage } from "../analyst/triage.mjs";

const image = (digit) => `img_${digit.repeat(24)}`;
const endpoints = (offset) => Array.from({ length: 8 }, (_, index) => `dst_${(index + offset).toString(16).padStart(24, "0")}`);
const inspect = (source) => ({ type: "toolCall", name: "inspect", id: `fixture-${source}`, arguments: { source } });
const verdict = (value, citations) => ({ type: "toolCall", name: "submit_verdict", id: "fixture-final",
  arguments: { verdict: value, citations } });
const makeCase = (id, check, { alternateParent = false, alternateDest = false, complete = true } = {}) => ({
  kind: "case", id, rule: "fanout", distinct: 8, complete, service: image("d"),
  evidence: {
    profile: { id: "profile", check, parents: [image("a")], endpoints: endpoints(0) },
    ancestry: { id: "ancestry", chain: [image(alternateParent ? "b" : "a")] },
    destinations: { id: "destinations", endpoints: endpoints(alternateDest ? 10 : 0) },
  },
});

function mock(...responses) {
  const { model } = scriptedBackend();
  return { model, stream: () => fixtureResponse(model, responses.shift()) };
}

test("Pi changes the second lookup based on the first observation", async () => {
  const backend = scriptedBackend();
  const ancestry = await triage(makeCase("case-1", "ancestry"), "adaptive", backend);
  const destinations = await triage(makeCase("case-2", "destinations", { alternateDest: true }), "adaptive", backend);
  assert.deepEqual(ancestry.requests, ["profile", "ancestry"]);
  assert.deepEqual(destinations.requests, ["profile", "destinations"]);
  assert.equal(ancestry.verdict, "expected");
  assert.equal(destinations.verdict, "suspicious");
  assert.equal(destinations.turns, 3);
});

test("the fixed control cannot change order", async () => {
  const result = await triage(makeCase("case-1", "ancestry"), "fixed-destinations", mock([inspect("ancestry")]));
  assert.equal(result.reason, "protocol_violation");
  assert.deepEqual(result.requests, []);
});

test("batched, duplicate, and third lookup are blocked by the host", async () => {
  const incident = makeCase("case-1", "ancestry");
  for (const [backend, count] of [
    [mock([inspect("profile"), inspect("ancestry")]), 0],
    [mock([inspect("profile")], [inspect("profile")]), 1],
    [mock([inspect("profile")], [inspect("ancestry")], [inspect("destinations")]), 2],
  ]) {
    const result = await triage(incident, "adaptive", backend);
    assert.equal(result.reason, "protocol_violation");
    assert.equal(result.requests.length, count);
    assert.ok(result.turns <= 3);
  }
});

test("fabricated citations and contradictions cannot become an expected label", async () => {
  const incident = makeCase("case-1", "ancestry", { alternateParent: true });
  for (const citations of [["profile", "ancestry"], ["profile", "destinations"]]) {
    const result = await triage(incident, "adaptive",
      mock([inspect("profile")], [inspect("ancestry")], [verdict("expected", citations)]));
    assert.equal(result.verdict, "insufficient_evidence");
    assert.equal(result.reason, "invalid_verdict");
  }
  const result = await triage(incident, "adaptive", mock([verdict("expected", ["arbitrary"])]));
  assert.equal(result.reason, "protocol_violation");
});

test("a missing required observation abstains; timeouts retain the alert", async () => {
  const incident = makeCase("case-1", "both");
  assert.equal((await triage(incident, "adaptive", scriptedBackend())).verdict, "insufficient_evidence");
  const stalled = { model: scriptedBackend().model, stream: () => new Promise(() => {}) };
  const result = await triage(incident, "adaptive", stalled, { timeoutMs: 20 });
  assert.equal(result.reason, "timeout");
  assert.equal(result.verdict, "insufficient_evidence");
});

test("replay rolls back evidence completeness for late drops and leaves local rules intact", async () => {
  const data = [
    { kind: "session", version: 1 }, { kind: "alert", id: "case-1", rule: "fanout" },
    makeCase("case-1", "ancestry"), { kind: "capture_gap", drops: 1 },
    { kind: "alert", id: "case-2", rule: "canary" },
    { kind: "summary", clean: true, drops: 1, uncorrelated: 0, alerts: { fanout: 1, canary: 1, unexpected_exec: 0 } },
  ];
  const output = await replay(parseCapture(data.map((row) => JSON.stringify(row)).join("\n")),
    { cases: [{ id: "case-1", label: "expected" }] }, scriptedBackend());
  assert.equal(output.summaries.adaptive.abstentions, 1);
  assert.equal(output.summaries.adaptive.falseAlertsRetained, 1);
  assert.equal(output.summaries.adaptive.meanRequests, 0);
  assert.deepEqual(output.localOnlyAlerts, [{ id: "case-2", rule: "canary" }]);
});

test("replay rejects malformed tokens and partial sessions", () => {
  const incident = makeCase("case-1", "ancestry");
  incident.evidence.ancestry.chain[0] = "untrusted executable text";
  assert.throws(() => parseCapture([
    { kind: "session", version: 1 }, { kind: "alert", id: incident.id, rule: "fanout" }, incident,
    { kind: "summary", clean: true, drops: 0, uncorrelated: 0, alerts: { fanout: 1, canary: 0, unexpected_exec: 0 } },
  ].map((row) => JSON.stringify(row)).join("\n")), /invalid evidence token/u);
  assert.throws(() => parseCapture('{"kind":"session","version":1}'), /final summary/u);
});
