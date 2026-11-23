export const SOURCES = ["profile", "ancestry", "destinations"];
export const FIXED = {
  "fixed-ancestry": ["profile", "ancestry"],
  "fixed-destinations": ["profile", "destinations"],
};
export const VERDICTS = ["expected", "suspicious", "insufficient_evidence"];

const CASE_ID = /^case-[1-9][0-9]{0,11}$/u;
const IMAGE_ID = /^img_[0-9a-f]{24}$/u;
const DEST_ID = /^dst_[0-9a-f]{24}$/u;
const CHECKS = ["ancestry", "destinations", "both"];

function tokens(value, regex, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      value.some((token) => typeof token !== "string" || !regex.test(token))) {
    throw new Error("invalid evidence token list");
  }
  return [...value];
}

export function sanitizeCase(raw) {
  if (raw?.kind !== "case" || typeof raw.id !== "string" || !CASE_ID.test(raw.id) ||
      raw.rule !== "fanout" || raw.distinct !== 8 || typeof raw.complete !== "boolean" ||
      !(raw.service === null || (typeof raw.service === "string" && IMAGE_ID.test(raw.service)))) {
    throw new Error("invalid case envelope");
  }
  const { profile, ancestry, destinations } = raw.evidence ?? {};
  if (!(profile === null || (profile?.id === "profile" && CHECKS.includes(profile.check))) ||
      !(ancestry === null || ancestry?.id === "ancestry") || destinations?.id !== "destinations") {
    throw new Error("invalid evidence record");
  }
  return {
    kind: "case", id: raw.id, rule: "fanout", distinct: 8, service: raw.service, complete: raw.complete,
    evidence: {
      profile: profile === null ? null : {
        id: "profile", check: profile.check, parents: tokens(profile.parents, IMAGE_ID, 1, 64),
        endpoints: tokens(profile.endpoints, DEST_ID, profile.check === "ancestry" ? 0 : 1, 64),
      },
      ancestry: ancestry === null ? null : { id: "ancestry", chain: tokens(ancestry.chain, IMAGE_ID, 1, 6) },
      destinations: { id: "destinations", endpoints: tokens(destinations.endpoints, DEST_ID, 8, 64) },
    },
  };
}

export function requiredSources(profile) {
  if (!profile) return [];
  return profile.check === "both" ? ["ancestry", "destinations"] : [profile.check];
}

export function classify(records) {
  const profile = records.get("profile");
  const required = requiredSources(profile);
  if (!required.length) return { verdict: "insufficient_evidence", citations: [] };
  const comparisons = required.filter((source) => records.get(source)).map((source) => {
    const record = records.get(source);
    const allowed = source === "ancestry"
      ? profile.parents.includes(record.chain[0])
      : record.endpoints.every((token) => profile.endpoints.includes(token));
    return { source, allowed };
  });
  const mismatch = comparisons.find(({ allowed }) => !allowed);
  if (mismatch) return { verdict: "suspicious", citations: ["profile", mismatch.source] };
  if (comparisons.length === required.length) {
    return { verdict: "expected", citations: ["profile", ...required] };
  }
  return { verdict: "insufficient_evidence", citations: [] };
}

export function policyRouter(incident) {
  if (!incident.complete) return { verdict: "insufficient_evidence", citations: [], requests: [], reason: "incomplete_capture" };
  const profile = incident.evidence.profile;
  const plan = ["profile", ...requiredSources(profile)].slice(0, 2);
  const records = new Map(plan.map((source) => [source, incident.evidence[source]]));
  return { ...classify(records), requests: plan, reason: "deterministic_policy" };
}
