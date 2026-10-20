import { execFile } from "node:child_process";

// Windows' installed OCR languages are used directly; no extra model download.
const windowsOcr = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation' + [char]96 + '1' } | Select-Object -First 1
function Await($op, $type) { $asTask.MakeGenericMethod($type).Invoke($null, @($op)).GetAwaiter().GetResult() }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'No installed Windows OCR language' }
$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = @()
foreach ($filePath in $paths) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($filePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $results += [string]$result.Text
    } finally { $bitmap.Dispose() }
  } finally { $stream.Dispose() }
}
ConvertTo-Json -InputObject @($results) -Compress
`;
export function readScreenText(imagePaths: string[], signal: AbortSignal): Promise<string[]> {
	if (process.platform !== "win32")
		return Promise.reject(
			new Error(
				"Local OCR currently uses Windows OCR; use a vision model or external AI on this platform.",
			),
		);
	return new Promise((resolve, reject) => {
		const child = execFile(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(windowsOcr, "utf16le").toString("base64"),
			],
			{ windowsHide: true, signal, maxBuffer: 20 * 1024 * 1024, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (error) reject(new Error(stderr.trim() || error.message));
				else resolve(JSON.parse(stdout.replace(/^\uFEFF/, "")) as string[]);
			},
		);
		child.stdin!.end(JSON.stringify(imagePaths));
	});
}
