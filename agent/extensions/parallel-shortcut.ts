/**
 * /parallel — spawn multiple gotgenes subagents in parallel.
 *
 * Syntax:
 *   /parallel <type1> "task 1" -> <type2> "task 2" -> <type3> "task 3"
 *
 * Implementation note:
 *   @gotgenes/pi-subagents (the version this user has installed) does NOT
 *   implement the cross-extension RPC that tintinweb upstream has — there is
 *   no `subagents:ready` event, no `subagents:rpc:spawn`, nothing.
 *   Gotgenes only exposes the `Agent` tool to the LLM. So we cannot spawn
 *   directly. Instead, we inject a natural-language message via
 *   `pi.sendUserMessage()`. The parent LLM parses it and makes N separate
 *   `Agent` tool calls. Gotgenes's smart-join mode (default) groups the
 *   completions into one consolidated notification.
 *
 *   Drawback vs. direct RPC: an extra LLM turn (the parent has to reason
 *   about how to call Agent N times). Benefit: no dependency on internals.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ParsedStep {
	type: string;
	task: string;
}

function parseParallelArgs(raw: string): ParsedStep[] | null {
	if (!raw.trim()) return null;

	const steps: ParsedStep[] = [];
	for (const part of raw.split(/\s*->\s*/)) {
		const trimmed = part.trim();
		if (!trimmed) return null;
		const m = trimmed.match(/^(\S+)\s+["']([\s\S]+)["']\s*$/);
		if (!m) return null;
		const type = m[1];
		const task = m[2].trim();
		if (!type || !task) return null;
		steps.push({ type, task });
	}
	return steps.length >= 2 ? steps : null;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("parallel", {
		description: 'Spawn N subagents in parallel: /parallel type1 "task" -> type2 "task"',
		handler: async (args, ctx) => {
			const safeNotify = (text: string, level: "info" | "error" | "warning" = "info") => {
				try {
					ctx.ui.notify(text, level);
				} catch {
					// ctx stale
				}
			};

			if (ctx.mode !== "tui") {
				safeNotify("/parallel requires interactive mode", "error");
				return;
			}

			const steps = parseParallelArgs(args);
			if (!steps) {
				safeNotify(
					'Usage: /parallel <type1> "task 1" -> <type2> "task 2" -> <type3> "task 3"',
					"error",
				);
				return;
			}

			const stepList = steps.map((s) => `— ${s.type}: ${s.task}`).join("\n");

			const message = `Параллельно в фоне запусти ${steps.length} сабагентов (каждого через отдельный вызов Agent tool, run_in_background: true):\n\n${stepList}\n\nДождись всех и выдай сводный отчёт.`;

			try {
				pi.sendUserMessage(message);
			} catch (e) {
				safeNotify(`/parallel failed: ${(e as Error).message}`, "error");
			}
		},
	});
}
