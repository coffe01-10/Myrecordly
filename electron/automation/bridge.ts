import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import type { ConnectionInfo } from "../../packages/automation/src/types";

/** Only explicitly enabled instances publish a local editing endpoint. */
export async function startAutomationBridge(
	connectionFile: string,
	call: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
	const token = randomBytes(32).toString("hex");
	const server = createServer(async (request, response) => {
		response.setHeader("Content-Type", "application/json");
		response.setHeader("Cache-Control", "no-store");
		if (request.headers.authorization !== `Bearer ${token}`) {
			response.writeHead(401);
			response.end(JSON.stringify({ error: "Unauthorized" }));
			return;
		}
		if (request.method !== "POST" || request.url !== "/call") {
			response.writeHead(404);
			response.end(JSON.stringify({ error: "Not found" }));
			return;
		}
		try {
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of request) {
				size += chunk.length;
				// Prevent a malformed local client from filling main-process memory.
				if (size > 8 * 1024 * 1024) throw new Error("Request exceeds 8 MiB");
				chunks.push(chunk);
			}
			const { name, args = {} } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			if (
				typeof name !== "string" ||
				!args ||
				typeof args !== "object" ||
				Array.isArray(args)
			)
				throw new Error("Expected a tool name and argument object");
			const result = await call(name, args);
			response.end(JSON.stringify({ result }));
		} catch (error) {
			response.writeHead(400);
			response.end(
				JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
			);
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Cannot start local automation endpoint");
	const info: ConnectionInfo = {
		version: 1,
		url: `http://127.0.0.1:${address.port}`,
		token,
		pid: process.pid,
	};
	await fs.mkdir(path.dirname(connectionFile), { recursive: true });
	await fs.writeFile(connectionFile, JSON.stringify(info), { mode: 0o600 });
	return {
		info,
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
			// A newer instance may have replaced discovery while this one was closing.
			try {
				const active = JSON.parse(
					await fs.readFile(connectionFile, "utf8"),
				) as ConnectionInfo;
				if (active.token === token) await fs.unlink(connectionFile);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		},
	};
}
