import { createHash } from "node:crypto";
import { DEVELOPMENT } from "./semantic-dev.mjs";
import { HOLDOUT } from "./semantic-heldout.mjs";

export const CATALOG = Object.freeze({
  lineage: "Observed parent and ancestor executables: what started the process, not who requested it.",
  network: "Observed destination addresses and owning environment, geography, or tenant of the actual peers.",
  rollout: "Deployment controller ledger: delivered versions, artifact revisions, promotion and rollback stages.",
  identity: "Workload certificates and attestations: the authenticated principal, credential, or service account used.",
  backup: "Storage recovery manifest: snapshot origin, saved copy provenance and recovery generation.",
  scheduler: "Job controller: queued reservation, recurring invocation, batch allotment or actual retry.",
  calendar: "Change calendar history: effective windows, postponements, timing boundaries and extensions.",
  approval: "Governance receipts: approving authority, delegation, signed exception or policy waiver.",
});
export const SOURCES = Object.freeze(Object.keys(CATALOG));
export const HOLD = "hold";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function makeCorpus(split, capture = null) {
  const families = split === "dev" ? DEVELOPMENT : split === "test" ? HOLDOUT : null;
  if (!families) throw new Error("unknown corpus split");
  if (capture && (capture.incomplete || capture.cases.size !== families.length * 9 ||
      [...capture.cases.values()].some(({ complete }) => !complete))) {
    throw new Error(`expected ${families.length * 9} complete fan-out alerts in the capture`);
  }

  const packets = [];
  const truth = new Map();
  for (const [family, first, second, bulletin, left, right, ambiguous] of families) {
    const views = [...left.map((handoff) => [first, handoff]), ...right.map((handoff) => [second, handoff]), [HOLD, ambiguous]];
    for (const [index, [source, handoff]] of views.entries()) {
      const view = { rule: "fanout", distinct: 8, bulletin, handoff };
      const viewKey = digest(JSON.stringify(view));
      for (const label of source === HOLD ? ["needs_review"] : ["expected", "suspicious"]) {
        const id = digest(`${split}:${family}:${index}:${label}`).slice(0, 20);
        const binding = digest(`authorization:${id}`);
        const receipts = new Map(SOURCES.map((candidate) => [candidate, {
          binding: candidate === source ? binding : digest(`unrelated:${id}:${candidate}`),
          conformance: candidate === source ? label === "expected" : digest(`${id}:${candidate}`)[0] < "8",
        }]));
        const packet = { id, view, viewKey, binding, receipts, captureId: null };
        packets.push(packet);
        truth.set(id, { family, source, label });
      }
    }
  }
  packets.sort((first, second) => first.id.localeCompare(second.id));
  if (capture) {
    const caseIds = [...capture.cases.keys()];
    packets.forEach((packet, index) => { packet.captureId = caseIds[index]; });
  }
  return { packets, truth, fingerprint: digest(JSON.stringify(families)), captureBound: Boolean(capture) };
}

export function verifyReceipt(packet, selection) {
  if (!SOURCES.includes(selection)) return { verdict: "insufficient_evidence", reason: "no_source" };
  const record = packet.receipts.get(selection);
  if (!record || record.binding !== packet.binding || typeof record.conformance !== "boolean") {
    return { verdict: "insufficient_evidence", reason: "unbound_or_missing_receipt" };
  }
  return { verdict: record.conformance ? "expected" : "suspicious", reason: "verified_receipt" };
}
