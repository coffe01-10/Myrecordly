import fs from "node:fs";
import path from "node:path";

/**
 * Structural sync for locale files.
 *
 * `en` is the source of truth. For every other locale this fills any missing key
 * with the English value (so untranslated strings render in English instead of a
 * raw key) and drops keys that no longer exist in `en`. Existing translations are
 * never overwritten.
 *
 * Run after adding keys to `en` to keep `npm run i18n:check` green.
 */

const root = process.cwd();
const localesDir = path.join(root, "src", "i18n", "locales");

function loadJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, "\t")}\n`, "utf8");
}

/** Rebuild `target` so its key structure mirrors `base`, keeping target values. */
function syncNode(base, target) {
	if (!base || typeof base !== "object" || Array.isArray(base)) {
		return target === undefined ? base : target;
	}

	const result = {};
	for (const key of Object.keys(base)) {
		const baseValue = base[key];
		const targetValue = target && typeof target === "object" ? target[key] : undefined;

		if (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)) {
			result[key] = syncNode(baseValue, targetValue);
		} else {
			result[key] = targetValue === undefined ? baseValue : targetValue;
		}
	}
	return result;
}

function collectKeyPaths(obj, prefix = "") {
	if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
		return prefix ? [prefix] : [];
	}
	const paths = [];
	for (const key of Object.keys(obj)) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		const value = obj[key];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			paths.push(...collectKeyPaths(value, nextPrefix));
		} else {
			paths.push(nextPrefix);
		}
	}
	return paths;
}

const locales = fs
	.readdirSync(localesDir)
	.filter((entry) => fs.statSync(path.join(localesDir, entry)).isDirectory());

const baseLocaleDir = path.join(localesDir, "en");
const namespaceFiles = fs.readdirSync(baseLocaleDir).filter((f) => f.endsWith(".json"));

let changed = 0;
for (const locale of locales) {
	if (locale === "en") continue;

	for (const namespaceFile of namespaceFiles) {
		const basePath = path.join(baseLocaleDir, namespaceFile);
		const localePath = path.join(localesDir, locale, namespaceFile);
		const baseData = loadJson(basePath);
		const localeData = fs.existsSync(localePath) ? loadJson(localePath) : {};

		const synced = syncNode(baseData, localeData);
		const before = collectKeyPaths(localeData).length;
		const after = collectKeyPaths(synced).length;

		writeJson(localePath, synced);
		if (before !== after) {
			console.log(`i18n-sync: ${locale}/${namespaceFile}: ${before} → ${after} keys`);
			changed++;
		}
	}
}

console.log(changed === 0 ? "i18n-sync: all locales already in sync" : `i18n-sync: updated ${changed} files`);
