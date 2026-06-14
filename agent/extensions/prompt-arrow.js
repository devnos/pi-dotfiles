// Editor wrapper: prompt arrow (❯) + bash-mode toggle (Claude Code UX).
//
// - Adds "❯ " (2 cols) on the left of the input line, "  " indent on wrap.
// - Tapping "!" on an empty line toggles bash-mode: "❯" becomes "!",
//   border turns green, and the "!" character is not inserted.
// - Tapping Backspace on an empty line in bash-mode exits it.
// - Submitting in bash-mode prefixes the text with "!" so pi routes it
//   to its built-in bash runner (interactive-mode.js:2147).
// - Works on top of @wierdbytes/pi-statusline and any other editor
//   factory registered via ctx.ui.setEditorComponent().
//
// Defer registration with setTimeout(0) so we run AFTER every
// synchronous session_start handler.

const NORMAL_PREFIX = "❯ ";
const BASH_PREFIX = "! ";
const INDENT = "  "; // 2-char continuation indent (matches prefix width)
const BORDER_RE = /^[\u2500-\u257f]+\s*$/;
const GREEN = (s) => "\x1b[32m" + s + "\x1b[39m"; // basic ANSI green

export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		setTimeout(() => {
			const current = ctx.ui.getEditorComponent();
			if (!current) return;

			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				const base = current(tui, theme, keybindings);
				if (!base || typeof base.render !== "function") return base;

				const state = { bashMode: false };
				const originalBorder = base.borderColor;

				const applyBorder = () => {
					base.borderColor = state.bashMode ? GREEN : originalBorder;
					base.invalidate?.();
					base.tui?.requestRender?.();
				};

				// Wrap onSubmit: pi sets the real handler after the factory
				// returns (interactive-mode.js:1770, :2010). When pi reads
				// base.onSubmit, return a wrapper that prepends "!" if we're
				// in bash-mode, then clears the mode.
				let realHandler = null;
				Object.defineProperty(base, "onSubmit", {
					configurable: true,
					enumerable: true,
					get() {
						if (!realHandler) return undefined;
						return (text) => {
							if (state.bashMode) {
								state.bashMode = false;
								applyBorder();
								return realHandler("!" + text);
							}
							return realHandler(text);
						};
					},
					set(handler) {
						realHandler = handler;
					},
				});

				// Intercept input: toggle bash-mode on "!" / Backspace at empty line.
				const origHandleInput = base.handleInput.bind(base);
				base.handleInput = (data) => {
					const empty = (base.getText?.() ?? "") === "";
					if (empty && data === "!") {
						state.bashMode = true;
						applyBorder();
						return;
					}
					if (
						state.bashMode &&
						empty &&
						(data === "\x7f" || data === "\b" || data === "backspace")
					) {
						state.bashMode = false;
						applyBorder();
						return;
					}
					return origHandleInput(data);
				};

				// Wrap render: reserve 2 cols on the left for the prefix,
				// swap the glyph to "!" while in bash-mode.
				const origRender = base.render.bind(base);
				base.render = (width) => {
					const reserve = NORMAL_PREFIX.length;
					const contentWidth = Math.max(1, width - reserve);
					const lines = origRender(contentWidth);
					if (!Array.isArray(lines) || lines.length === 0) return lines;

					return lines.map((line, i) => {
						const stripped = String(line).replace(/\x1b\[[0-9;]*m/g, "");
						if (BORDER_RE.test(stripped)) return line;
						const prefix = i === 0 ? (state.bashMode ? BASH_PREFIX : NORMAL_PREFIX) : INDENT;
						return prefix + line;
					});
				};

				return base;
			});
		}, 0);
	});
}
