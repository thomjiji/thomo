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

	const register = () => {
		if (registered) return;
		const providerConfig = {
			name: PROVIDER_NAME,
			api: "ollama-native" as const,
			apiKey: "ollama",
			...(hasExplicitEndpoint || hasExplicitModels ? { baseUrl } : {}),
			...(hasExplicitModels ? { models: modelNames.map(ollamaModelConfig) } : {}),
			// Leave this callback absent when models.json is supplying a static
			// provider. That keeps /model from probing the default localhost.
			...(hasExplicitEndpoint || hasExplicitModels
				? { refreshModels: async ({ signal }: { signal: AbortSignal }) => discoverOllamaModels(baseUrl, signal) }
				: {}),
			streamSimple: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) =>
				streamOllama(model, context, options, () => createAssistantMessageEventStream()),
		};
		pi.registerProvider(OLLAMA_PROVIDER_ID, providerConfig);
		registered = true;
	};

	register();
	pi.registerCommand("ollama-native", {
		description: "Enable, disable, or show the optional Ollama native provider",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "off") {
				if (registered) pi.unregisterProvider(OLLAMA_PROVIDER_ID);
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

export { buildOllamaRequest, normalizeBaseUrl };
