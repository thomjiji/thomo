import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	addCompletedResponseSpeed,
	calculateTokensPerSecond,
	createEmptyResponseSpeedAggregate,
	estimateAssistantOutputTokens,
	estimateTokens,
	formatSpeedLabel,
	getAverageResponseSpeed,
	speedColor,
	type ResponseSpeedAggregate,
	type ResponseSpeedInfo,
} from "./speed.ts";

const SPEED_RENDER_THROTTLE_MS = 250;

interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
}

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export default function tpsExtension(pi: ExtensionAPI) {
	let responseSpeed: ResponseSpeedInfo | undefined;
	let completedResponseSpeed = createEmptyResponseSpeedAggregate();
	let responseStartMs: number | undefined;
	let liveOutputTokenEstimate = 0;
	let lastSpeedRender = 0;
	let renderRequested: (() => void) | undefined;
	let mountedCtx: ExtensionContext | undefined;

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		mountedCtx = ctx;
		mount(ctx);
	});

	pi.on("session_shutdown", async () => {
		mountedCtx?.ui.setFooter(undefined);
		mountedCtx = undefined;
		renderRequested = undefined;
		resetResponseSpeed();
	});

	pi.on("model_select", async () => {
		resetResponseSpeed();
		requestRender();
	});

	pi.on("thinking_level_select", async () => {
		resetResponseSpeed();
		requestRender();
	});

	pi.on("message_start", async (event) => {
		if (event.message.role !== "assistant") return;

		responseStartMs = Date.now();
		liveOutputTokenEstimate = 0;
		responseSpeed = getAverageResponseSpeed(completedResponseSpeed, {
			outputTokens: 0,
			durationMs: 0,
			inProgress: true,
		});
		requestRender();
	});

	pi.on("message_update", async (event) => {
		if (event.message.role !== "assistant" || responseStartMs === undefined) return;

		const streamEvent = event.assistantMessageEvent;
		if (
			streamEvent.type === "text_delta" ||
			streamEvent.type === "thinking_delta" ||
			streamEvent.type === "toolcall_delta"
		) {
			liveOutputTokenEstimate += estimateTokens(streamEvent.delta);
		}

		const durationMs = Date.now() - responseStartMs;
		responseSpeed = getAverageResponseSpeed(completedResponseSpeed, {
			outputTokens: Math.round(liveOutputTokenEstimate),
			durationMs,
			inProgress: true,
		});
		requestSpeedRender();
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") {
			requestRender();
			return;
		}

		const durationMs = responseStartMs === undefined ? 0 : Date.now() - responseStartMs;
		const outputTokens =
			event.message.usage?.output ||
			estimateAssistantOutputTokens(event.message) ||
			Math.round(liveOutputTokenEstimate);
		if (responseStartMs !== undefined) {
			completedResponseSpeed = addCompletedResponseSpeed(completedResponseSpeed, outputTokens, durationMs);
		}
		responseSpeed = getAverageResponseSpeed(completedResponseSpeed);
		responseStartMs = undefined;
		liveOutputTokenEstimate = 0;
		requestRender();
	});

	function mount(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const request = () => tui.requestRender();
			const unsubscribeBranch = footerData.onBranchChange(request);
			renderRequested = request;

			return {
				dispose() {
					unsubscribeBranch();
					if (renderRequested === request) renderRequested = undefined;
				},
				invalidate() {
					tui.requestRender();
				},
				render(width: number): string[] {
					return renderFooter(ctx, pi, theme, footerData, width, responseSpeed);
				},
			};
		});
	}

	function requestRender(): void {
		renderRequested?.();
	}

	function requestSpeedRender(): void {
		const now = Date.now();
		if (now - lastSpeedRender < SPEED_RENDER_THROTTLE_MS) return;
		lastSpeedRender = now;
		requestRender();
	}

	function resetResponseSpeed(): void {
		responseSpeed = undefined;
		completedResponseSpeed = createEmptyResponseSpeedAggregate();
		responseStartMs = undefined;
		liveOutputTokenEstimate = 0;
		lastSpeedRender = 0;
	}
}

function renderFooter(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	theme: ExtensionContext["ui"]["theme"],
	footerData: ReadonlyFooterDataProvider,
	width: number,
	responseSpeed: ResponseSpeedInfo | undefined,
): string[] {
	const safeWidth = Math.max(1, width);
	const totals = collectUsageTotals(ctx);
	const contextUsage = ctx.getContextUsage?.();
	const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	const contextPercentValue = contextUsage?.percent ?? 0;
	const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

	let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
	const branch = footerData.getGitBranch();
	if (branch) pwd = `${pwd} (${branch})`;
	const sessionName = ctx.sessionManager.getSessionName();
	if (sessionName) pwd = `${pwd} • ${sessionName}`;

	const statsParts: string[] = [];
	if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
	if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && totals.latestCacheHitRate !== undefined) {
		statsParts.push(`CH${totals.latestCacheHitRate.toFixed(1)}%`);
	}

	const usingSubscription = isSubscriptionProvider(ctx);
	if (totals.cost || usingSubscription) {
		statsParts.push(`$${totals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}

	const autoIndicator = " (auto)";
	const contextPercentDisplay =
		contextPercent === "?"
			? `?/${formatTokens(contextWindow)}${autoIndicator}`
			: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
	const contextColor = contextPercentValue > 90 ? "error" : contextPercentValue > 70 ? "warning" : undefined;
	statsParts.push(contextColor ? theme.fg(contextColor, contextPercentDisplay) : contextPercentDisplay);

	let statsLeft = statsParts.join(" ");
	let statsLeftWidth = visibleWidth(statsLeft);
	if (statsLeftWidth > safeWidth) {
		statsLeft = truncateToWidth(statsLeft, safeWidth, "...");
		statsLeftWidth = visibleWidth(statsLeft);
	}

	const modelName = ctx.model?.id || "no-model";
	const thinkingLevel = ctx.thinkingLevel ?? pi.getThinkingLevel?.() ?? "off";
	let rightSideWithoutProvider = modelName;
	if (ctx.model?.reasoning) {
		rightSideWithoutProvider =
			thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
	}
	let modelSide = rightSideWithoutProvider;
	if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
		modelSide = `(${ctx.model.provider}) ${rightSideWithoutProvider}`;
	}

	const speedLabel = formatSpeedLabel(responseSpeed);
	const speedWidth = visibleWidth(speedLabel);
	const gap = 2;
	const availableRight = Math.max(0, safeWidth - statsLeftWidth - gap);
	const modelBudget = Math.max(0, availableRight - speedWidth - gap);
	const visibleModel = modelBudget > 0 ? truncateToWidth(modelSide, modelBudget, "") : "";
	const visibleSpeed = truncateToWidth(speedLabel, availableRight, "");
	const rightPlain = visibleModel ? `${visibleSpeed}${" ".repeat(gap)}${visibleModel}` : visibleSpeed;
	const rightWidth = visibleWidth(rightPlain);
	const padding = Math.max(0, safeWidth - statsLeftWidth - rightWidth);
	const dimStatsLeft = theme.fg("dim", statsLeft);
	const speedText = visibleSpeed ? theme.fg(speedColor(responseSpeed), visibleSpeed) : "";
	const modelText = visibleModel ? `${" ".repeat(gap)}${theme.fg("dim", visibleModel)}` : "";
	const statsLine = `${dimStatsLeft}${" ".repeat(padding)}${speedText}${modelText}`;

	const pwdLine = truncateToWidth(theme.fg("dim", pwd), safeWidth, theme.fg("dim", "..."));
	const lines = [pwdLine, statsLine];
	const extensionStatuses = Array.from(footerData.getExtensionStatuses().entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusText(text));
	if (extensionStatuses.length > 0) {
		lines.push(truncateToWidth(extensionStatuses.join(" "), safeWidth, theme.fg("dim", "...")));
	}
	return lines;
}

function collectUsageTotals(ctx: ExtensionContext): UsageTotals & { latestCacheHitRate?: number } {
	const totals: UsageTotals & { latestCacheHitRate?: number } = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};

	for (const rawEntry of ctx.sessionManager.getEntries()) {
		const entry = rawEntry as {
			type?: string;
			message?: { role?: string; usage?: UsageLike };
			usage?: UsageLike;
		};
		if (entry.type === "message" && entry.message?.role === "assistant") {
			addUsage(totals, entry.message.usage);
			const usage = entry.message.usage;
			if (usage) {
				const latestPromptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
				totals.latestCacheHitRate = latestPromptTokens > 0 ? ((usage.cacheRead ?? 0) / latestPromptTokens) * 100 : undefined;
			}
		} else if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message.usage) {
			addUsage(totals, entry.message.usage);
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return totals;
}

function isSubscriptionProvider(ctx: ExtensionContext): boolean {
	const provider = ctx.model?.provider;
	if (!provider) return false;
	if (provider === "kimi-coding") return true;
	return ctx.modelRegistry.getProvider(provider)?.auth?.oauth?.isSubscription === true;
}

function addUsage(totals: UsageTotals, usage: UsageLike | undefined): void {
	if (!usage) return;
	totals.input += usage.input ?? 0;
	totals.output += usage.output ?? 0;
	totals.cacheRead += usage.cacheRead ?? 0;
	totals.cacheWrite += usage.cacheWrite ?? 0;
	totals.cost += usage.cost?.total ?? 0;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export {
	addCompletedResponseSpeed,
	calculateTokensPerSecond,
	createEmptyResponseSpeedAggregate,
	estimateAssistantOutputTokens,
	estimateTokens,
	formatSpeedLabel,
	getAverageResponseSpeed,
	speedColor,
};

export type { ResponseSpeedAggregate, ResponseSpeedInfo };
