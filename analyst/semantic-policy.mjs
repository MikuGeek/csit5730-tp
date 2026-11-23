import { CATALOG, HOLD, SOURCES } from "./semantic-data.mjs";

const VOCABULARY = {
  lineage: "ancestor parent spawn launcher executable helper binary operator manual hand console",
  network: "peer traffic receive tenant geography region address destination remote site pool transfer relief",
  rollout: "revision version build promotion release ramp artifact deployment package stage revision",
  identity: "certificate credential principal machine account worker authentication ownership identity",
  backup: "snapshot image saved copy generation recover restore provenance frozen anchor origin",
  scheduler: "batch job queue recurring retry invocation dispatch allotment allocation reservation scheduler",
  calendar: "time duration interval effective postpone reschedule delay maintenance window start moved slot",
  approval: "sign signatory waiver permission owner authority governance policy exception board override exemption",
};
const REVIEW = /\b(?:unknown|conflict\w*|hypothetical|tentative|provisional|ready|readiness|did not record|not recorded|didn't record|not say|doesn't say|doesn't resolve|without saying|unclear|future tense|cannot|can't (?:confirm|distinguish)|couldn't tell|nobody (?:acknowledged|confirmed)|neither .* final|no one confirmed|both .* options|don't know)\b/iu;
const NEGATION = /^(?:no|not|never|without|didn|cancel|reject|abandon|withdraw|disregard|discard)/u;
const STOP = new Set("a an and are as at be been but by for from got had has have if in into is it its no of on one only or our out so than that the their them then there this to under up was we went were when which who will with would".split(" "));

function stem(token) {
  return token.replace(/(?:ing|ed|es|s)$/u, "");
}

function words(text) {
  return text.toLowerCase().match(/[a-z]+/gu) ?? [];
}

function features(text, char = true) {
  const tokens = words(text).filter((token) => !STOP.has(token)).map(stem);
  const result = new Map();
  const add = (key, weight) => result.set(key, (result.get(key) ?? 0) + weight);
  for (const [index, token] of tokens.entries()) {
    add(`w:${token}`, 1);
    if (index > 0) add(`b:${tokens[index - 1]}_${token}`, 0.7);
    if (char) {
      const padded = `^${token}$`;
      for (let offset = 0; offset + 3 <= padded.length; offset++) add(`c:${padded.slice(offset, offset + 3)}`, 0.3);
    }
  }
  return result;
}

function dot(first, second) {
  let scalar = 0;
  for (const [key, value] of first) scalar += value * (second.get(key) ?? 0);
  return scalar;
}

function unit(vector, idf) {
  const scaled = new Map([...vector].map(([key, value]) => [key, value * (idf.get(key) ?? 1)]));
  const norm = Math.sqrt(dot(scaled, scaled)) || 1;
  return new Map([...scaled].map(([key, value]) => [key, value / norm]));
}

function fitSimilarity(training, char) {
  const docs = training.flatMap(({ view }) => [view.bulletin, view.handoff]);
  docs.push(...Object.values(CATALOG), ...Object.values(VOCABULARY));
  const frequency = new Map();
  for (const doc of docs) {
    for (const token of features(doc, char).keys()) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }
  const idf = new Map([...frequency].map(([token, count]) => [token, 1 + Math.log((docs.length + 1) / (count + 1))]));
  const encode = (text) => unit(features(text, char), idf);
  const prototypes = Object.fromEntries(SOURCES.map((source) => [source, encode(`${CATALOG[source]} ${VOCABULARY[source]}`)]));
  const neighbors = training.map(({ view, source }) => ({ source, bulletin: encode(view.bulletin), handoff: encode(view.handoff) }));

  return (view, method) => {
    const handoff = encode(view.handoff);
    const bulletin = encode(view.bulletin);
    const clauses = view.bulletin.split(/[.;]|\b(?:if|when|instead|otherwise)\b/iu).filter((text) => words(text).length >= 3);
    const encoded = clauses.map((text) => ({ text, vector: encode(text) }));
    const handoffWords = words(view.handoff);
    const affirmative = encode(handoffWords.filter((token, index) =>
      !handoffWords.slice(Math.max(0, index - 3), index).some((prior) => NEGATION.test(prior))).join(" "));
    return SOURCES.map((source) => {
      const prototype = prototypes[source];
      const clauseScore = Math.max(0, ...encoded.map(({ vector }) =>
        dot(vector, prototype) * (0.2 + 0.8 * dot(vector, affirmative))));
      const related = neighbors.filter((row) => row.source === source).map((row) =>
        0.25 * dot(bulletin, row.bulletin) + 0.75 * dot(handoff, row.handoff)).sort((first, second) => second - first);
      const nearest = ((related[0] ?? 0) + (related[1] ?? 0)) / 2;
      const lexical = 0.35 * dot(affirmative, prototype) + 0.15 * dot(bulletin, prototype) + 0.5 * clauseScore;
      return { source, score: method === "nearest" ? nearest : method === "lexical" ? lexical : 0.7 * lexical + 0.3 * nearest };
    }).sort((first, second) => second.score - first.score);
  };
}

export function trainingViews(corpus) {
  return [...new Map(corpus.packets.map((packet) => [packet.viewKey, {
    view: packet.view, ...corpus.truth.get(packet.id),
  }])).values()];
}

function decide(view, score, config) {
  if (config.reviewPattern && REVIEW.test(view.handoff)) return HOLD;
  const [best, second] = score(view, config.method);
  return best.score - second.score >= config.margin ? best.source : HOLD;
}

export function calibratePolicy(dev) {
  const data = trainingViews(dev);
  const configurations = [];
  for (const char of [true, false]) {
    const folds = [...new Set(data.map(({ family }) => family))].map((family) => ({
      score: fitSimilarity(data.filter((row) => row.family !== family), char),
      validation: data.filter((row) => row.family === family),
    }));
    for (const method of ["hybrid", "nearest", "lexical"]) {
      for (const reviewPattern of [true, false]) {
        for (const margin of [0, 0.005, 0.015, 0.035]) {
          const config = { char, method, reviewPattern, margin };
          const correct = folds.reduce((sum, { score, validation }) => sum + validation.filter(({ view, source }) =>
            decide(view, score, config) === source).length, 0);
          configurations.push({ ...config, cvAccuracy: correct / data.length });
        }
      }
    }
  }
  configurations.sort((first, second) => second.cvAccuracy - first.cvAccuracy);
  const config = configurations[0];
  const fit = fitSimilarity(data, config.char);
  const fallback = SOURCES.map((source) => ({ source, count: data.filter((row) => row.source === source).length }))
    .sort((first, second) => second.count - first.count)[0].source;
  return { config, fallback, choose: (view) => decide(view, fit, config) };
}
