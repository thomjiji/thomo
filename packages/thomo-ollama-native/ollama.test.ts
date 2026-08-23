import test from "node:test";
import assert from "node:assert/strict";
import {
	buildOllamaRequest,
	discoverOllamaModels,
	getOllamaChatUrl,
	getOllamaTagsUrl,
	parseModelNames,
	streamOllama,
} from "./ollama.ts";

class FakeStream {
	events: unknown[] = [];
	ended = false;

	push(event: unknown) {
		this.events.push(event);
	}

	end() {
		this.ended = true;
	}
}

function model() {
	return {
		id: "qwen3:8b",
		name: "qwen3:8b (Ollama native)",
		api: "ollama-native",
		provider: "ollama-native",
		baseUrl: "http://127.0.0.1:11434",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 32768,
		thinkingLevelMap: { low: "low", medium: "medium", high: "high" },
	};
}

async function waitForEnd(stream: FakeStream): Promise<void> {
	for (let attempt = 0; attempt < 100 && !stream.ended; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	assert.equal(stream.ended, true);
}

test("builds native requests with explicit thinking and multimodal/tool messages", () => {
	const request = buildOllamaRequest(model(), {
		systemPrompt: "Be concise",
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Read this" },
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
				],
				timestamp: 1,
			},
		],
		tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
	}, { maxTokens: 100, reasoning: undefined });

	assert.equal(getOllamaChatUrl("http://localhost:11434/"), "http://localhost:11434/api/chat");
	assert.equal(getOllamaTagsUrl("http://localhost:11434/api"), "http://localhost:11434/api/tags");
	assert.equal(request.think, false);
	assert.equal(request.options?.num_predict, 100);
	assert.deepEqual(request.messages[1], {
		role: "user",
		content: "Read this",
		images: ["aW1hZ2U="],
	});
	assert.deepEqual(request.tools?.[0]?.function.name, "search");

	const thinkingRequest = buildOllamaRequest(model(), { messages: [] }, { reasoning: "medium" });
	assert.equal(thinkingRequest.think, "medium");
	assert.equal(buildOllamaRequest(model(), { messages: [] }, { reasoning: "high" }).think, "high");
});

test("deduplicates explicit model names", () => {
	assert.deepEqual(parseModelNames(" qwen3:8b, llama3, qwen3:8b ,,"), ["qwen3:8b", "llama3"]);
});

test("discovers models from Ollama tags without requiring a live server", async () => {
	const requests: string[] = [];
	const models = await discoverOllamaModels("http://localhost:11434", undefined, async (url) => {
		requests.push(String(url));
		return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "" }, { name: "llama3" }] }), { status: 200 });
	});
	assert.deepEqual(requests, ["http://localhost:11434/api/tags"]);
	assert.deepEqual(models.map((entry) => entry.id), ["qwen3:8b", "llama3"]);
});

test("maps thinking, text, tool calls, stop reason, and Ollama timings", async () => {
	const stream = new FakeStream();
	const body = [
		JSON.stringify({ message: { thinking: "plan" }, done: false }),
		JSON.stringify({ message: { thinking: " then", content: "answer" }, done: false }),
		JSON.stringify({
			message: { tool_calls: [{ function: { name: "search", arguments: '{"query":"pi"' } }] },
			done: false,
		}),
		JSON.stringify({ message: { tool_calls: [{ function: { arguments: "}" } }] }, done: false }),
		JSON.stringify({
			model: "qwen3:8b",
			done: true,
			done_reason: "tool_calls",
			prompt_eval_count: 12,
			prompt_eval_duration: 2_000_000,
			eval_count: 25,
			eval_duration: 500_000_000,
			load_duration: 100_000_000,
			total_duration: 700_000_000,
		}),
	].join("\n");

	streamOllama(
		model(),
		{ messages: [] },
		{ fetch: async () => new Response(body, { status: 200 }), reasoning: "low" },
		() => stream,
	);
	await waitForEnd(stream);

	const done = stream.events.find((event) => (event as { type?: string }).type === "done") as { message: any } | undefined;
	assert.equal((done?.message as { stopReason?: string })?.stopReason, "toolUse");
	assert.deepEqual((done?.message as { usage?: unknown })?.usage, {
		input: 12,
		output: 25,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 37,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
	assert.deepEqual((done?.message as any).content, [
		{ type: "thinking", thinking: "plan then" },
		{ type: "text", text: "answer" },
		{ type: "toolCall", id: "ollama-tool-0", name: "search", arguments: { query: "pi" } },
	]);
	assert.deepEqual((done?.message as any).generationMetrics, {
		source: "ollama",
		outputTokens: 25,
		decodeDurationMs: 500,
		promptTokens: 12,
		promptDurationMs: 2,
		loadDurationMs: 100,
		totalDurationMs: 700,
	});
	assert.equal(stream.events.filter((event) => (event as { type?: string }).type === "toolcall_end").length, 1);
});

test("turns an incomplete stream into an error instead of a false successful stop", async () => {
	const stream = new FakeStream();
	streamOllama(
		model(),
		{ messages: [] },
		{ fetch: async () => new Response(JSON.stringify({ message: { content: "partial" }, done: false }), { status: 200 }) },
		() => stream,
	);
	await waitForEnd(stream);
	assert.equal(stream.events.some((event) => (event as { type?: string }).type === "done"), false);
	const error = stream.events.find((event) => (event as { type?: string }).type === "error") as { error?: { errorMessage?: string } };
	assert.match(error.error?.errorMessage ?? "", /before the final done chunk/);
});
