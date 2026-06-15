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
// Defer registration with setTimeout(0) so we run AFTER pi's runtime has
// set up the default editor (getEditorComponent() returns null if called
// too early). The setTimeout callback wraps ctx.ui access in try/catch
// because a session reload between session_start and the setTimeout firing
// would otherwise mark the captured ctx as stale and throw.

const NORMAL_PREFIX = "❯ ";
const BASH_PREFIX = "! ";
const INDENT = "  "; // 2-char continuation indent (matches prefix width)
const BORDER_RE = /^[\u2500-\u257f]+\s*$/;
const GREEN = (s) => "\x1b[32m" + s + "\x1b[39m";
const YELLOW = (s) => "\x1b[33m" + s + "\x1b[39m";

export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		const tryWrap = () => {
			try {
				const current = ctx.ui.getEditorComponent();
				if (!current) return false;

				ctx.ui.setEditorComponent((tui, theme, keybindings) => {
					const base = current(tui, theme, keybindings);
					if (!base || typeof base.render !== "function") return base;

					const state = { mode: "normal" };
					const originalBorder = base.borderColor;

					const applyBorder = () => {
						if (state.mode === "bash") base.borderColor = GREEN;
						else if (state.mode === "bash-x") base.borderColor = YELLOW;
						else base.borderColor = originalBorder;
						base.invalidate?.();
						base.tui?.requestRender?.();
					};

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

					const origHandleInput = base.handleInput.bind(base);
					base.handleInput = (data) => {
						const empty = (base.getText?.() ?? "") === "";
						if (empty && data === "!") {
							if (state.mode === "normal") state.mode = "bash";
							else if (state.mode === "bash") state.mode = "bash-x";
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
				return true;
			} catch {
				// ctx became stale (session was reloaded between session_start
				// and the setTimeout firing). Skip — the next session_start
				// will re-trigger and try again.
				return false;
			}
		};

		// Try synchronously first (fast path when the editor is already up).
		if (tryWrap()) return;
		// Fallback: defer past pi's own editor setup.
		setTimeout(tryWrap, 0);
	});
}
