/**
 * Prompt Enhancer Extension
 *
 * Transforms a brief user prompt into an expert-framed version with:
 *  - decomposition into logical components
 *  - explicit constraints and success criteria
 *  - role framing when useful
 *  - anticipated failure modes
 *  - extra context the model needs to actually do the task
 *
 * Two ways to invoke:
 *  1. Hotkey (default: Ctrl+Shift+E). Customise via ~/.pi/agent/keybindings.json.
 *  2. Slash command: /improve [text] or /enhance [text]
 *
 * Behaviour:
 *  - If the editor has text, the editor text is the input.
 *  - If the editor is empty and the command was used with an argument, the
 *    argument is the input.
 *  - The enhanced version replaces the editor text. The user can press
 *    Ctrl+Z (built-in `tui.editor.undo`) to revert.
 *  - Language: matches the input language automatically.
 *
 * The system prompt is derived from sammcj/agentic-coding@prompt-enhancer
 * (skills.sh, 122 installs) with light adjustments for an "expand for an
 * LLM" target use case.
 */

import { complete, type UserMessage } from "@earendil-works/pi-ai";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

// Hotkey. Default is Ctrl+Shift+E (E = Enhance). Override via
// ~/.pi/agent/keybindings.json by mapping the extension's keybinding id
// to another key. Avoid Ctrl+Shift+I — Windows Terminal uses it for DevTools.
const HOTKEY = Key.ctrlShift("e");

const SYSTEM_PROMPT = `You are a text transformation tool. Your only job is to
take a brief user request and rewrite it as a clearer, more detailed
version of the same request.

You are NOT an assistant. You do not answer the request. You do not
start a conversation. You do not ask questions. You do not offer
alternatives. You do not acknowledge the user. You transform text.

## Output contract

The first character of your response is the first character of the
enhanced prompt. The last character of your response is the last
character of the enhanced prompt. There is nothing else.

Forbidden in your output:
- Any preamble ("Here is...", "Sure!", "Enhanced:", "Certainly...")
- Any closing remark ("Let me know...", "Hope this helps...")
- Any question to the user ("Did I...?", "Should I...?", "Want me to...?")
- Any meta-commentary about the rewrite itself
- Any acknowledgment of the user
- Markdown code fences wrapping the whole output

Allowed in your output: the enhanced prompt itself, which may use
markdown headers, bullets, and emphasis internally.

## What "enhance" means

Take the input and rewrite it as a senior engineer would write it:
- Use precise, domain-specific terminology
- Add concrete, testable requirements
- Add explicit constraints and success criteria
- Add relevant context (system, files, prior attempts)
- Anticipate failure modes the user probably wants handled

The language of the output must match the language of the input.

## Structure

For non-trivial tasks, use this layout:

**Task**: one-line statement of what needs to happen.
**Context**: the system, the file or area, prior attempts, relevant constraints.
**Requirements**: bulleted, concrete, testable.
**Constraints**: things to avoid or stay within.
**Success criteria**: how the user will judge the result.
**Failure modes** (optional): edge cases or known traps.

For very short or already-clear inputs, keep the rewrite tight — a
slightly clearer restatement, not a 400-word essay. Match the depth
of the rewrite to the depth of the task.

## Rules

- Preserve user intent absolutely. You change how it is asked, never what.
- Do not invent requirements. Fill obvious gaps with reasonable defaults;
  do not add things the user did not imply.
- If something is ambiguous, pick the most reasonable interpretation
  and state the assumption briefly inline (e.g. "assuming PostgreSQL 15").
  Do not surface the ambiguity to the user as a question.
- Use correct terminology, not impressive-sounding terminology.
`;

async function getInputText(
  pi: ExtensionAPI,
  ctx: { ui: { getEditorText: () => string } },
  arg: string,
): Promise<string | null> {
  const editorText = ctx.ui.getEditorText().trim();
  if (editorText.length > 0) return editorText;
  const trimmedArg = arg.trim();
  if (trimmedArg.length > 0) return trimmedArg;
  return null;
}

// Defensive post-processing. The system prompt already forbids these, but
// models sometimes leak meta-text. Strip common patterns so the result
// is always a clean rewrite.
function cleanResult(raw: string): string {
  let text = raw.trim();

  // Strip wrapping markdown code fences if the model ignored the rule.
  const fenceMatch = text.match(/^```(?:[a-z]*\n)?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) text = fenceMatch[1].trim();

  const lines = text.split("\n");

  // Drop lines that are pure meta-text (preamble, closing remarks, etc.).
  const preambleRe =
    /^\s*(here('s| is) (the |an? )?(enhanced|improved|rewritten|expanded|updated)?\s*(version|prompt)?\s*[:.\-–—]?|sure[,!.]?\s|certainly[,!.]?\s|of course[,!.]?\s|happy to help|got it[,!.]?\s)/i;
  const closingRe =
    /^\s*(let me know|hope this helps|feel free to|if you (need|want|have) (anything|more|questions?|clarifications?)|would you like (me to|to)|want me to|should i|do you (want|need|wish)|i('ve| have) (also )?included|i (can also|could also)|did i (get|capture) (this|it) (right|correctly)?|is (this|that) (what you|ok|correct|good)|let me know if (this|you)|hope (this|it) helps)/i;
  const noteRe = /^\s*(note|p\.?s\.?|p\.?p\.?s\.?)\s*[:.\-–—]/i;

  while (lines.length > 0) {
    const first = lines[0].trim();
    const last = lines[lines.length - 1].trim();
    if (first && preambleRe.test(first)) {
      lines.shift();
      continue;
    }
    if (last && (closingRe.test(last) || noteRe.test(last))) {
      lines.pop();
      continue;
    }
    if (last.endsWith("?") && last.length > 1 && !/^https?:\/\//i.test(last) && !/\b(what|which|how|why|when|where|who)\s+[a-z]/i.test(last.slice(0, last.length - 1).split(/[.!?]/).pop() ?? "")) {
      // very loose heuristic: drop a trailing pure question line
      lines.pop();
      continue;
    }
    break;
  }

  // Collapse 3+ blank lines into 1.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function enhance(pi: ExtensionAPI, ctx: any, source: string): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("prompt-enhancer requires interactive mode", "error");
    return;
  }
  if (!ctx.model) {
    ctx.ui.notify("No model selected", "error");
    return;
  }

  const input = await getInputText(pi, ctx, source);
  if (!input) {
    ctx.ui.notify("Nothing to enhance — type a prompt or pass it as an argument", "warning");
    return;
  }

  const model = ctx.model;
  const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, `Enhancing prompt with ${model.id}...`);
    loader.onAbort = () => done(null);

    const run = async () => {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) {
        throw new Error(auth.ok ? `No API key for ${model.provider}` : auth.error);
      }

      const userMessage: UserMessage = {
        role: "user",
        content: [{ type: "text", text: input }],
        timestamp: Date.now(),
      };

      const response = await complete(
        model,
        { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
        { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
      );

      if (response.stopReason === "aborted") return null;

      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim();

      return text.length > 0 ? text : null;
    };

    run().then(done).catch(() => done(null));
    return loader;
  });

  if (result === null) {
    ctx.ui.notify("Enhance cancelled", "info");
    return;
  }

  ctx.ui.setEditorText(cleanResult(result));
  ctx.ui.notify("Prompt enhanced. Ctrl+Z to revert.", "info");
}

export default function (pi: ExtensionAPI) {
  // Primary hotkey. Ctrl+Shift+E (E = Enhance) is unbound in Windows
  // Terminal, macOS Terminal, iTerm2, and most Linux terminals. If it
  // is captured by your terminal, fall back to Alt+E below.
  pi.registerShortcut(HOTKEY, {
    description: "Enhance current editor prompt (Ctrl+Shift+E)",
    handler: async (ctx) => enhance(pi, ctx, ""),
  });

  // Fallback hotkey for terminals that eat Ctrl+Shift+anything.
  pi.registerShortcut(Key.alt("e"), {
    description: "Enhance current editor prompt (Alt+E)",
    handler: async (ctx) => enhance(pi, ctx, ""),
  });

  // Slash command fallback — works even when the hotkey is overridden or
  // unavailable (e.g. terminals that swallow the key).
  const commandHandler = async (args: string, ctx: any) => enhance(pi, ctx, args);
  pi.registerCommand("improve", {
    description: "Enhance the current editor prompt (same as Ctrl+Shift+I)",
    handler: commandHandler,
  });
  pi.registerCommand("enhance", {
    description: "Enhance the current editor prompt (alias of /improve)",
    handler: commandHandler,
  });
}
