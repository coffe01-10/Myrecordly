import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const version = "1.73.5";
const platform = { win32: "windows", darwin: "osx", linux: "linux" }[process.platform];
const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
if (!platform || !arch) {
	console.log("Cloud runtime is not bundled for this platform.");
	process.exit(0);
}
const target = path.resolve("electron/native/bin", `${process.platform}-${process.arch}`);
const executable = process.platform === "win32" ? "rclone.exe" : "rclone";
try {
	await fs.access(path.join(target, executable));
	process.exit(0);
} catch {}
const temporaryRoot = path.resolve(".tmp");
await fs.mkdir(temporaryRoot, { recursive: true });
const temporary = await fs.mkdtemp(path.join(temporaryRoot, "cloud-runtime-"));
try {
	const folder = `rclone-v${version}-${platform}-${arch}`;
	const archive = path.join(temporary, "runtime.zip");
	const extracted = path.join(temporary, "extracted");
	console.log(`Downloading cloud runtime ${version} from rclone.org…`);
	const response = await fetch(`https://downloads.rclone.org/v${version}/${folder}.zip`);
	if (!response.ok) throw new Error(`Cloud runtime download failed (${response.status})`);
	await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
	if (process.platform === "win32") {
		await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Expand-Archive -LiteralPath $env:RECORDLY_RUNTIME_ARCHIVE -DestinationPath $env:RECORDLY_RUNTIME_EXTRACT",
			],
			{
				windowsHide: true,
				env: {
					...process.env,
					RECORDLY_RUNTIME_ARCHIVE: archive,
					RECORDLY_RUNTIME_EXTRACT: extracted,
				},
			},
		);
	} else await run("unzip", ["-q", archive, "-d", extracted]);
	await fs.mkdir(target, { recursive: true });
	await fs.copyFile(
		path.join(extracted, folder, "README.txt"),
		path.join(target, "rclone-README.txt"),
	);
	await fs.copyFile(path.join(extracted, folder, executable), path.join(target, executable));
	await fs.chmod(path.join(target, executable), 0o755);
	console.log("Cloud runtime ready.");
} catch (error) {
	console.warn(
		`Cloud runtime not bundled: ${error.message}. Website sessions remain available; run npm run build:cloud-runtime to retry.`,
	);
} finally {
	// mkdtemp creates this directory under the project's .tmp directory.
	if (path.dirname(temporary) === temporaryRoot)
		await fs.rm(temporary, { recursive: true, force: true });
}
