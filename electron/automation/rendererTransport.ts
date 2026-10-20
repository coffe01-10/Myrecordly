import { randomUUID } from "node:crypto";
import { ipcMain, type WebContents } from "electron";
import type { AutomationResponse } from "../../packages/automation/src/types";

export function createAutomationTransport() {
	const ready = new Set<number>();
	const waiters = new Map<number, Set<() => void>>();
	const pending = new Map<
		string,
		{ sender: number; resolve: (result: unknown) => void; reject: (error: Error) => void }
	>();
	const onReady = (event: Electron.IpcMainEvent) => {
		if (!ready.has(event.sender.id)) {
			const id = event.sender.id;
			event.sender.once("destroyed", () => ready.delete(id));
		}
		ready.add(event.sender.id);
		for (const resolve of waiters.get(event.sender.id) ?? []) resolve();
		waiters.delete(event.sender.id);
	};
	const onResponse = (event: Electron.IpcMainEvent, response: AutomationResponse) => {
		const call = pending.get(response.id);
		if (!call || call.sender !== event.sender.id) return;
		pending.delete(response.id);
		if (response.error) call.reject(new Error(response.error));
		else call.resolve(response.result);
	};
	ipcMain.on("automation:ready", onReady);
	ipcMain.on("automation:response", onResponse);
	async function send<T>(
		contents: WebContents,
		command: string,
		args: Record<string, unknown> = {},
	): Promise<T> {
		if (!ready.has(contents.id))
			await new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					clearTimeout(timer);
					contents.removeListener("destroyed", destroyed);
					waiters.get(contents.id)?.delete(done);
				};
				const done = () => {
					cleanup();
					resolve();
				};
				const destroyed = () => {
					cleanup();
					reject(new Error("Recordly window closed"));
				};
				const timer = setTimeout(() => {
					cleanup();
					reject(new Error("Recordly editor did not become ready"));
				}, 60_000);
				const set = waiters.get(contents.id) ?? new Set();
				set.add(done);
				waiters.set(contents.id, set);
				contents.once("destroyed", destroyed);
			});
		return new Promise<T>((resolve, reject) => {
			const id = randomUUID();
			const cleanup = () => {
				clearTimeout(timer);
				pending.delete(id);
				contents.removeListener("destroyed", destroyed);
			};
			const destroyed = () => {
				cleanup();
				reject(new Error("Recordly window closed during automation"));
			};
			const timer =
				command === "render"
					? undefined
					: setTimeout(() => {
							cleanup();
							reject(new Error(`Recordly ${command} timed out`));
						}, 120_000);
			pending.set(id, {
				sender: contents.id,
				resolve: (result) => {
					cleanup();
					resolve(result as T);
				},
				reject: (error) => {
					cleanup();
					reject(error);
				},
			});
			contents.once("destroyed", destroyed);
			contents.send("automation:request", { id, command, args });
		});
	}
	return {
		send,
		dispose() {
			ipcMain.removeListener("automation:ready", onReady);
			ipcMain.removeListener("automation:response", onResponse);
		},
	};
}
