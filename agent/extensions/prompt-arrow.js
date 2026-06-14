// Wrapper extension: adds a "❯ " prompt arrow + left padding to the input editor.
// Works on top of @wierdbytes/pi-statusline (which strips editor borders and
// does not draw a prompt by itself), and on top of any other editor factory
// registered via ctx.ui.setEditorComponent().
//
// Strategy: defer registration with setTimeout(0) so we run AFTER every
// synchronous session_start handler (pi-statusline, pi-powerline, etc.).
// Then we grab the current editor factory, wrap its render() to reserve
// 2 columns on the left for the arrow, and re-register.

const PREFIX = "❯ ";
const INDENT = "  "; // 2-char continuation indent (matches the arrow width)
const BORDER_RE = /^[\u2500-\u257f]+\s*$/;

export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		setTimeout(() => {
			const current = ctx.ui.getEditorComponent();
			if (!current) return;

			ctx.ui.setEditorComponent((tui, theme, keybindings) => {
				const base = current(tui, theme, keybindings);
				if (!base || typeof base.render !== "function") return base;

				const origRender = base.render.bind(base);
				base.render = (width) => {
					const reserve = PREFIX.length; // 2
					const contentWidth = Math.max(1, width - reserve);
					const lines = origRender(contentWidth);
					if (!Array.isArray(lines) || lines.length === 0) return lines;

					return lines.map((line, i) => {
						// Keep any leftover border lines (pi-statusline strips them,
						// but pi-powerline's PromptPrefixEditor keeps them).
						const stripped = String(line).replace(/\x1b\[[0-9;]*m/g, "");
						if (BORDER_RE.test(stripped)) return line;
						return (i === 0 ? PREFIX : INDENT) + line;
					});
				};
				return base;
			});
		}, 0);
	});
}
