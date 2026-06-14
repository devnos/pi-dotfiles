// Point pi at the global themes dir (~/.pi/agent/themes/) so its themes
// are loaded by resource-loader alongside any package-provided themes.
//
// Why this is needed: in pi 0.79.x, updateThemesFromPaths() in
// resource-loader.js calls loadThemes(themePaths, false) with
// includeDefaults=false, so the global ~/.pi/agent/themes/ dir is
// only ever read when SOME package in settings.packages contributes a
// theme path. With no theme-providing packages, themes placed in
// ~/.pi/agent/themes/ are silently ignored and initTheme() falls back
// to 'dark'.
//
// This extension registers the global dir via the documented
// 'resources_discover' event, which feeds directly into the same
// loadThemes() call as URL-package themes.

import { join } from "node:path";
import { homedir } from "node:os";

const THEMES_DIR = join(homedir(), ".pi", "agent", "themes");

export default function (pi) {
	pi.on("resources_discover", async () => {
		return { themePaths: [THEMES_DIR] };
	});
}
