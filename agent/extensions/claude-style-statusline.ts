/**
 * Claude-style status line for pi.
 *
 * Порт ~/.claude/statusline.js в виде pi-расширения.
 * Формат (ровно как в Claude Code):
 *   MODEL(#CC89A2) | PATH(blue/magenta leaf) | ctx: PCT% | 5h: PCT% [bar] ↻ reset  7d: PCT% [bar] ↻ reset
 *
 * Источники данных:
 *   - model, path, ctx — из pi ExtensionContext (ctx.model, ctx.cwd, ctx.getContextUsage).
 *   - 5h / 7d quota — GET https://www.minimax.io/v1/token_plan/remains,
 *     bearer token берётся из ctx.modelRegistry.getApiKeyForProvider("minimax").
 *     Fallback: ANTHROPIC_AUTH_TOKEN из env (как в Claude settings.json).
 *     Кеш: ~/.pi/agent/.cache/minimax_quota.json, TTL 60s.
 *
 * Цвета pct: green<70 / yellow<90 / red≥90.
 * Мини-бар: 5 клеток, плоский цвет для 5h/7d.
 *
 * Виджет ставится НАД редактором (как у wierd-statusline), чтобы не было
 * пустой строки между ним и самим редактором, нижняя граница редактора
 * скрывается.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ─── ANSI helpers ────────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const WHITE = "\x1b[37m";

// ─── Константы отображения ───────────────────────────────────────────────
const FILLED = "█";
const EMPTY = "▫";
const MINI_BAR_WIDTH = 5;

const CACHE_TTL_MS = 60_000;
const QUOTA_TIMEOUT_MS = 5_000;
const TICK_MS = 1_000; // период перерисовки виджета, чтобы `↻` тикал в реальном времени
const PROVIDER = "minimax";

// ─── Кеш путь ────────────────────────────────────────────────────────────
function getCachePath(): string {
	const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
	return join(homeDir, ".pi", "agent", ".cache", "minimax_quota.json");
}

// ─── Типы ответа API ────────────────────────────────────────────────────
interface ModelRemains {
	model_name: string;
	current_interval_status: number;
	current_interval_remaining_percent: number;
	current_weekly_status: number;
	current_weekly_remaining_percent: number;
	remains_time: number;
	weekly_remains_time: number;
	[key: string]: unknown;
}

interface QuotaResponse {
	model_remains?: ModelRemains[];
	[key: string]: unknown;
}

// ─── Quota state (union, чтобы renderer знал что показывать) ─────────────
// `ts` в ok-варианте — момент последнего успешного fetch, от него renderer
// пересчитывает обратный отсчёт `↻` каждую секунду без новых HTTP-запросов.
type QuotaState =
	| { kind: "no-key" }
	| { kind: "error" }
	| { kind: "loading"; previous?: QuotaResponse }
	| { kind: "ok"; data: QuotaResponse; ts: number };

// ─── ANSI helpers impl ───────────────────────────────────────────────────
function rgbEscape(r: number, g: number, b: number): string {
	return `\x1b[38;2;${r};${g};${b}m`;
}

// Розовый #CC89A2 — цвет имени модели в Claude статуслайне (true-color)
const MODEL_COLOR = rgbEscape(204, 137, 162);

/**
 * Раскрашивает displayPath: всё кроме последней директории — BLUE,
 * последняя директория (leaf) — MAGENTA. Разделитель остаётся в BLUE.
 * (Идентично ~/.claude/statusline.js → colorPath)
 */
function colorPath(displayPath: string): string {
	if (!displayPath) return "";
	const lastSep = Math.max(
		displayPath.lastIndexOf("/"),
		displayPath.lastIndexOf("\\"),
	);
	if (lastSep === -1) {
		return `${MAGENTA}${displayPath}${RESET}`;
	}
	const head = displayPath.slice(0, lastSep + 1);
	const tail = displayPath.slice(lastSep + 1);
	if (tail === "") {
		return `${BLUE}${displayPath}${RESET}`;
	}
	return `${BLUE}${head}${RESET}${MAGENTA}${tail}${RESET}`;
}

/** "4h 35m" / "11h" / "2d 11h" / "35m" / "now". */
function formatResetTime(ms: number | null | undefined): string {
	if (ms == null || ms <= 0) return "now";
	const totalSec = Math.floor(ms / 1000);
	const days = Math.floor(totalSec / 86400);
	const hours = Math.floor((totalSec % 86400) / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) {
		if (minutes > 0) return `${hours}h ${minutes}m`;
		return `${hours}h`;
	}
	return `${minutes}m`;
}

/** Сокращение пути: заменяет домашнюю директорию на ~. */
function shortenCwd(cwd: string): string {
	const user = process.env.USER || process.env.USERNAME || "";
	const home = process.env.HOME || process.env.USERPROFILE || homedir();
	const candidates = [
		`C:/Users/${user}`,
		`/c/Users/${user}`,
		`/Users/${user}`,
		home,
	].filter(Boolean);
	for (const prefix of candidates) {
		if (prefix && cwd.startsWith(prefix)) {
			return "~" + cwd.slice(prefix.length);
		}
	}
	return cwd;
}

/** Мини-бар: плоский цвет (для 5h/7d), не градиент. */
function renderMiniBar(pct: number, fillColor: string): string {
	const filledCount = Math.min(
		MINI_BAR_WIDTH,
		Math.floor((pct * MINI_BAR_WIDTH) / 100),
	);
	let s = "";
	for (let i = 0; i < MINI_BAR_WIDTH; i++) {
		if (i < filledCount) {
			s += `${fillColor}${FILLED}${RESET}`;
		} else {
			s += `${GRAY}${EMPTY}${RESET}`;
		}
	}
	return s;
}

// ─── Cache I/O ───────────────────────────────────────────────────────────
interface CacheRecord {
	ts: number;
	data: QuotaResponse;
}

function readCache(): { data: QuotaResponse; ts: number } | null {
	try {
		const raw = readFileSync(getCachePath(), "utf8");
		const obj = JSON.parse(raw) as CacheRecord;
		if (Date.now() - obj.ts < CACHE_TTL_MS) return { data: obj.data, ts: obj.ts };
	} catch {
		/* файла нет или битый */
	}
	return null;
}

function writeCache(data: QuotaResponse): void {
	try {
		const path = getCachePath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ ts: Date.now(), data }));
	} catch {
		/* permission denied и т.п. — best effort */
	}
}

// ─── HTTP fetch (минимальный HTTPS клиент, без зависимостей) ──────────────
function fetchQuota(token: string): Promise<QuotaResponse> {
	return new Promise((resolve, reject) => {
		const req = fetch("https://www.minimax.io/v1/token_plan/remains", {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
		});
		req.then(
			async (res) => {
				if (res.status !== 200) {
					reject(new Error(`HTTP ${res.status}`));
					return;
				}
				try {
					const data = (await res.json()) as QuotaResponse;
					resolve(data);
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				}
			},
			(err) => reject(err instanceof Error ? err : new Error(String(err))),
		);
	});
}

/** Получить токен: сначала через ctx.modelRegistry, fallback на env. */
async function resolveToken(ctx: ExtensionContext): Promise<string> {
	try {
		const fromRegistry = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
		if (fromRegistry) return fromRegistry;
	} catch {
		/* registry недоступен — fallback ниже */
	}
	return process.env.ANTHROPIC_AUTH_TOKEN || "";
}

/** Загрузить quota: cache → fetch → cache. Не бросает. */
async function loadQuota(ctx: ExtensionContext): Promise<QuotaState> {
	const token = await resolveToken(ctx);
	if (!token) return { kind: "no-key" };

	const cached = readCache();
	if (cached) return { kind: "ok", data: cached.data, ts: cached.ts };

	try {
		const data = await fetchQuota(token);
		const ts = Date.now();
		writeCache(data);
		return { kind: "ok", data, ts };
	} catch {
		return { kind: "error" };
	}
}

/** Превью для renderer'а: какую запись из model_remains использовать. */
function pickGeneral(remains: ModelRemains[]): ModelRemains | undefined {
	const general = remains.find((m) => m.model_name === "general");
	return general ?? remains[0];
}

// ─── Renderer ────────────────────────────────────────────────────────────
interface RenderInput {
	modelName: string;
	displayPath: string;
	ctxPercent: number;
	quota: QuotaState;
}

function pctColor(pct: number): string {
	if (pct >= 90) return RED;
	if (pct >= 70) return YELLOW;
	return GREEN;
}

function renderQuotaSegment(quota: QuotaState): string {
	if (quota.kind === "no-key" || quota.kind === "error" || quota.kind === "loading") {
		return `${GRAY}—${RESET}`;
	}
	const data = quota.data;
	const remains = Array.isArray(data.model_remains) ? data.model_remains : [];
	const general = pickGeneral(remains);
	if (!general) return `${GRAY}n/a${RESET}`;

	// status === 0 → окно исчерпано, показываем 100% (бар заполнится, pct красный).
	const rem5h =
		general.current_interval_status === 0
			? 0
			: general.current_interval_remaining_percent;
	const remWk =
		general.current_weekly_status === 0
			? 0
			: general.current_weekly_remaining_percent;
	if (rem5h == null || remWk == null) return `${GRAY}n/a${RESET}`;

	const pct5h = Math.floor(100 - rem5h);
	const pctWk = Math.floor(100 - remWk);
	const color5h = pctColor(pct5h);
	const colorWk = pctColor(pctWk);
	// `remains_time` — «осталось мс на момент fetch», вычитаем прошедшее с тех пор,
	// чтобы `↻` тикал вниз каждую секунду даже между HTTP-запросами.
	const ageMs = quota.kind === "ok" ? Date.now() - quota.ts : 0;
	const reset5h = formatResetTime(general.remains_time - ageMs);
	const resetWk = formatResetTime(general.weekly_remains_time - ageMs);

	return (
		`${WHITE}5h: ${RESET}${color5h}${pct5h}%${RESET} ` +
		`${GRAY}[${RESET}${renderMiniBar(pct5h, color5h)}${GRAY}] ${RESET}` +
		`${GRAY}↻ ${reset5h}${RESET}  ` +
		`${WHITE}7d: ${RESET}${colorWk}${pctWk}%${RESET} ` +
		`${GRAY}[${RESET}${renderMiniBar(pctWk, colorWk)}${GRAY}] ${RESET}` +
		`${GRAY}↻ ${resetWk}${RESET}`
	);
}

function renderStatusLine(input: RenderInput): string {
	const ctxColor = pctColor(input.ctxPercent);
	const out =
		`${MODEL_COLOR}${input.modelName}${RESET}` +
		`${GRAY} | ${RESET}` +
		`${colorPath(input.displayPath)}` +
		`${GRAY} | ${RESET}` +
		`${WHITE}ctx: ${RESET}${ctxColor}${input.ctxPercent}%${RESET}` +
		`${GRAY} | ${RESET}` +
		`${renderQuotaSegment(input.quota)}\n`;
	return out;
}

// ─── Pi extension glue ───────────────────────────────────────────────────

// Два независимых таймера:
//   refreshTimer — раз в 60с обновляет кеш через HTTP (обновляет проценты).
//   tickTimer    — раз в 1с  переустанавливает виджет → render() дёргается заново,
//                  `↻` пересчитывается локально от refreshTimer-кэша.
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;

class ClaudeStatusLine implements Component {
	constructor(private readonly ctx: ExtensionContext) {}

	invalidate(): void {
		// Не инвалидируем кеш quota — он сам управляется TTL.
	}

	dispose(): void {
		// Никаких подписок не держим.
	}

	render(_width: number): string[] {
		const modelName = this.ctx.model?.id ?? "no-model";
		const displayPath = shortenCwd(this.ctx.cwd);
		const usage = this.ctx.getContextUsage();
		const ctxPercent =
			typeof usage?.percent === "number"
				? Math.floor(usage.percent)
				: 0;

		// Берём кеш напрямую — он уже синхронный.
		// Свежесть гарантирует фоновый refreshTimer + первая загрузка
		// из installStatusWidget ниже. ts нужен renderer'у, чтобы
		// пересчитывать `↻` от момента последнего fetch.
		const cached = readCache();
		const quota: QuotaState = cached
			? { kind: "ok", data: cached.data, ts: cached.ts }
			: { kind: "loading" };

		const input: RenderInput = {
			modelName,
			displayPath,
			ctxPercent,
			quota,
		};

		return [renderStatusLine(input).replace(/\n$/, "")];
	}
}

/**
 * Пустой footer. Передаём в setFooter() чтобы СКРЫТЬ дефолтный footer pi
 * со всеми setStatus-индикаторами (path / tokens / cost / model / MCP и т.п.).
 *
 * ВАЖНО: setFooter(undefined) делает ОБРАТНОЕ — восстанавливает дефолтный
 * footer со всеми индикаторами (см. interactive-mode.js → setExtensionFooter).
 * Чтобы реально скрыть, нужен factory, возвращающий пустой компонент
 * (так делает wierd-statusline через EmptyFooter).
 */
class EmptyFooter implements Component {
	invalidate(): void {}
	dispose(): void {}
	render(): string[] {
		return [];
	}
}

function hidePiFooter(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setFooter(() => new EmptyFooter());
}

async function refreshQuotaOnce(ctx: ExtensionContext): Promise<void> {
	const state = await loadQuota(ctx);
	// Если получили ok — кеш уже записан внутри loadQuota.
	// Если error/no-key — кеш не пишем, renderer покажет "—" / "n/a".
	void state;
}

function installStatusWidget(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	ctx.ui.setWidget(
		"claude-style-statusline",
		() => new ClaudeStatusLine(ctx),
		{ placement: "aboveEditor" },
	);
}

function startBackgroundRefresh(ctx: ExtensionContext): void {
	if (refreshTimer) return;
	// Первый прогон сразу, потом по таймеру.
	void refreshQuotaOnce(ctx);
	refreshTimer = setInterval(() => {
		void refreshQuotaOnce(ctx);
	}, CACHE_TTL_MS);
	// unref чтобы таймер не блокировал exit процесса
	if (typeof refreshTimer.unref === "function") refreshTimer.unref();
}

function stopBackgroundRefresh(): void {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}

function startTickRefresh(ctx: ExtensionContext): void {
	if (tickTimer) return;
	tickTimer = setInterval(() => {
		// ctx.ui не отдаёт requestRender напрямую (см. комментарий выше) —
		// переустановка виджета — единственный публичный способ заставить pi
		// перерисовать компонент. Перерисовка читает свежий ctx и пересчитывает
		// `↻` от cache.ts → минуты тикают вниз каждую секунду.
		installStatusWidget(ctx);
	}, TICK_MS);
	if (typeof tickTimer.unref === "function") tickTimer.unref();
}

function stopTickRefresh(): void {
	if (tickTimer) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		installStatusWidget(ctx);
		startBackgroundRefresh(ctx);
		startTickRefresh(ctx);
		// Скрываем дефолтный footer pi (path / tokens / cost / model / MCP).
		// setFooter(undefined) его восстанавливает, поэтому передаём
		// factory с пустым компонентом.
		hidePiFooter(ctx);
	});

	pi.on("session_shutdown", async () => {
		stopBackgroundRefresh();
		stopTickRefresh();
	});

	// ctx.ui не даёт requestRender напрямую. Переустановка виджета —
	// единственный публичный способ заставить pi перерисовать наш
	// компонент после смены модели / нового usage. Компонент читает
	// свежий ctx в каждом render(), так что новые данные подхватятся.
	pi.on("model_select", async (_event, ctx) => {
		installStatusWidget(ctx);
	});

	pi.on("message_end", async (_event, ctx) => {
		installStatusWidget(ctx);
	});
}