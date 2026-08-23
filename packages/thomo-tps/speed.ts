export interface ResponseSpeedInfo {
	tokensPerSecond?: number;
	outputTokens: number;
	durationMs: number;
	responseCount: number;
	inProgress: boolean;
}

export interface ResponseSpeedAggregate {
	totalOutputTokens: number;
	totalDurationMs: number;
	responseCount: number;
}

export interface CurrentResponseSpeed {
	outputTokens: number;
	durationMs: number;
	inProgress: boolean;
}

export function createEmptyResponseSpeedAggregate(): ResponseSpeedAggregate {
	return {
		totalOutputTokens: 0,
		totalDurationMs: 0,
		responseCount: 0,
	};
}

export function addCompletedResponseSpeed(
	aggregate: ResponseSpeedAggregate,
	outputTokens: number,
	durationMs: number,
): ResponseSpeedAggregate {
	if (outputTokens <= 0 || durationMs <= 0) return aggregate;

	return {
		totalOutputTokens: aggregate.totalOutputTokens + outputTokens,
		totalDurationMs: aggregate.totalDurationMs + durationMs,
		responseCount: aggregate.responseCount + 1,
	};
}

export function calculateTokensPerSecond(tokens: number, durationMs: number): number | undefined {
	if (tokens <= 0 || durationMs <= 0) return undefined;
	return tokens / (durationMs / 1000);
}

export function getAverageResponseSpeed(
	completed: ResponseSpeedAggregate,
	current?: CurrentResponseSpeed,
): ResponseSpeedInfo | undefined {
	const hasCurrentData = current !== undefined && current.outputTokens > 0 && current.durationMs > 0;
	const outputTokens = completed.totalOutputTokens + (hasCurrentData ? current.outputTokens : 0);
	const durationMs = completed.totalDurationMs + (hasCurrentData ? current.durationMs : 0);
	const responseCount = completed.responseCount + (hasCurrentData ? 1 : 0);
	const inProgress = current?.inProgress ?? false;
	const tokensPerSecond = calculateTokensPerSecond(outputTokens, durationMs);

	if (tokensPerSecond === undefined && !inProgress) return undefined;

	return {
		tokensPerSecond,
		outputTokens,
		durationMs,
		responseCount,
		inProgress,
	};
}

export function formatTokensPerSecond(tokensPerSecond: number): string {
	if (tokensPerSecond < 100) return tokensPerSecond.toFixed(1);
	return Math.round(tokensPerSecond).toString();
}

export function formatSpeedLabel(speed: ResponseSpeedInfo | undefined): string {
	if (!speed) return "--t/s";
	const value = speed.tokensPerSecond === undefined ? "--" : formatTokensPerSecond(speed.tokensPerSecond);
	return `${value}t/s`;
}

export function estimateTokens(text: string): number {
	return Math.max(1, text.length / 4);
}

export function estimateAssistantOutputTokens(
	message: { content: Array<{ type: string; text?: string; thinking?: string; arguments?: unknown }> },
): number {
	let characters = 0;
	for (const block of message.content) {
		if (block.type === "text") characters += block.text?.length ?? 0;
		else if (block.type === "thinking") characters += block.thinking?.length ?? 0;
		else if (block.type === "toolCall") characters += JSON.stringify(block.arguments ?? {}).length;
	}
	return Math.ceil(characters / 4);
}
