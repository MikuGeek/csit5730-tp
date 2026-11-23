import { createAssistantMessageEventStream, createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { classify, requiredSources } from "./evidence.mjs";

function modelFor(id, provider, baseUrl) {
  return {
    id, name: id, api: "openai-completions", provider, baseUrl, reasoning: false,
    input: ["text"], contextWindow: 16_384, maxTokens: 768,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false },
  };
}

export function fixtureResponse(model, content) {
  const stream = createAssistantMessageEventStream();
  const reason = content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";
  const message = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), stopReason: reason, content,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: model.cost },
  };
  stream.push({ type: "done", reason, message });
  stream.end(message);
  return stream;
}

export function scriptedBackend() {
  const model = modelFor("scripted-test-double", "fixture", "http://localhost");
  return {
    model,
    stream(model, context) {
      const instructions = context.messages.find((message) => message.role === "system").content;
      const fixed = instructions.match(/Fixed-order control: inspect profile, then (ancestry|destinations)/u)?.[1];
      const records = new Map();
      for (const message of context.messages.filter((entry) => entry.role === "toolResult")) {
        const record = JSON.parse(message.content[0].text);
        records.set(record.id ?? record.missing, record.id ? record : null);
      }
      const plan = ["profile", ...(fixed ? [fixed] : requiredSources(records.get("profile")))];
      const next = records.size < 2 && plan.find((source) => !records.has(source));
      const content = next
        ? [{ type: "toolCall", id: `fixture-${records.size}`, name: "inspect", arguments: { source: next } }]
        : [{ type: "toolCall", id: "fixture-final", name: "submit_verdict", arguments: classify(records) }];
      return fixtureResponse(model, content);
    },
  };
}

export function liveBackend(env = process.env) {
  if (!env.TRIAGE_MODEL || !env.TRIAGE_BASE_URL) throw new Error("set TRIAGE_MODEL and TRIAGE_BASE_URL for live replay");
  const url = new URL(env.TRIAGE_BASE_URL);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
    throw new Error("use HTTPS or a loopback HTTP model endpoint without URL credentials");
  }
  if (!env.TRIAGE_API_KEY && !local) throw new Error("set TRIAGE_API_KEY for a non-loopback model endpoint");
  const baseUrl = url.toString().replace(/\/$/u, "");
  const model = modelFor(env.TRIAGE_MODEL, "tracetriage-model", baseUrl);
  const models = createModels();
  models.setProvider(createProvider({
    id: model.provider, name: model.provider, baseUrl, models: [model],
    auth: { apiKey: { name: model.provider, resolve: async () => ({ auth: { apiKey: env.TRIAGE_API_KEY ?? "local" } }) } },
    api: openAICompletionsApi(),
  }));
  return {
    model: models.getModel(model.provider, model.id),
    stream: (model, context, options) => models.streamSimple(model, context, {
      ...options, temperature: 0, maxTokens: 768,
    }),
  };
}
