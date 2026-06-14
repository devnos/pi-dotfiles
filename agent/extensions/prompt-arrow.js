// Editor wrapper: prompt arrow (❯) + bash-mode toggle (Claude Code UX).
//
// Modes:
//   normal     - prompt is "❯ " (default)
//   bash       - prompt is "!" green, "!" prefix added on submit (result
//                goes into LLM context). Toggled on by pressing "!" on an
//                empty line.
//   bash-x     - prompt is "!" yellow, "!!" prefix added on submit (result
//                stays OUT of LLM context). Toggled on by pressing "!"
//                twice in a row on an empty line (matches pi's !! prefix).
//
// Tapping Backspace on an empty line in either bash variant exits to normal.
//
// Defer registration with setTimeout(0) so we run AFTER every synchronous
// session_start handler (so we wrap whichever editor the user has installed,
// e.g. @wierdbytes/pi-statusline).

const NORMAL_PREFIX = "❯ ";
const BASH_PREFIX = "! ";
const INDENT = "  "; // 2-char continuation indent (matches prefix width)
const BORDER_RE = /^[\u2500-\u257f]+\s*$/;
const GREEN = (s) => "\x1b[32m" + s + "\x1b[39m"; // basic ANSI green
const YELLOW = (s) => "\x1b[33m" + s + "\x1b[39m"; // basic ANSI yellow

// Note: pi-statusline strips the editor's top/bottom border, so a coloured
// border is invisible. The prefix glyph itself (❯ vs !) is the real visual
// indicator; we colour it green for bash (result in context) and yellow
// for bash-x (result excluded from context).

export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		setTimeout(() => {
			const current = ctx.ui.getEditorComponent();
			if (!current) return;

			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				const base = current(tui, theme, keybindings);
				if (!base || typeof base.render !== "function") return base;

				// Mode: "normal" | "bash" | "bash-x"
				const state = { mode: "normal" };
				const originalBorder = base.borderColor;

				const applyBorder = () => {
					if (state.mode === "bash") base.borderColor = GREEN;
					else if (state.mode === "bash-x") base.borderColor = YELLOW;
					else base.borderColor = originalBorder;
					base.invalidate?.();
					base.tui?.requestRender?.();
				};

				const wrap = (color) => (s) => color(s);

				// Wrap onSubmit: pi sets the real handler after the factory
				// returns (interactive-mode.js:1770, :2010). When pi reads
				// base.onSubmit, return a wrapper that prepends "!" or "!!"
				// based on the current mode, then clears the mode.
				let realHandler = null;
				Object.defineProperty(base, "onSubmit", {
					configurable: true,
					enumerable: true,
					get() {
						if (!realHandler) return undefined;
						return (text) => {
							if (state.mode === "bash") {
								state.mode = "normal";
								applyBorder();
								return realHandler("!" + text);
							}
							if (state.mode === "bash-x") {
								state.mode = "normal";
								applyBorder();
								return realHandler("!!" + text);
							}
							return realHandler(text);
						};
					},
					set(handler) {
						realHandler = handler;
					},
				});

				// Intercept input: cycle modes on "!" presses at empty line.
				//   normal  + "!"        -> bash
				//   bash    + "!"        -> bash-x
				//   bash-x  + "!"        -> bash-x (no further level, idempotent)
				//   any bash* + Backspace -> normal
				const origHandleInput = base.handleInput.bind(base);
				base.handleInput = (data) => {
					const empty = (base.getText?.() ?? "") === "";
					if (empty && data === "!") {
						if (state.mode === "normal") state.mode = "bash";
						else if (state.mode === "bash") state.mode = "bash-x";
						// bash-x stays bash-x
						applyBorder();
						return;
					}
					if (
						state.mode !== "normal" &&
						empty &&
						(data === "\x7f" || data === "\b" || data === "backspace")
					) {
						state.mode = "normal";
						applyBorder();
						return;
					}
					return origHandleInput(data);
				};

				// Wrap render: reserve 2 cols on the left for the prefix,
				// swap the glyph to "!" while in bash mode, colour it.
				const origRender = base.render.bind(base);
				base.render = (width) => {
					const reserve = NORMAL_PREFIX.length;
					const contentWidth = Math.max(1, width - reserve);
					const lines = origRender(contentWidth);
					if (!Array.isArray(lines) || lines.length === 0) return lines;

					return lines.map((line, i) => {
						const stripped = String(line).replace(/\x1b\[[0-9;]*m/g, "");
						if (BORDER_RE.test(stripped)) return line;
						let prefix;
						if (i !== 0) {
							prefix = INDENT;
						} else if (state.mode === "bash") {
							prefix = GREEN(BASH_PREFIX);
						} else if (state.mode === "bash-x") {
							prefix = YELLOW(BASH_PREFIX);
						} else {
							prefix = NORMAL_PREFIX;
						}
						return prefix + line;
					});
				};

				return base;
			});
		}, 0);
	});
}
