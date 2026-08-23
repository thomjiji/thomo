import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type Api, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_OLLAMA_BASE_URL,
	OLLAMA_PROVIDER_ID,
	buildOllamaRequest,
	discoverOllamaModels,
	ollamaModelConfig,
	parseModelNames,
	streamOllama,
} from "./ollama.ts";

const PROVIDER_NAME = "Ollama (native /api/chat)";

export default function ollamaNativeExtension(pi: ExtensionAPI): void {
	if (process.env.THOMO_OLLAMA_NATIVE === "0") return;

	const configuredEndpoint = process.env.THOMO_OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST;
	const modelNames = parseModelNames(
		process.env.THOMO_OLLAMA_MODELS ?? process.env.THOMO_OLLAMA_MODEL ?? process.env.OLLAMA_MODELS,
	);
	const hasExplicitEndpoint = Boolean(configuredEndpoint?.trim());
	const hasExplicitModels = modelNames.length > 0;
	const baseUrl = normalizeBaseUrl(configuredEndpoint ?? DEFAULT_OLLAMA_BASE_URL);
	let registered = false;
	let registeredProviderIds: string[] = [];

	const register = () => {
		if (registered) return;
		registeredProviderIds = nativeProviderIdsFromModelsJson();
		for (const providerId of registeredProviderIds) {
			const isPrimaryProvider = providerId === OLLAMA_PROVIDER_ID;
			const providerConfig = {
				name: isPrimaryProvider ? PROVIDER_NAME : `${PROVIDER_NAME} (${providerId})`,
				api: "ollama-native" as const,
				apiKey: "ollama",
				...(isPrimaryProvider && (hasExplicitEndpoint || hasExplicitModels) ? { baseUrl } : {}),
				...(isPrimaryProvider && hasExplicitModels ? { models: modelNames.map(ollamaModelConfig) } : {}),
				// Leave this callback absent when models.json is supplying a static
				// provider. That keeps /model from probing the default localhost.
				...(isPrimaryProvider && (hasExplicitEndpoint || hasExplicitModels)
					? { refreshModels: async ({ signal }: { signal: AbortSignal }) => discoverOllamaModels(baseUrl, signal) }
					: {}),
				streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
					streamOllama(model, context, options, () => createAssistantMessageEventStream()),
			};
			pi.registerProvider(providerId, providerConfig);
		}
		registered = true;
	};

	register();
	pi.registerCommand("ollama-native", {
		description: "Enable, disable, or show the optional Ollama native provider",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "off") {
				for (const providerId of registeredProviderIds) pi.unregisterProvider(providerId);
				registeredProviderIds = [];
				registered = false;
				ctx.ui.notify("Ollama native provider disabled; restart or /reload to restore it", "info");
				return;
			}
			if (action === "on") {
				register();
				ctx.ui.notify(
					`Ollama native provider enabled (${hasExplicitEndpoint ? baseUrl : "models.json or default localhost"})`,
					"info",
				);
				return;
			}
			ctx.ui.notify(
				`${registered ? "enabled" : "disabled"}; use /ollama-native on|off (models refresh from /api/tags)`,
				"info",
			);
		},
	});
}

function normalizeBaseUrl(value: string): string {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (!trimmed) return DEFAULT_OLLAMA_BASE_URL;
	return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function nativeProviderIdsFromModelsJson(): string[] {
	const providerIds = new Set([OLLAMA_PROVIDER_ID]);
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	try {
		const config = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as {
			providers?: Record<string, { api?: string; models?: Array<{ api?: string }> }>;
		};
		for (const [providerId, provider] of Object.entries(config.providers ?? {})) {
			if (provider.api === "ollama-native" || provider.models?.some((model) => model.api === "ollama-native")) {
				providerIds.add(providerId);
			}
		}
	} catch {
		// models.json is optional; the primary provider still works with env config.
	}
	return [...providerIds];
}

export { buildOllamaRequest, normalizeBaseUrl };
