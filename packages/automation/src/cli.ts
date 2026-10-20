#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RecordlyClient, defaultConnectionFile } from "./index.js";
import { parseTool, tools } from "./tools.js";
import type { JobHandle } from "./types.js";

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			connection: { type: "string" },
			args: { type: "string" },
			file: { type: "string" },
			wait: { type: "boolean" },
			help: { type: "boolean", short: "h" },
			executable: { type: "string" },
			app: { type: "string" },
			"user-data": { type: "string" },
		},
	});
	const command = positionals[0];
	if (!command || values.help || command === "help") {
		process.stdout.write(
			`Recordly SDK / CLI / MCP\n\nStart: recordly start --executable <Recordly.exe> [--app <development project>] [--user-data <directory>]\nCall:  recordly <tool> [--args '<JSON>' | --file arguments.json] [--wait] [--connection automation.json]\nList:  recordly tools\n\n${Object.entries(
				tools,
			)
				.map(([name, tool]) => `${name}\n  ${tool.description}`)
				.join("\n")}\n`,
		);
		return;
	}
	if (command === "tools") {
		process.stdout.write(
			`${JSON.stringify(
				Object.entries(tools).map(([name, { description }]) => ({ name, description })),
				null,
				2,
			)}\n`,
		);
		return;
	}
	if (command === "start") {
		const executable = values.executable ?? process.env.RECORDLY_EXECUTABLE;
		if (!executable)
			throw new Error("Provide --executable <Recordly.exe> or set RECORDLY_EXECUTABLE");
		const connectionFile = path.resolve(
			values.connection ??
				process.env.RECORDLY_CONNECTION_FILE ??
				(values["user-data"]
					? path.join(values["user-data"], "automation.json")
					: defaultConnectionFile()),
		);
		const running = await RecordlyClient.launch({
			executable,
			appPath: values.app,
			userDataDir: values["user-data"],
			connectionFile,
			detached: true,
		});
		running.process.unref();
		process.stdout.write(`${JSON.stringify({ pid: running.process.pid, connectionFile })}\n`);
		return;
	}
	if (values.args && values.file) throw new Error("Use either --args or --file");
	const parsed = parseTool(
		command,
		JSON.parse(
			values.file
				? (await readFile(values.file, "utf8")).replace(/^\uFEFF/, "")
				: (values.args ?? "{}"),
		),
	);
	const client = new RecordlyClient({ connectionFile: values.connection });
	const result = await client.call(parsed.name, parsed.args as never);
	if (values.wait && result && "jobId" in result) {
		const { jobId } = result as JobHandle;
		const interrupt = () => {
			void client.cancelJob(jobId).finally(() => {
				process.exitCode = 130;
			});
		};
		process.once("SIGINT", interrupt);
		try {
			process.stdout.write(`${JSON.stringify(await client.waitForJob(jobId), null, 2)}\n`);
		} finally {
			process.removeListener("SIGINT", interrupt);
		}
	} else {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	}
}
main().catch((error) => {
	process.stderr.write(
		`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`,
	);
	if (!process.exitCode) process.exitCode = 1;
});
