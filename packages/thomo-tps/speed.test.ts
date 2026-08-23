import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	addCompletedResponseSpeed,
	calculateTokensPerSecond,
	createEmptyResponseSpeedAggregate,
	formatSpeedLabel,
	getAverageResponseSpeed,
} from "./speed.ts";

describe("thomo-tps speed calculation", () => {
	it("calculates tokens per second from output tokens and duration", () => {
		assert.equal(calculateTokensPerSecond(120, 4_000), 30);
		assert.equal(calculateTokensPerSecond(0, 4_000), undefined);
		assert.equal(calculateTokensPerSecond(120, 0), undefined);
	});

	it("averages responses by total tokens and total duration", () => {
		let aggregate = createEmptyResponseSpeedAggregate();
		aggregate = addCompletedResponseSpeed(aggregate, 100, 2_000);
		aggregate = addCompletedResponseSpeed(aggregate, 300, 8_000);

		assert.deepEqual(getAverageResponseSpeed(aggregate), {
			tokensPerSecond: 40,
			outputTokens: 400,
			durationMs: 10_000,
			responseCount: 2,
			inProgress: false,
		});
	});

	it("includes the active response in the displayed average", () => {
		const aggregate = addCompletedResponseSpeed(createEmptyResponseSpeedAggregate(), 100, 2_000);
		const speed = getAverageResponseSpeed(aggregate, {
			outputTokens: 50,
			durationMs: 1_000,
			inProgress: true,
		});

		assert.equal(speed?.tokensPerSecond, 50);
		assert.equal(speed?.inProgress, true);
		assert.equal(formatSpeedLabel(speed), "50.0t/s");
	});

	it("formats high speeds without unnecessary decimals", () => {
		assert.equal(formatSpeedLabel({ tokensPerSecond: 125, outputTokens: 1, durationMs: 1, responseCount: 1, inProgress: false }), "125t/s");
	});
});
