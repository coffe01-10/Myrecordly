import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createUntitledProject } from "./createUntitledProject";
const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
it.each([
	"Untitled Project",
	"未命名项目",
])("publishes complete, uniquely named %s projects under concurrent creation without replacing existing projects", async (name) => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-new-"));
	dirs.push(dir);
	await fs.writeFile(path.join(dir, `${name}.recordly`), "original");
	const paths = await Promise.all(
		[1, 2, 3].map((n) => createUntitledProject(dir, JSON.stringify({ id: n }), name)),
	);
	expect(paths.map((p) => path.basename(p)).sort()).toEqual([
		`${name} 1.recordly`,
		`${name} 2.recordly`,
		`${name} 3.recordly`,
	]);
	expect(await fs.readFile(path.join(dir, `${name}.recordly`), "utf8")).toBe("original");
	for (let i = 0; i < paths.length; i++)
		expect(JSON.parse(await fs.readFile(paths[i], "utf8"))).toEqual({ id: i + 1 });
	expect((await fs.readdir(dir)).filter((p) => p.endsWith(".tmp"))).toEqual([]);
});
