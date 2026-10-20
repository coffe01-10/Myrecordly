#!/usr/bin/env node
import { parseArgs } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RecordlyClient } from "./index.js";
import { tools } from "./tools.js";
import type { ToolName } from "./types.js";
import { mediaToolResult } from "./mediaResult.js";

const { values } = parseArgs({
	options: { connection: { type: "string" }, help: { type: "boolean" } },
});
if (values.help) {
	process.stdout.write(
		"Recordly MCP server (stdio)\nUsage: recordly-mcp [--connection path/to/automation.json]\nStart Recordly with --automation first.\n",
	);
} else {
	const client = new RecordlyClient({ connectionFile: values.connection });
	const server = new McpServer({ name: "recordly", version: "0.1.0" });
	for (const name of Object.keys(tools) as ToolName[]) {
		const { description, schema } = tools[name];
		server.registerTool(
			name,
			{
				description,
				inputSchema: schema.shape,
				annotations: {
					readOnlyHint: [
						"get_project",
						"get_frames",
						"get_job",
						"list_recordings",
						"list_projects",
						"get_video_index",
						"get_storyboard",
						"search_video",
						"inspect_segment",
					].includes(name),
					destructiveHint: ["save_project", "render_preview", "export_video"].includes(
						name,
					),
					openWorldHint: false,
				},
			},
			async (args: Record<string, unknown>) => {
				try {
					const result = await client.call(name, schema.parse(args) as never);
					if (
						name === "get_frames" ||
						name === "get_storyboard" ||
						name === "inspect_segment"
					)
						return mediaToolResult(result as Parameters<typeof mediaToolResult>[0]);
					return {
						content: [{ type: "text" as const, text: JSON.stringify(result) }],
						structuredContent: result as unknown as Record<string, unknown>,
					};
				} catch (error) {
					return {
						isError: true,
						content: [
							{
								type: "text" as const,
								text: error instanceof Error ? error.message : String(error),
							},
						],
					};
				}
			},
		);
	}
	await server.connect(new StdioServerTransport());
}
