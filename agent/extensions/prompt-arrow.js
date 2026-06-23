// Editor wrapper: prompt arrow (❯) + bash-mode toggle (Claude Code UX).
//
// Modes:
//   normal     - prompt is "❯ " (default)
//   bash       - prompt is "! " green, "!" prefix added on submit (result
//                goes to LLM context). Toggled on by pressing "!" on an
//                empty line.
//   bash-x     - prompt is "! " yellow, "!!" prefix added on submit (result
//                stays OUT of LLM context). Toggled on by pressing "!"
//                twice in a row on an empty line.
//
// Tapping Backspace on an empty line in either bash variant exits to normal.
//
// Заменяет редактор pi на свой CustomEditor (как wierd-statusline делает).
// onSubmit перехватываем через Object.defineProperty на инстансе (не через
// class accessor) — jiti-транспайлер иногда не цепляет getter/setter с
// прототипа кросс-модульно, а собственный property descriptor на инстансе
// гарантированно срабатывает при `obj.onSubmit = ...` от pi.

import { CustomEditor } from "@earendil-works/pi-coding-agent";

const NORMAL_PREFIX = "❯ ";
const BASH_PREFIX = "! ";
const INDENT = "  "; // 2-char continuation indent (matches prefix width)
const BORDER_RE = /^[\u2500-\u257f]+\s*$/;
const GREEN = (s) => "\x1b[32m" + s + "\x1b[39m";
const YELLOW = (s) => "\x1b[33m" + s + "\x1b[39m";

/**
 * Кастомный редактор: рендерит `❯ ` (или `! ` в bash-режиме) перед
 * первой строкой ввода, `  ` перед продолжениями. Bash-режим
 * переключается клавишей `!` на пустой строке; backspace на пустой
 * строке возвращает в normal. На submit добавляет префикс `!` или `!!`.
 */
class PromptArrowEditor extends CustomEditor {
	constructor(tui, theme, keybindings) {
		super(tui, theme, keybindings);
		this._mode = "normal";
		this._realSubmit = undefined;
	}

	_setMode(newMode) {
		if (this._mode === newMode) return;
		this._mode = newMode;
		if (typeof this.invalidate === "function") this.invalidate();
	}

	// Перехватываем submit через defineProperty на инстансе, потому что
	// class-аксессоры на прототипе надёжно не подхватываются jiti при
	// кросс-модульной загрузке (setEditorComponent из pi, класс из
	// расширения — разные jiti-инстансы, instanceof не работает, и
	// сеттер на прототипе теряется).
	_initSubmitInterceptor() {
		const self = this;
		Object.defineProperty(this, "onSubmit", {
			configurable: true,
			enumerable: true,
			get() {
				const original = self._realSubmit;
				if (!original) return undefined;
				return (text) => {
					if (self._mode === "bash") {
						self._setMode("normal");
						return original("!" + text);
					}
					if (self._mode === "bash-x") {
						self._setMode("normal");
						return original("!!" + text);
					}
					return original(text);
				};
			},
			set(handler) {
				self._realSubmit = handler;
			},
		});
	}

	handleInput(data) {
		const empty = (this.getText?.() ?? "") === "";
		if (empty && data === "!") {
			if (this._mode === "normal") this._setMode("bash");
			else if (this._mode === "bash") this._setMode("bash-x");
			else this._setMode("normal");
			return;
		}
		if (
			this._mode !== "normal" &&
			empty &&
			(data === "\x7f" || data === "\b" || data === "backspace")
		) {
			this._setMode("normal");
			return;
		}
		return super.handleInput(data);
	}

	render(width) {
		const reserve = NORMAL_PREFIX.length;
		const contentWidth = Math.max(1, width - reserve);
		const lines = super.render(contentWidth);
		if (!Array.isArray(lines) || lines.length === 0) return lines;

		// borders пропускаем как есть; для не-границ первая получает
		// NORMAL_PREFIX, остальные — INDENT (continuation). Раньше логика
		// была «i === 0 → prefix», но в editor.render() i=0 это ВЕРХНЯЯ
		// ГРАНИЦА, а контент идёт под индексом 1 — поэтому стрелка
		// никогда не показывалась.
		let contentSeen = false;
		return lines.map((line) => {
			const stripped = String(line).replace(/\x1b\[[0-9;]*m/g, "");
			if (BORDER_RE.test(stripped)) return line;
			let prefix;
			if (!contentSeen) {
				contentSeen = true;
				if (this._mode === "bash") prefix = GREEN(BASH_PREFIX);
				else if (this._mode === "bash-x") prefix = YELLOW(BASH_PREFIX);
				else prefix = NORMAL_PREFIX;
			} else {
				prefix = INDENT;
			}
			return prefix + line;
		});
	}
}

export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = new PromptArrowEditor(tui, theme, keybindings);
			editor._initSubmitInterceptor();
			return editor;
		});
	});
}
