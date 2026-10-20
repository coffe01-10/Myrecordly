import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { startAutomationBridge } from "./bridge";
import { RecordlyClient } from "../../packages/automation/src/index";

it("rejects unauthenticated browser requests, serves the SDK, and removes its discovery file", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "recordly-bridge-test-"));
	const file = path.join(directory, "automation.json");
	const calls: string[] = [];
	const bridge = await startAutomationBridge(file, async (name) => {
		calls.push(name);
		return { revision: 7, clips: [] };
	});
	try {
		const info = JSON.parse(await readFile(file, "utf8"));
		expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
		const rejected = await fetch(`${info.url}/call`, {
			method: "POST",
			body: JSON.stringify({ name: "apply_edits" }),
		});
		expect(rejected.status).toBe(401);
		expect(calls).toEqual([]);
		const sdk = new RecordlyClient({ connectionFile: file });
		expect((await sdk.getProject()).revision).toBe(7);
		expect(calls).toEqual(["get_project"]);
	} finally {
		await bridge.close();
	}
	try {
		await expect(access(file)).rejects.toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
