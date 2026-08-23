export const GENERATION_METRICS_PROPERTY = "generationMetrics";

/** Backend-neutral server-side generation timings attached to an assistant message. */
export interface GenerationMetrics {
	source: string;
	outputTokens: number;
	decodeDurationMs: number;
	promptTokens?: number;
	promptDurationMs?: number;
	loadDurationMs?: number;
	totalDurationMs?: number;
}

export function readGenerationMetrics(message: unknown): GenerationMetrics | undefined {
	if (!message || typeof message !== "object") return undefined;
	const candidate = (message as Record<string, unknown>)[GENERATION_METRICS_PROPERTY];
	if (!candidate || typeof candidate !== "object") return undefined;

	const metrics = candidate as Record<string, unknown>;
	if (
		typeof metrics.source !== "string" ||
		metrics.source.length === 0 ||
		!isPositiveFiniteNumber(metrics.outputTokens) ||
		!isPositiveFiniteNumber(metrics.decodeDurationMs)
	) {
		return undefined;
	}

	return {
		source: metrics.source,
		outputTokens: metrics.outputTokens,
		decodeDurationMs: metrics.decodeDurationMs,
		promptTokens: optionalNonNegativeNumber(metrics.promptTokens),
		promptDurationMs: optionalNonNegativeNumber(metrics.promptDurationMs),
		loadDurationMs: optionalNonNegativeNumber(metrics.loadDurationMs),
		totalDurationMs: optionalNonNegativeNumber(metrics.totalDurationMs),
	};
}

export function calculateGenerationTokensPerSecond(metrics: GenerationMetrics | undefined): number | undefined {
	if (!metrics || metrics.outputTokens <= 0 || metrics.decodeDurationMs <= 0) return undefined;
	return metrics.outputTokens / (metrics.decodeDurationMs / 1000);
}

function isPositiveFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
	return isNonNegativeFiniteNumber(value) ? value : undefined;
}
