$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$electronPath = Join-Path $repoRoot "node_modules\electron\dist\electron.exe"
$launcherMutex = New-Object System.Threading.Mutex($false, "Local\MyrecordlyDevLauncher")
$ownsMutex = $false

try {
	# Reuse this checkout's window, preserving any recording or unsaved edits.
	$runningApp = Get-Process -Name electron -ErrorAction SilentlyContinue |
		Where-Object { $_.Path -eq $electronPath -and $_.MainWindowHandle -ne 0 } |
		Select-Object -First 1
	if ($runningApp) {
		Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RecordlyLauncherWindow {
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr window);
}
'@
		$window = $runningApp.MainWindowHandle
		if ([RecordlyLauncherWindow]::IsIconic($window)) {
			[void][RecordlyLauncherWindow]::ShowWindowAsync($window, 9)
		}
		[void][RecordlyLauncherWindow]::SetForegroundWindow($window)
		return
	}

	# Keep repeated double-clicks from starting competing Vite/Electron instances.
	$ownsMutex = $launcherMutex.WaitOne(0)
	if (-not $ownsMutex) { return }

	$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
	$logDirectory = Join-Path $repoRoot "logs"
	New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
	$env:ELECTRON_RUN_AS_NODE = $null
	$env:RECORDLY_RENDERER_ONLY = $null
	$arguments = '"{0}" --config "{1}" --host 127.0.0.1 --port 5173 --strictPort' -f `
		(Join-Path $repoRoot "node_modules\vite\bin\vite.js"), `
		(Join-Path $repoRoot "vite.config.ts")
	$process = Start-Process -FilePath $nodePath -ArgumentList $arguments `
		-WorkingDirectory $repoRoot -WindowStyle Hidden -Wait -PassThru `
		-RedirectStandardOutput (Join-Path $logDirectory "recordly-launch.log") `
		-RedirectStandardError (Join-Path $logDirectory "recordly-launch-error.log")
	if ($process.ExitCode -ne 0) {
		throw "Startup exited with code $($process.ExitCode). See $logDirectory\recordly-launch-error.log."
	}
} catch {
	Add-Type -AssemblyName System.Windows.Forms
	[void][System.Windows.Forms.MessageBox]::Show(
		$_.Exception.Message,
		"Recordly could not start",
		[System.Windows.Forms.MessageBoxButtons]::OK,
		[System.Windows.Forms.MessageBoxIcon]::Error
	)
} finally {
	if ($ownsMutex) { $launcherMutex.ReleaseMutex() }
	$launcherMutex.Dispose()
}
