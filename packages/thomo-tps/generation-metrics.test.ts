import test from "node:test";
import assert from "node:assert/strict";
import {
	calculateGenerationTokensPerSecond,
	readGenerationMetrics,
} from "./generation-metrics.ts";

test("validates backend-neutral generation metrics and converts them to TPS", () => {
	const metrics = readGenerationMetrics({
		generationMetrics: {
			source: "ollama",
			outputTokens: 25,
			decodeDurationMs: 500,
			promptTokens: 12,
		},
	});
	assert.deepEqual(metrics, {
		source: "ollama",
		outputTokens: 25,
		decodeDurationMs: 500,
		promptTokens: 12,
		promptDurationMs: undefined,
		loadDurationMs: undefined,
		totalDurationMs: undefined,
	});
	assert.equal(calculateGenerationTokensPerSecond(metrics), 50);
});

test("ignores malformed or unusable provider metrics", () => {
	assert.equal(readGenerationMetrics({ generationMetrics: { source: "ollama", outputTokens: -1, decodeDurationMs: 1 } }), undefined);
	assert.equal(readGenerationMetrics({ generationMetrics: { source: "ollama", outputTokens: 1, decodeDurationMs: 0 } }), undefined);
	assert.equal(calculateGenerationTokensPerSecond(undefined), undefined);
	assert.equal(calculateGenerationTokensPerSecond({ source: "ollama", outputTokens: 1, decodeDurationMs: 0 }), undefined);
});
