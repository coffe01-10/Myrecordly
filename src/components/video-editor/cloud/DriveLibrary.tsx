import { useCallback, useEffect, useRef, useState } from "react";
import {
	CloudArrowUp,
	DownloadSimple,
	Folder,
	GoogleDriveLogo,
	ArrowClockwise,
	ArrowSquareOut,
	Trash,
	PencilSimple,
	Users,
	X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { useI18n } from "@/contexts/I18nContext";
import { signInWithSocial } from "@/lib/auth/recordlyAuth";
import {
	driveApi,
	driveRequest,
	subscribeDriveChanges,
	type DriveOperation,
} from "@/lib/drive/googleDrive";
import type { DriveFile, DrivePermission } from "@/types/googleDrive";
import { useGoogleDrive } from "./useGoogleDrive";
import { AuthSetupNotice } from "@/components/auth/AuthSetupNotice";

const folderMime = "application/vnd.google-apps.folder";
const fieldClass = "h-10 min-w-0 rounded-xl border border-foreground/15 bg-background px-3 text-sm";

export function DriveLibrary() {
	const { t } = useI18n();
	const drive = useGoogleDrive();
	const [files, setFiles] = useState<DriveFile[]>([]);
	const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
	const [nextPage, setNextPage] = useState<string>();
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [transferring, setTransferring] = useState(false);
	const [error, setError] = useState<string>();
	const [progress, setProgress] = useState<number>();
	const [edit, setEdit] = useState<{ action: "rename" | "mkdir"; file?: DriveFile }>();
	const [name, setName] = useState("");
	const [sharing, setSharing] = useState<DriveFile>();
	const [permissions, setPermissions] = useState<DrivePermission[]>([]);
	const [permissionsLoading, setPermissionsLoading] = useState(false);
	const [permissionError, setPermissionError] = useState<string>();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState("reader");
	const request = useRef(0);
	const permissionRequest = useRef(0);
	const currentSharing = useRef(sharing);
	currentSharing.current = sharing;
	const transfer = useRef<DriveOperation | undefined>(undefined);
	const parentId = trail[trail.length - 1]?.id;
	const accountId = drive.user?.id;
	const load = useCallback(
		async (pageToken?: string) => {
			const generation = ++request.current;
			setBusy(true);
			setError(undefined);
			try {
				const result = await driveApi.list(parentId, pageToken, accountId);
				if (generation !== request.current) return;
				setFiles((current) => (pageToken ? [...current, ...result.files] : result.files));
				setNextPage(result.nextPageToken);
			} catch (cause) {
				if (generation === request.current)
					setError(cause instanceof Error ? cause.message : String(cause));
			} finally {
				if (generation === request.current) setBusy(false);
			}
		},
		[parentId, accountId],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing accounts must clear folder and permission state.
	useEffect(() => {
		setTrail([]);
		setFiles([]);
		setSharing(undefined);
		setEdit(undefined);
		return () => {
			request.current++;
			permissionRequest.current++;
			if (transfer.current) {
				transfer.current.canceled = true;
				void window.electronAPI.driveCancel(transfer.current.id);
			}
		};
	}, [accountId]);
	useEffect(() => {
		setFiles([]);
		setNextPage(undefined);
		if (drive.status.connected) void load();
		const changed = () => {
			if (drive.status.connected) void load();
		};
		const unsubscribe = subscribeDriveChanges(changed);
		return () => {
			request.current++;
			unsubscribe();
		};
	}, [drive.status.connected, load]);
	useEffect(
		() =>
			window.electronAPI.onDriveProgress?.((event) => {
				if (event.id === transfer.current?.id)
					setProgress(
						event.total > 0
							? Math.min(99, Math.round((event.transferred / event.total) * 100))
							: undefined,
					);
			}),
		[],
	);
	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(undefined);
		try {
			await action();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
			setTransferring(false);
			setProgress(undefined);
			transfer.current = undefined;
		}
	};
	const upload = () =>
		run(async () => {
			const picked = await window.electronAPI.drivePickUpload();
			if (picked.canceled || !picked.filePath) return;
			transfer.current = { id: crypto.randomUUID(), accountId, canceled: false };
			setTransferring(true);
			setProgress(0);
			const result = await driveApi.upload(picked.filePath, transfer.current, parentId);
			if (!result.success && !result.canceled) throw new Error(result.error);
			await load();
		});
	const loadPermissions = async (file: DriveFile) => {
		const generation = ++permissionRequest.current;
		setPermissionsLoading(true);
		setPermissionError(undefined);
		try {
			const result = await driveApi.permissions(file.id, accountId);
			if (generation === permissionRequest.current) setPermissions(result.permissions);
		} catch (cause) {
			if (generation === permissionRequest.current)
				setPermissionError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (generation === permissionRequest.current) setPermissionsLoading(false);
		}
	};
	const changePermission = async (action: string, input: Record<string, unknown>) => {
		if (!sharing) return;
		setPermissionsLoading(true);
		setPermissionError(undefined);
		try {
			await driveRequest(action, { fileId: sharing.id, ...input }, accountId);
			if (currentSharing.current?.id !== sharing.id) return;
			setEmail("");
			await loadPermissions(sharing);
		} catch (cause) {
			if (currentSharing.current?.id !== sharing.id) return;
			setPermissionError(cause instanceof Error ? cause.message : String(cause));
			setPermissionsLoading(false);
		}
	};
	const connect = () => run(() => signInWithSocial("google"));
	const visible = files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase()));
	return (
		<section className="py-6" aria-label="Google Drive">
			{drive.status.reconnect && (
				<p role="status" className="mb-4 text-sm text-muted">
					{t(
						"editor.signIn.googleErrors.RECONNECT_REQUIRED",
						"Google authorization expired or was revoked. Sign in again.",
					)}
				</p>
			)}
			{drive.sessionOnly && (
				<p role="status" className="mb-4 text-xs text-muted">
					{t(
						"editor.signIn.sessionOnly",
						"This device cannot encrypt saved credentials. Sign-in lasts for this app session only.",
					)}
				</p>
			)}
			<div className="mb-7 flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-3">
					<div className="grid size-12 place-items-center rounded-2xl bg-foreground/5">
						<GoogleDriveLogo className="size-7" />
					</div>
					<div>
						<h2 className="text-lg font-semibold">Google Drive</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{drive.status.connected
								? drive.status.email
								: t("editor.drive.subtitle", "Your recordings, in your own Drive.")}
						</p>
					</div>
				</div>
				{drive.status.connected && (
					<div className="flex gap-2">
						<Button
							variant="ghost"
							disabled={busy}
							onClick={() => void run(() => driveApi.disconnect())}
						>
							{t("editor.drive.disconnect", "Disconnect")}
						</Button>
						<Button
							variant="secondary"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const result = await window.electronAPI.openExternalUrl(
										`https://drive.google.com/drive/folders/${parentId || drive.status.folderId}`,
									);
									if (!result.success) throw new Error(result.error);
								})
							}
						>
							<ArrowSquareOut />
							{t("editor.drive.openDrive", "Open in Drive")}
						</Button>
					</div>
				)}
			</div>
			{(error || drive.driveError) && (
				<p role="alert" className="mb-4 text-sm text-danger">
					{error || drive.driveError}
				</p>
			)}
			{!drive.status.connected ? (
				<div className="flex min-h-72 flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-foreground/15 px-6 text-center">
					<GoogleDriveLogo className="size-12 text-muted-foreground" />
					<div>
						<h3 className="font-medium">
							{t("editor.drive.connectTitle", "Connect your Google Drive")}
						</h3>
						<p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
							{t(
								"editor.drive.connectDescription",
								"Save exports in a Recordly folder, organize files and choose who can view or edit them. Files stay private until you share them.",
							)}
						</p>
					</div>
					<Button disabled={busy || drive.driveLoading} onClick={() => void connect()}>
						{drive.driveLoading
							? t("editor.drive.loading", "Loading…")
							: t("editor.drive.connect", "Sign in with Google and connect Drive")}
					</Button>
					{!drive.configured && <AuthSetupNotice />}
					{drive.authorizing && (
						<Button
							variant="ghost"
							onClick={() => void window.electronAPI.googleAuthCancel()}
						>
							{t("editor.signIn.cancelGoogle", "Cancel browser sign-in")}
						</Button>
					)}
					{drive.driveError && (
						<Button variant="ghost" onClick={() => void drive.refresh()}>
							<ArrowClockwise />
							{t("editor.drive.retry", "Retry")}
						</Button>
					)}
				</div>
			) : (
				<>
					<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
						<nav
							className="flex flex-wrap items-center gap-1 text-sm"
							aria-label={t("editor.drive.location", "Drive folder")}
						>
							<button
								type="button"
								className="rounded-lg px-2 py-1 hover:bg-foreground/5"
								onClick={() => setTrail([])}
							>
								Recordly
							</button>
							{trail.map((folder, index) => (
								<span key={folder.id}>
									{" "}
									/{" "}
									<button
										type="button"
										className="rounded-lg px-2 py-1 hover:bg-foreground/5"
										onClick={() =>
											setTrail((current) => current.slice(0, index + 1))
										}
									>
										{folder.name}
									</button>
								</span>
							))}
						</nav>
						<div className="flex flex-wrap gap-2">
							<input
								className={`${fieldClass} w-44`}
								aria-label={t("editor.drive.search", "Search files")}
								placeholder={t("editor.drive.search", "Search files")}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
							/>
							<Button
								variant="ghost"
								disabled={busy}
								aria-label={t("editor.drive.refresh", "Refresh")}
								onClick={() => void load()}
							>
								<ArrowClockwise />
							</Button>
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => {
									setName("");
									setEdit({ action: "mkdir" });
								}}
							>
								<Folder />
								{t("editor.drive.newFolder", "New folder")}
							</Button>
							<Button disabled={busy} onClick={() => void upload()}>
								<CloudArrowUp />
								{t("editor.drive.upload", "Upload file")}
							</Button>
						</div>
					</div>
					{transferring && (
						<div role="status" className="mb-4 flex items-center gap-3 text-sm">
							<progress className="flex-1" max={100} value={progress} />
							{progress === undefined
								? t("editor.drive.loading", "Loading…")
								: `${progress}%`}
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									if (transfer.current) {
										transfer.current.canceled = true;
										void window.electronAPI.driveCancel(transfer.current.id);
									}
								}}
							>
								{t("editor.drive.cancel", "Cancel")}
							</Button>
						</div>
					)}
					<div className="overflow-x-auto rounded-2xl border border-foreground/10">
						<table className="w-full text-left text-sm">
							<thead className="border-b border-foreground/10 bg-foreground/[.025] text-xs text-muted-foreground">
								<tr>
									<th className="px-5 py-3 font-medium">
										{t("editor.drive.name", "Name")}
									</th>
									<th className="px-4 py-3 font-medium">
										{t("editor.drive.size", "Size")}
									</th>
									<th className="px-4 py-3 font-medium">
										{t("editor.drive.modified", "Modified")}
									</th>
									<th className="px-4 py-3 text-right font-medium">
										{t("editor.drive.actions", "Actions")}
									</th>
								</tr>
							</thead>
							<tbody>
								{visible.map((file) => (
									<tr
										key={file.id}
										className="border-b border-foreground/5 last:border-0 hover:bg-foreground/[.025]"
									>
										<td className="max-w-xs px-5 py-4">
											<button
												type="button"
												className="flex max-w-full items-center gap-3 text-left"
												onClick={() =>
													file.mimeType === folderMime
														? setTrail((current) => [
																...current,
																{ id: file.id, name: file.name },
															])
														: void window.electronAPI.openExternalUrl(
																file.webViewLink ||
																	`https://drive.google.com/file/d/${file.id}/view`,
															)
												}
											>
												{file.mimeType === folderMime ? (
													<Folder className="size-5 shrink-0 text-muted-foreground" />
												) : (
													<GoogleDriveLogo className="size-5 shrink-0 text-muted-foreground" />
												)}
												<span className="truncate">{file.name}</span>
											</button>
										</td>
										<td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
											{file.size
												? `${(Number(file.size) / 1024 / 1024).toFixed(1)} MB`
												: "—"}
										</td>
										<td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
											{file.modifiedTime
												? new Date(file.modifiedTime).toLocaleDateString()
												: "—"}
										</td>
										<td className="px-3 py-3">
											<div className="flex justify-end gap-1">
												{file.mimeType !== folderMime && (
													<Button
														variant="ghost"
														size="icon"
														disabled={
															busy ||
															file.capabilities?.canDownload === false
														}
														title={t(
															"editor.drive.download",
															"Download",
														)}
														onClick={() =>
															void run(async () => {
																transfer.current = {
																	id: crypto.randomUUID(),
																	accountId,
																	canceled: false,
																};
																setTransferring(true);
																setProgress(undefined);
																const result =
																	await driveApi.download(
																		file.id,
																		transfer.current,
																	);
																if (
																	!result.success &&
																	!result.canceled
																)
																	throw new Error(result.error);
															})
														}
													>
														<DownloadSimple />
													</Button>
												)}
												<Button
													variant="ghost"
													size="icon"
													disabled={
														busy || file.capabilities?.canEdit === false
													}
													title={t("editor.drive.rename", "Rename")}
													onClick={() => {
														setName(file.name);
														setEdit({ action: "rename", file });
													}}
												>
													<PencilSimple />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													disabled={
														busy ||
														file.capabilities?.canShare === false
													}
													title={t(
														"editor.drive.permissions",
														"Manage access",
													)}
													onClick={() => {
														setSharing(file);
														setPermissions([]);
														void loadPermissions(file);
													}}
												>
													<Users />
												</Button>
												<Button
													variant="ghost"
													size="icon"
													disabled={
														busy ||
														file.capabilities?.canTrash === false
													}
													title={t("editor.drive.trash", "Move to trash")}
													onClick={() => {
														if (
															window.confirm(
																t(
																	"editor.drive.trashConfirm",
																	"Move this file to Google Drive trash?",
																),
															)
														)
															void run(async () => {
																await driveRequest(
																	"trash",
																	{ fileId: file.id },
																	accountId,
																);
																await load();
															});
													}}
												>
													<Trash />
												</Button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{!visible.length && (
							<p
								role="status"
								className="py-16 text-center text-sm text-muted-foreground"
							>
								{busy
									? t("editor.drive.loading", "Loading…")
									: t(
											"editor.drive.empty",
											"No files here yet. Upload a file or export a video to Drive.",
										)}
							</p>
						)}
					</div>
					{nextPage && (
						<Button
							className="mt-4"
							variant="ghost"
							disabled={busy}
							onClick={() => void load(nextPage)}
						>
							{t("editor.drive.loadMore", "Load more")}
						</Button>
					)}
				</>
			)}
			<Dialog
				open={Boolean(edit)}
				onOpenChange={(open) => {
					if (!open) setEdit(undefined);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{edit?.action === "mkdir"
								? t("editor.drive.newFolder", "New folder")
								: t("editor.drive.rename", "Rename")}
						</DialogTitle>
					</DialogHeader>
					<form
						className="flex gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void run(async () => {
								await driveRequest(
									edit!.action,
									{
										fileId: edit?.file?.id,
										parentId,
										name,
									},
									accountId,
								);
								setEdit(undefined);
								await load();
							});
						}}
					>
						<input
							autoFocus
							required
							aria-label={t("editor.drive.name", "Name")}
							className={`${fieldClass} flex-1`}
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<Button disabled={busy || !name.trim()} type="submit">
							{t("editor.drive.save", "Save")}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={Boolean(sharing)}
				onOpenChange={(open) => {
					if (!open) {
						permissionRequest.current++;
						setSharing(undefined);
						setPermissionError(undefined);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("editor.drive.permissions", "Manage access")}</DialogTitle>
						<DialogDescription>{sharing?.name}</DialogDescription>
					</DialogHeader>
					{permissionError && (
						<p role="alert" className="text-sm text-danger">
							{permissionError}
						</p>
					)}
					<form
						className="flex flex-wrap gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							void changePermission("grant", { type: "user", email, role });
						}}
					>
						<input
							required
							type="email"
							aria-label={t("editor.drive.recipient", "Recipient email")}
							placeholder={t("editor.drive.recipient", "Recipient email")}
							className={`${fieldClass} flex-1`}
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
						<select
							className={fieldClass}
							aria-label={t("editor.drive.role", "Permission")}
							value={role}
							onChange={(event) => setRole(event.target.value)}
						>
							<option value="reader">{t("editor.drive.viewer", "Viewer")}</option>
							<option value="writer">{t("editor.drive.editor", "Editor")}</option>
						</select>
						<Button type="submit" disabled={permissionsLoading}>
							{t("editor.drive.invite", "Invite")}
						</Button>
					</form>
					<ul className="max-h-60 divide-y divide-foreground/10 overflow-y-auto">
						{permissions.map((permission) => (
							<li
								key={permission.id}
								className="flex items-center justify-between gap-3 py-3 text-sm"
							>
								<div>
									<p>
										{permission.type === "anyone"
											? t("editor.drive.anyone", "Anyone with the link")
											: permission.emailAddress ||
												permission.displayName ||
												permission.type}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{permission.role === "owner"
											? t("editor.drive.owner", "Owner")
											: permission.role === "writer"
												? t("editor.drive.editor", "Editor")
												: t("editor.drive.viewer", "Viewer")}
									</p>
								</div>
								{permission.role !== "owner" &&
									!permission.permissionDetails?.some(
										(detail) => detail.inherited,
									) && (
										<Button
											variant="ghost"
											size="sm"
											disabled={permissionsLoading}
											onClick={() =>
												void changePermission("revoke", {
													permissionId: permission.id,
												})
											}
										>
											<X />
											{t("editor.drive.removeAccess", "Remove")}
										</Button>
									)}
							</li>
						))}
					</ul>
					<div className="space-y-3 border-t border-foreground/10 pt-4">
						<p className="text-xs leading-5 text-muted-foreground">
							{t(
								"editor.drive.linkExplanation",
								"Private by default. Enable link access to let anyone with the link view this file. Folder permissions also apply to its contents.",
							)}
						</p>
						{!permissions.some((permission) => permission.type === "anyone") && (
							<Button
								variant="secondary"
								disabled={permissionsLoading}
								onClick={() =>
									void changePermission("grant", {
										type: "anyone",
										role: "reader",
									})
								}
							>
								{t("editor.drive.enableLink", "Enable link viewing")}
							</Button>
						)}
						<Button
							variant="ghost"
							onClick={() =>
								void navigator.clipboard
									.writeText(
										sharing?.webViewLink ||
											`https://drive.google.com/file/d/${sharing?.id}/view`,
									)
									.catch(() =>
										setPermissionError(
											t(
												"editor.drive.copyFailed",
												"Could not copy the link.",
											),
										),
									)
							}
						>
							{t("editor.drive.copyLink", "Copy link")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</section>
	);
}
