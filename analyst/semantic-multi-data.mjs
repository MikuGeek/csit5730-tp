import { SOURCES } from "./semantic-data.mjs";

const HANDOFFS = [
  ["restart", ["lineage"],
    "For a manual restart, confirm the executable that launched the worker.",
    "The worker came back through the manual restart. The rollout proposal was dropped."],
  ["pool-switch", ["network"],
    "When the serving pool changes, verify which environment actually received the connections.",
    "The new pool took the traffic. The maintenance window stayed the same."],
  ["candidate", ["rollout"],
    "A candidate promotion is restricted to the approved artifact revision.",
    "The candidate was promoted through the ordinary path. The exception request was withdrawn."],
  ["service-principal", ["identity"],
    "For a credential rollover, confirm which authenticated service principal the worker used.",
    "The worker used the replacement credential. The launch command and build stayed unchanged."],
  ["restore", ["backup"],
    "A restore must originate from the approved recovery image.",
    "Actual recovery was completed. The exercise reservation was cancelled."],
  ["retry", ["scheduler"],
    "A rerun requires a reserved job-controller allocation.",
    "The retry ran as the reserved batch job. Sending a calendar invitation was considered and dropped."],
  ["postpone", ["calendar"],
    "A postponement is valid during the newly effective interval.",
    "The postponed operation ran at the replacement time, with its existing queue allocation."],
  ["waiver", ["approval"],
    "When a waiver is used, confirm that the signer had delegated authority.",
    "We proceeded under the waiver. The alternative plan to delay the job was not used."],
  ["rescue", ["lineage"],
    "When the regular delivery path is replaced by the rescue utility, verify the utility's launcher.",
    "The regular promotion was withdrawn before execution. Only the rescue utility ran."],
  ["tenant-move", ["network"],
    "A tenant move is scoped to the owner of the peers actually contacted.",
    "The migration completed and the connections went to the receiving tenant."],
  ["rollback", ["rollout"],
    "For a rollback, verify the delivered build revision.",
    "Traffic went back to the previous build through a deployment rollback. No saved disk copy was restored."],
  ["queue-extension", ["scheduler"],
    "An extension of batch capacity requires a new reservation from the queue controller.",
    "We obtained extra queue capacity and used it. The time window was unchanged."],
  ["pool-and-window", ["network", "calendar"],
    "If the job switches serving pools, check the actual peer ownership. If the maintenance slot moves, check the effective interval.",
    "The batch used the backup pool and ran during the replacement slot."],
  ["launcher-and-build", ["lineage", "rollout"],
    "A new launcher must be authorized as the worker's parent. A build promotion is limited to the approved revision.",
    "The new launcher started the worker, and the candidate build was promoted."],
  ["temporary-principal", ["identity", "approval"],
    "A temporary service identity requires evidence of the authenticated principal and the delegate who approved its use.",
    "The temporary credential was activated and used under the exception."],
  ["queued-recovery", ["backup", "scheduler"],
    "A batch recovery requires an approved recovery copy and an actual recovery-job reservation.",
    "We restored from the retained copy using the reserved recovery job. A shifted window was discussed and dropped."],
  ["emergency-promotion", ["network", "rollout", "approval"],
    "Emergency promotion to a replacement pool requires the actual peer environment, delivered revision, and delegated sign-off.",
    "Emergency promotion went through. The replacement pool handled the connections, and the exception governed the change."],
  ["reslotted-batch", ["identity", "scheduler", "calendar"],
    "A reslotted batch with a temporary credential requires its authenticated principal, a job reservation, and the amended interval.",
    "The batch ran with the temporary credential using the new reservation during the amended slot."],
  ["evacuated-storage", ["backup", "network"],
    "Storage evacuation from a retained snapshot requires validation of both the snapshot origin and the pool reached by the worker.",
    "The worker restored the retained snapshot and then finished sending traffic to the receiving pool."],
  ["timed-rescue", ["lineage", "identity", "calendar"],
    "A rescue job launched in a revised window must have an approved parent process and run as the designated principal during that window.",
    "The rescue job ran under the designated account from the rescue launcher in the revised window."],
  ["waived-retry", ["scheduler", "approval"],
    "A manually expedited retry requires a queue reservation and sign-off from an authorized delegate.",
    "We used the expedited reservation under the approved waiver. The regular retry was cancelled."],
  ["rescheduled-rollback", ["rollout", "calendar"],
    "A postponed rollback is limited to the approved revision and the new effective maintenance window.",
    "The rollback used the rescheduled window. The snapshot-based recovery plan was dropped."],
  ["isolated-restore", ["network", "identity", "backup"],
    "Restoration in the isolated region requires proof of the destination region, worker identity, and recovery image origin.",
    "The worker restored the image under the temporary service account and transferred traffic to the isolated region."],
  ["delegated-launch", ["lineage", "approval"],
    "When a delegated exception allows the alternate launcher, confirm the observed launcher and the signer of the exception.",
    "We invoked the alternate launcher under the delegation. The regular rollout stayed untouched."],
  ["unconfirmed-path", [],
    "A rollback requires revision evidence. A restore requires recovery-copy evidence.",
    "Both procedures were prepared. The handoff does not say whether either ran."],
  ["draft-window", [],
    "A rescheduled job is checked against its final window. An expedited job relies on signed approval.",
    "A later slot appears in a draft. The operator has not recorded the final decision."],
  ["missing-action", [],
    "A launcher change requires parent-process evidence. A principal change requires credential evidence.",
    "The ticket was handed over without the execution summary."],
  ["unknown-pool", [],
    "A pool cutover requires destination evidence. A cancelled cutover replaced by a retry requires a reservation.",
    "The two plans were ready before shift change. Actual execution is still unconfirmed."],
  ["proposed-exception", [],
    "An active waiver requires delegated approval. Routine promotion requires a build record.",
    "A waiver request is still pending. The original promotion is only a proposal."],
  ["unrecorded-batch", [],
    "A batch run uses its scheduler record. A manual restart uses its launcher record.",
    "The service was checked afterward. The notes omit how it got to that state."],
  ["pending-restore", [],
    "A real restore requires a snapshot record. A rehearsal requires its reserved job slot.",
    "This is the pre-operation checklist. No completion has been confirmed."],
  ["unknown-identity", [],
    "A temporary principal requires identity evidence. A moved maintenance slot requires calendar evidence.",
    "Both changes were suggested. The handoff has no record of what was approved or executed."],
];

function makeIncident(documentId, requiredSources, expectedVerdict) {
  // The trusted fixture lists obligations without telling the selector which sources satisfy them.
  const binding = `${documentId}:${expectedVerdict}`;
  const obligations = requiredSources.map((_, index) => `check-${index + 1}`);
  const bySource = new Map(requiredSources.map((source, index) => [source, obligations[index]]));
  const failingSource = expectedVerdict === "suspicious" ? requiredSources.at(-1) : null;
  const receipts = new Map(SOURCES.map((source) => {
    const obligation = bySource.get(source);
    return [source, {
      obligation,
      binding: obligation ? binding : `other:${binding}`,
      conformance: source !== failingSource,
    }];
  }));
  return { binding, obligations, receipts, expectedVerdict };
}

export function makeMultiCorpus(handoffs = HANDOFFS) {
  return handoffs.map(([id, requiredSources, bulletin, handoff]) => {
    const verdicts = requiredSources.length ? ["expected", "suspicious"] : ["needs_review"];
    return {
      id, requiredSources, view: { rule: "fanout", distinct: 8, bulletin, handoff },
      incidents: verdicts.map((verdict) => makeIncident(id, requiredSources, verdict)),
    };
  });
}

export function verifyMultiReceipt(incident, sources) {
  const { binding, obligations, receipts } = incident;
  if (!obligations.length) return "needs_review";
  const passed = new Set();
  for (const source of sources) {
    const record = receipts.get(source);
    if (!record || record.binding !== binding || !obligations.includes(record.obligation)) continue;
    if (record.conformance === false) return "suspicious";
    if (record.conformance === true) passed.add(record.obligation);
  }
  return obligations.every((obligation) => passed.has(obligation)) ? "expected" : "needs_review";
}
