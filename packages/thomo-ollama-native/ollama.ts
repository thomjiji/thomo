import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
	StopReason,
	ToolCall,
} from "@earendil-works/pi-ai";
import type { GenerationMetrics } from "../thomo-tps/generation-metrics.ts";

export const OLLAMA_PROVIDER_ID = "ollama-native";
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export interface OllamaMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string;
	thinking?: string;
	images?: string[];
	tool_calls?: OllamaToolCall[];
	tool_name?: string;
}

export interface OllamaToolCall {
	function: {
		name: string;
		arguments: Record<string, unknown> | string;
	};
}

export interface OllamaToolDefinition {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: unknown;
	};
}

export interface OllamaChatRequest {
	model: string;
	messages: OllamaMessage[];
	stream: true;
	think: false | string;
	tools?: OllamaToolDefinition[];
	options?: Record<string, unknown>;
}

interface OllamaChunk {
	error?: unknown;
	model?: unknown;
	done?: unknown;
	done_reason?: unknown;
	message?: {
		content?: unknown;
		thinking?: unknown;
		tool_calls?: unknown;
	};
	eval_count?: unknown;
	eval_duration?: unknown;
	prompt_eval_count?: unknown;
	prompt_eval_duration?: unknown;
	load_duration?: unknown;
	total_duration?: unknown;
}

interface OllamaModelConfig {
	id: string;
	name: string;
	reasoning: boolean;
	thinkingLevelMap: Record<string, string | null>;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
}

interface StreamFactory {
	(): AssistantMessageEventStream;
}

interface PendingToolCall {
	index: number;
	contentIndex: number;
	id: string;
	name: string;
	argumentsText: string;
}

export function getOllamaChatUrl(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/+$/, "");
	if (normalized.endsWith("/api/chat")) return normalized;
	if (normalized.endsWith("/api")) return `${normalized}/chat`;
	return `${normalized}/api/chat`;
}

export function getOllamaTagsUrl(baseUrl: string): string {
	const normalized = baseUrl.replace(/\/+$/, "");
	if (normalized.endsWith("/api/tags")) return normalized;
	if (normalized.endsWith("/api")) return `${normalized}/tags`;
	return `${normalized}/api/tags`;
}

export function parseModelNames(value: string | undefined): string[] {
	if (!value) return [];
	return [...new Set(value.split(",").map((name) => name.trim()).filter(Boolean))];
}

export function ollamaModelConfig(id: string): OllamaModelConfig {
	return {
		id,
		name: `${id} (Ollama native)`,
		reasoning: true,
		thinkingLevelMap: {
			minimal: "low",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "high",
			max: "high",
		},
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_768,
	};
}

export async function discoverOllamaModels(
	baseUrl: string,
	signal?: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<OllamaModelConfig[]> {
	const response = await fetcher(getOllamaTagsUrl(baseUrl), { method: "GET", signal });
	if (!response.ok) {
		throw new Error(`Ollama model discovery failed: ${response.status} ${await response.text()}`.trim());
	}
	const payload: unknown = await response.json();
	if (!payload || typeof payload !== "object" || !Array.isArray((payload as { models?: unknown }).models)) {
		throw new Error("Ollama model discovery returned an invalid /api/tags response");
	}
	return (payload as { models: unknown[] }).models
		.map((model) => {
			if (!model || typeof model !== "object") return undefined;
			const name = (model as { name?: unknown }).name;
			return typeof name === "string" && name.trim() ? ollamaModelConfig(name.trim()) : undefined;
		})
		.filter((model): model is OllamaModelConfig => model !== undefined);
}

export function buildOllamaRequest(
	model: Pick<Model<Api>, "id"> & { thinkingLevelMap?: Record<string, string | null> },
	context: Context,
	options?: Pick<SimpleStreamOptions, "maxTokens" | "temperature" | "reasoning" | "samplingParams">,
): OllamaChatRequest {
	const messages: OllamaMessage[] = [];
	if (context.systemPrompt?.trim()) {
		messages.push({ role: "system", content: context.systemPrompt });
	}
	messages.push(...context.messages.map(toOllamaMessage));

	const request: OllamaChatRequest = {
		model: model.id,
		messages,
		stream: true,
		// Pi uses undefined for the off level. Ollama treats an omitted value as
		// model-dependent, so send false explicitly when thinking is disabled.
		think:
			options?.reasoning && options.reasoning !== "off"
				? model.thinkingLevelMap?.[options.reasoning] === null
					? false
					: model.thinkingLevelMap?.[options.reasoning] ?? options.reasoning
				: false,
	};
	if (context.tools && context.tools.length > 0) {
		request.tools = context.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			},
		}));
	}
	const ollamaOptions: Record<string, unknown> = {};
	if (options?.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens;
	if (options?.temperature !== undefined) ollamaOptions.temperature = options.temperature;
	if (options?.samplingParams) Object.assign(ollamaOptions, options.samplingParams);
	if (Object.keys(ollamaOptions).length > 0) request.options = ollamaOptions;
	return request;
}

function toOllamaMessage(message: Context["messages"][number]): OllamaMessage {
	if (message.role === "toolResult") {
		return {
			role: "tool",
			content: contentToText(message.content),
			tool_name: message.toolName,
		};
	}
	if (message.role === "assistant") {
		const text: string[] = [];
		let thinking: string | undefined;
		const toolCalls: OllamaToolCall[] = [];
		for (const block of message.content) {
			if (block.type === "text") text.push(block.text);
			else if (block.type === "thinking") thinking = `${thinking ?? ""}${block.thinking}`;
			else if (block.type === "toolCall") {
				toolCalls.push({ function: { name: block.name, arguments: block.arguments } });
			}
		}
		return {
			role: "assistant",
			content: text.join(""),
			...(thinking ? { thinking } : {}),
			...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
		};
	}

	const content = message.content;
	if (typeof content === "string") return { role: "user", content };
	return {
		role: "user",
		content: contentToText(content),
		...imagesFromContent(content),
	};
}

function contentToText(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}

function imagesFromContent(content: readonly { type: string; data?: string }[]): { images?: string[] } {
	const images = content
		.filter((block) => block.type === "image" && typeof block.data === "string")
		.map((block) => block.data as string);
	return images.length > 0 ? { images } : {};
}

export function parseOllamaLine(line: string): OllamaChunk {
	const trimmed = line.trim();
	if (!trimmed) throw new Error("Ollama returned an empty NDJSON line");
	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch {
		throw new Error(`Ollama returned invalid NDJSON: ${trimmed.slice(0, 200)}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Ollama returned a non-object NDJSON chunk");
	}
	return value as OllamaChunk;
}

export function streamOllama(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	createStream: StreamFactory,
): AssistantMessageEventStream {
	const stream = createStream();
	const partial = createPartialMessage(model);
	stream.push({ type: "start", partial });

	void (async () => {
		try {
			let payload: unknown = buildOllamaRequest(model, context, options);
			if (options?.onPayload) {
				const replacement = await options.onPayload(payload, model);
				if (replacement !== undefined) payload = replacement;
			}
			const headers: Record<string, string> = {
				"content-type": "application/json",
				accept: "application/x-ndjson",
				...(model.headers ?? {}),
			};
			for (const [name, value] of Object.entries(options?.headers ?? {})) {
				if (value !== null) headers[name] = value;
				else delete headers[name];
			}
			const response = await (options?.fetch ?? fetch)(getOllamaChatUrl(model.baseUrl), {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: options?.signal,
			});
			await options?.onResponse?.(
				{ status: response.status, headers: Object.fromEntries(response.headers.entries()) },
				model,
			);
			if (!response.ok) {
				throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`.trim());
			}
			if (!response.body) throw new Error("Ollama response has no body");

			let finished = false;
			const pendingTools = new Map<number, PendingToolCall>();
			for await (const line of readNdjsonLines(response.body)) {
				const chunk = parseOllamaLine(line);
				if (typeof chunk.error === "string" && chunk.error.length > 0) throw new Error(`Ollama error: ${chunk.error}`);
				const message = chunk.message;
				if (message && typeof message === "object") {
					appendStringDelta(stream, partial, "thinking", message.thinking, closeTextBlock);
					appendStringDelta(stream, partial, "text", message.content, closeThinkingBlock);
					if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
						closeThinkingBlock(stream, partial);
						closeTextBlock(stream, partial);
					}
					accumulateToolCalls(stream, partial, pendingTools, message.tool_calls);
				}
				if (chunk.done === true) {
					finished = true;
					closeThinkingBlock(stream, partial);
					closeTextBlock(stream, partial);
					finishToolCalls(stream, partial, pendingTools);
					const stopReason = mapStopReason(chunk.done_reason, pendingTools.size > 0);
					const metrics = buildGenerationMetrics(chunk);
					if (metrics) (partial as AssistantMessage & { generationMetrics?: GenerationMetrics }).generationMetrics = metrics;
					partial.usage = buildUsage(chunk);
					partial.stopReason = stopReason;
					partial.rawStopReason = typeof chunk.done_reason === "string" ? chunk.done_reason : undefined;
					partial.responseModel = typeof chunk.model === "string" ? chunk.model : undefined;
					stream.push({ type: "done", reason: stopReason, message: partial });
					break;
				}
			}
			if (!finished) throw new Error("Ollama stream ended before the final done chunk");
		} catch (error) {
			const aborted = options?.signal?.aborted === true;
			partial.stopReason = aborted ? "aborted" : "error";
			partial.errorMessage = aborted ? "Ollama request aborted" : error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: partial });
		} finally {
			stream.end();
		}
	})();
	return stream;
}

function createPartialMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

function emptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function appendStringDelta(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
	kind: "thinking" | "text",
	value: unknown,
	closeOther: (stream: AssistantMessageEventStream, partial: AssistantMessage) => void,
): void {
	if (typeof value !== "string" || value.length === 0) return;
	closeOther(stream, partial);
	const type = kind === "thinking" ? "thinking" : "text";
	let index = [...partial.content].findLastIndex((block) => block.type === type);
	if (index < 0 || (kind === "thinking" ? thinkingClosed.has(partial) : textClosed.has(partial))) {
		index = partial.content.length;
		partial.content.push(kind === "thinking" ? { type: "thinking", thinking: "" } : { type: "text", text: "" });
		if (kind === "thinking") {
			thinkingClosed.delete(partial);
			stream.push({ type: "thinking_start", contentIndex: index, partial });
		} else {
			textClosed.delete(partial);
			stream.push({ type: "text_start", contentIndex: index, partial });
		}
	}
	const block = partial.content[index];
	if (kind === "thinking" && block.type === "thinking") {
		block.thinking += value;
		stream.push({ type: "thinking_delta", contentIndex: index, delta: value, partial });
	} else if (kind === "text" && block.type === "text") {
		block.text += value;
		stream.push({ type: "text_delta", contentIndex: index, delta: value, partial });
	}
}

const thinkingClosed = new WeakSet<AssistantMessage>();
const textClosed = new WeakSet<AssistantMessage>();

function closeThinkingBlock(stream: AssistantMessageEventStream, partial: AssistantMessage): void {
	const index = [...partial.content].findLastIndex((block) => block.type === "thinking");
	if (index < 0 || thinkingClosed.has(partial)) return;
	const block = partial.content[index];
	if (block.type !== "thinking") return;
	thinkingClosed.add(partial);
	stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial });
}

function closeTextBlock(stream: AssistantMessageEventStream, partial: AssistantMessage): void {
	const index = [...partial.content].findLastIndex((block) => block.type === "text");
	if (index < 0 || textClosed.has(partial)) return;
	const block = partial.content[index];
	if (block.type !== "text") return;
	textClosed.add(partial);
	stream.push({ type: "text_end", contentIndex: index, content: block.text, partial });
}

function accumulateToolCalls(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
	pendingTools: Map<number, PendingToolCall>,
	value: unknown,
): void {
	if (!Array.isArray(value)) return;
	for (const [index, rawCall] of value.entries()) {
		if (!rawCall || typeof rawCall !== "object") continue;
		const functionValue = (rawCall as { function?: unknown }).function;
		if (!functionValue || typeof functionValue !== "object") continue;
		const rawFunction = functionValue as { name?: unknown; arguments?: unknown };
		const name = typeof rawFunction.name === "string" ? rawFunction.name : pendingTools.get(index)?.name ?? "";
		const pending = pendingTools.get(index) ?? {
			index,
			contentIndex: partial.content.length + pendingTools.size,
			id: typeof (rawCall as { id?: unknown }).id === "string" ? (rawCall as { id: string }).id : `ollama-tool-${index}`,
			name,
			argumentsText: "",
		};
		if (name) pending.name = name;
		if (!pendingTools.has(index)) {
			pendingTools.set(index, pending);
			stream.push({ type: "toolcall_start", contentIndex: pending.contentIndex, partial });
		}
		const argumentText = encodeArgumentsDelta(rawFunction.arguments);
		if (argumentText) {
			if (typeof rawFunction.arguments === "string") pending.argumentsText += argumentText;
			else if (!pending.argumentsText) pending.argumentsText = argumentText;
			else if (pending.argumentsText !== argumentText) pending.argumentsText = argumentText;
			stream.push({ type: "toolcall_delta", contentIndex: pending.contentIndex, delta: argumentText, partial });
		}
	}
}

function encodeArgumentsDelta(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object") return JSON.stringify(value);
	return "";
}

function finishToolCalls(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
	pendingTools: Map<number, PendingToolCall>,
): void {
	for (const pending of pendingTools.values()) {
		let argumentsValue: Record<string, unknown>;
		try {
			const parsed: unknown = pending.argumentsText ? JSON.parse(pending.argumentsText) : {};
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("tool arguments must be a JSON object");
			argumentsValue = parsed as Record<string, unknown>;
		} catch {
			throw new Error(`Ollama returned invalid arguments for tool ${pending.name || pending.index}`);
		}
		const toolCall: ToolCall = {
			type: "toolCall",
			id: pending.id,
			name: pending.name,
			arguments: argumentsValue,
		};
		partial.content.push(toolCall);
		stream.push({ type: "toolcall_end", contentIndex: pending.contentIndex, toolCall, partial });
	}
}

function mapStopReason(value: unknown, hasToolCalls: boolean): Extract<StopReason, "stop" | "length" | "toolUse"> {
	if (value === "length" || value === "max_tokens") return "length";
	if (hasToolCalls || value === "tool_calls" || value === "tool_call") return "toolUse";
	return "stop";
}

function buildUsage(chunk: OllamaChunk) {
	const input = numberOrZero(chunk.prompt_eval_count);
	const output = numberOrZero(chunk.eval_count);
	return {
		input,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + output,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function buildGenerationMetrics(chunk: OllamaChunk): GenerationMetrics | undefined {
	const outputTokens = numberOrZero(chunk.eval_count);
	const decodeDurationMs = nanosecondsToMilliseconds(chunk.eval_duration);
	if (outputTokens <= 0 || decodeDurationMs <= 0) return undefined;
	return {
		source: "ollama",
		outputTokens,
		decodeDurationMs,
		promptTokens: optionalNumber(chunk.prompt_eval_count),
		promptDurationMs: optionalMilliseconds(chunk.prompt_eval_duration),
		loadDurationMs: optionalMilliseconds(chunk.load_duration),
		totalDurationMs: optionalMilliseconds(chunk.total_duration),
	};
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
	return numberOrZero(value) > 0 ? numberOrZero(value) : undefined;
}

function nanosecondsToMilliseconds(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value / 1_000_000 : 0;
}

function optionalMilliseconds(value: unknown): number | undefined {
	const converted = nanosecondsToMilliseconds(value);
	return converted > 0 ? converted : undefined;
}

async function* readNdjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (line.trim()) yield line;
			}
		}
		buffer += decoder.decode();
		if (buffer.trim()) yield buffer;
	} finally {
		reader.releaseLock();
	}
}
