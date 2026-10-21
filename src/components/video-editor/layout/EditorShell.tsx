import { OnboardingController } from "@/components/auth/OnboardingController";
import { AccountProfileContext } from "@/components/ui/account-avatar";
import { DashboardSettingsContext } from "../dashboard/DashboardSettings";
import { RecordlySignInDialog, type SignInReason } from "@/components/auth/RecordlySignInDialog";
import { useRecordlyAuth } from "@/components/auth/useRecordlyAuth";
import { useVideoSourceRecovery } from "../hooks/useVideoSourceRecovery";
import { useRecordingLibrary } from "../library/useRecordingLibrary";
import { RecordingLibraryPanel } from "../library/RecordingLibraryPanel";
import type { CloudTimelineTarget } from "../cloud/useCloudVideoImport";
import { Button } from "@/components/ui/button";
import {
	lazy,
	Suspense,
	useCallback,
	useMemo,
	useEffect,
	useRef,
	useState,
	type ComponentProps,
} from "react";
import { useSmartCut } from "../smartCut/useSmartCut";
import { useAutomation } from "@/automation/useAutomation";
import { EditorAnnouncementBanner } from "@/components/announcements/EditorAnnouncementBanner";
import { Toaster } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import type { useEditorExportController } from "../export/useEditorExportController";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useTimelineEditingController } from "../hooks/useTimelineEditingController";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";
import type { useEditorProjectController } from "../project/useEditorProjectController";
import { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useEditorUiState } from "../state/useEditorUiState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { CropEditorDialog } from "./CropEditorDialog";
import { EditorDialogs } from "./EditorDialogs";
import { EditorLoadingSkeleton } from "./EditorLoadingSkeleton";
import { EditorHeader } from "./EditorHeader";
import { EditorPreviewPanel } from "./EditorPreviewPanel";
import { EditorSidebar } from "./EditorSidebar";
import { EditorTimelinePanel } from "./EditorTimelinePanel";

const SmartCutPanel = lazy(() => import("../smartCut/SmartCutPanel"));

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	ui: ReturnType<typeof useEditorUiState>;
	presets: ReturnType<typeof useVideoEditorPresets>;
	projectController: ReturnType<typeof useEditorProjectController>;
	editing: ReturnType<typeof useTimelineEditingController>;
	exportController: ReturnType<typeof useEditorExportController>;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	exportDimensions: ReturnType<typeof useExportDimensions>;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
	headerLeftControlsPaddingClass: string;
	hasCaptionsForSidecar: boolean;
	nvidiaCudaExportAvailable: boolean;
	experimentalNvidiaCudaExport: boolean;
	setExperimentalNvidiaCudaExport: (enabled: boolean) => void;
	effectiveShowCursor: boolean;
	previewAspectRatioValue: number;
};

export function EditorShell(props: Props) {
	const [onboardingRequest, setOnboardingRequest] = useState(0);
	const showOnboarding = useCallback(() => setOnboardingRequest((value) => value + 1), []);
	const [signInOpen, setSignInOpen] = useState(false);
	const [signInReason, setSignInReason] = useState<SignInReason>("account");
	const [shareRequestNonce, setShareRequestNonce] = useState(0);
	const auth = useRecordlyAuth();
	const requestSignIn = (reason: SignInReason) => {
		if (reason === "share" && auth.user) {
			setShareRequestNonce((value) => value + 1);
			return;
		}
		setSignInReason(reason);
		setSignInOpen(true);
	};
	const handleAuthenticated = useCallback(() => {
		setSignInOpen(false);
		if (signInReason === "share") setShareRequestNonce((value) => value + 1);
	}, [signInReason]);
	const {
		t,
		project,
		appearance,
		timeline,
		ui,
		presets,
		projectController,
		editing,
		exportController,
		exportSettings,
		exportSession,
		exportDimensions,
		settingsPanelProps,
		headerLeftControlsPaddingClass,
		hasCaptionsForSidecar,
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
		effectiveShowCursor,
		previewAspectRatioValue,
	} = props;
	const library = useRecordingLibrary(project, timeline, ui, appearance);
	useAutomation({
		appearance,
		project,
		timeline,
		ui,
		controller: projectController,
		isPreviewReady: ui.isPreviewReady,
		renderContext: {
			cursorTelemetry: editing.cursor.normalizedCursorTelemetry,
			sourceAudioFallbackPaths: editing.audio.sourceAudioFallbackPaths,
			sourceAudioFallbackStartDelayMsByPath:
				editing.audio.sourceAudioFallbackStartDelayMsByPath,
			sourceAudioTrackSettings: editing.audio.activeSourceAudioTrackSettings,
			effectiveShowCursor,
		},
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing the active inspector closes the Videos view.
	useEffect(() => {
		library.setOpen(false);
	}, [ui.activeEffectSection, library.setOpen]);
	const timelinePanelRef = useRef<HTMLDivElement>(null);
	const wasImporting = useRef(false);
	useEffect(() => {
		if (wasImporting.current && !library.importing) timelinePanelRef.current?.focus();
		wasImporting.current = library.importing;
	}, [library.importing]);
	const { setIsPreviewReady, setPreviewVersion } = ui;
	const remountRecoveredVideo = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((version) => version + 1);
	}, [setIsPreviewReady, setPreviewVersion]);
	const handlePreviewError = useVideoSourceRecovery(project, remountRecoveredVideo);
	const {
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		hasUnsavedChanges,
	} = projectController;
	const {
		cursor,
		projection,
		audio,
		playback,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		annotationCommands,
		handleSelectAnnotation,
		handleAutoSuggestZoomsConsumed,
	} = editing;
	const { dialogActions, status: exportStatus, exportMessage } = exportController;
	const smartCut = useSmartCut(
		project.videoSourcePath,
		timeline,
		ui,
		cursor.normalizedCursorTelemetry,
		playback.startPlayback,
	);
	useEffect(() => {
		if (project.projectBrowserOpen) smartCut.close();
	}, [project.projectBrowserOpen, smartCut.close]);
	const dashboardSettingsContent = useMemo(
		() => (
			<SettingsPanel
				{...settingsPanelProps}
				onShowOnboarding={showOnboarding}
				activeEffectSection="settings"
				selectedAnnotationId={null}
				selectedClipId={null}
				advanced
			/>
		),
		[settingsPanelProps, showOnboarding],
	);
	const onboarding = (
		<OnboardingController
			requestNonce={onboardingRequest}
			ready={!project.loading && !auth.loading}
			user={auth.user}
			configured={auth.configured}
			callbackError={auth.callbackError}
		/>
	);
	const cloudTimelineTarget: CloudTimelineTarget = {
		projectKey: project.currentProjectPath ?? project.videoSourcePath,
		add: async (path) => {
			const added = project.videoSourcePath
				? await library.addToTimeline(path)
				: await openActions.handleOpenMediaAtPath(path);
			if (added) {
				project.setProjectBrowserOpen(false);
				library.setOpen(true);
				void library.refresh();
			}
			return added;
		},
		cancel: library.cancelImport,
	};
	const editorDialogs = (
		<AccountProfileContext.Provider value={auth.user}>
			<DashboardSettingsContext.Provider value={dashboardSettingsContent}>
				<EditorDialogs
					t={t}
					projectSaveDialogOpen={project.projectSaveDialogOpen}
					setProjectSaveDialogOpen={project.setProjectSaveDialogOpen}
					projectSaveDialogDraft={project.projectSaveDialogDraft}
					setProjectSaveDialogDraft={project.setProjectSaveDialogDraft}
					projectSaveDialogInputRef={ui.projectSaveDialogInputRef}
					isSavingProjectDialog={project.isSavingProjectDialog}
					resolveProjectSaveDialog={lifecycle.resolveProjectSaveDialog}
					handleProjectSaveDialogSubmit={saveActions.handleProjectSaveDialogSubmit}
					unsavedChangesDialogOpen={project.unsavedChangesDialogOpen}
					setUnsavedChangesDialogOpen={project.setUnsavedChangesDialogOpen}
					unsavedChangesDialogActionLabel={project.unsavedChangesDialogActionLabel}
					resolveUnsavedChangesDialog={lifecycle.resolveUnsavedChangesDialog}
					projectBrowserOpen={project.projectBrowserOpen}
					setProjectBrowserOpen={project.setProjectBrowserOpen}
					projectLibraryEntries={project.projectLibraryEntries}
					projectLibraryLoading={project.projectLibraryLoading}
					projectError={project.error}
					onDashboardSignIn={() => requestSignIn("account")}
					onDeleteProjects={openActions.handleDeleteProjects}
					onRenameProject={openActions.handleRenameLibraryProject}
					onShareProject={async (path) => {
						if (
							path !== project.currentProjectPath &&
							!(await openActions.handleOpenProjectFromLibrary(path))
						)
							return;
						project.setProjectBrowserOpen(false);
						if (!auth.user) requestSignIn("share");
						else setShareRequestNonce((value) => value + 1);
					}}
					accountLabel={auth.user?.email || auth.user?.user_metadata.full_name}
					authToken={auth.accessToken}
					cloudTimelineTarget={cloudTimelineTarget}
					handleImportMediaOrProject={openActions.handleImportMediaOrProject}
					handleOpenProjectFromLibrary={openActions.handleOpenProjectFromLibrary}
					nativeCaptureUnavailableModalOpen={ui.nativeCaptureUnavailableModalOpen}
					setNativeCaptureUnavailableModalOpen={ui.setNativeCaptureUnavailableModalOpen}
				/>
			</DashboardSettingsContext.Provider>
		</AccountProfileContext.Provider>
	);
	if (project.loading && !project.error)
		return (
			<>
				<EditorLoadingSkeleton />
				<RecordlySignInDialog
					timelineTarget={cloudTimelineTarget}
					open={signInOpen}
					onOpenChange={setSignInOpen}
					reason={signInReason}
					user={auth.user}
					configured={auth.configured}
					callbackError={auth.callbackError}
					onAuthenticated={handleAuthenticated}
				/>
				{editorDialogs}
				{onboarding}
				<Toaster className="pointer-events-auto" />
			</>
		);
	if (project.error)
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<div role="alert" className="max-w-xl break-words text-center text-destructive">
						{project.error}
					</div>
					<Button
						variant="ghost"
						ref={ui.projectBrowserFallbackTriggerRef}
						type="button"
						onClick={openActions.handleOpenProjectBrowser}
						className="px-3 py-1.5 text-sm"
					>
						{t("editor.project.openProjects", "Open Projects")}
					</Button>
				</div>
				<RecordlySignInDialog
					timelineTarget={cloudTimelineTarget}
					open={signInOpen}
					onOpenChange={setSignInOpen}
					reason={signInReason}
					user={auth.user}
					configured={auth.configured}
					callbackError={auth.callbackError}
					onAuthenticated={handleAuthenticated}
				/>
				{editorDialogs}
				{onboarding}
				<Toaster className="pointer-events-auto" />
			</div>
		);

	return (
		<div className="editor-shell flex h-screen flex-col overflow-hidden bg-editor-bg text-foreground selection:bg-accent/20">
			<EditorHeader
				smartCutOpen={smartCut.open}
				smartCutDisabled={
					!ui.isPreviewReady ||
					library.importing ||
					exportStatus.shouldSuspendPreviewRendering
				}
				onToggleSmartCut={() => {
					library.setOpen(false);
					if (smartCut.open) smartCut.close();
					else smartCut.setOpen(true);
				}}
				clipsOpen={library.open}
				onToggleClips={() => {
					smartCut.close();
					library.setOpen((open) => !open);
				}}
				t={t}
				headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
				project={project}
				projectBrowserTriggerRef={ui.projectBrowserTriggerRef}
				projectNameInputRef={ui.projectNameInputRef}
				projectDisplayName={snapshot.projectDisplayName}
				hasUnsavedChanges={hasUnsavedChanges}
				canUndo={history.canUndo}
				canRedo={history.canRedo}
				handleOpenProjectBrowser={openActions.handleOpenProjectBrowser}
				handleUndo={history.handleUndo}
				handleRedo={history.handleRedo}
				handleProjectNameSubmit={saveActions.handleProjectNameSubmit}
				closeProjectNameEditor={saveActions.closeProjectNameEditor}
				presets={presets}
				exportSettings={exportSettings}
				exportSession={exportSession}
				exportDimensions={exportDimensions}
				exportStatus={exportStatus}
				hasCaptionsForSidecar={hasCaptionsForSidecar}
				nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
				experimentalNvidiaCudaExport={experimentalNvidiaCudaExport}
				setExperimentalNvidiaCudaExport={setExperimentalNvidiaCudaExport}
				handleOpenExportDropdown={dialogActions.handleOpenExportDropdown}
				handleExportDropdownClose={dialogActions.handleExportDropdownClose}
				handleCancelExport={dialogActions.handleCancelExport}
				handleRetrySaveExport={dialogActions.handleRetrySaveExport}
				handleStartExportFromDropdown={dialogActions.handleStartExportFromDropdown}
				prepareExportForShare={dialogActions.prepareExportForShare}
				onRequestShareSignIn={() => requestSignIn("share")}
				shareRequestNonce={shareRequestNonce}
				authToken={auth.accessToken}
				accountId={auth.user?.id}
				revealExportedFile={dialogActions.revealExportedFile}
				exportMessage={exportMessage}
			/>
			<EditorAnnouncementBanner />
			<div
				className="relative flex min-h-0 flex-1 flex-col"
				onPointerDownCapture={(event) => {
					if ((event.target as HTMLElement).closest("[data-timeline-item]"))
						library.setOpen(false);
				}}
			>
				<div className="editor-workspace relative z-10 min-h-0 flex-1">
					<EditorSidebar
						accountUser={auth.user}
						onAccountClick={() => requestSignIn("account")}
						panelContent={
							smartCut.open ? (
								<Suspense
									fallback={
										<div className="p-4" role="status">
											{t("editor.smartCut.title", "Smart cut")}…
										</div>
									}
								>
									<SmartCutPanel cut={smartCut} />
								</Suspense>
							) : library.open ? (
								<RecordingLibraryPanel library={library} />
							) : undefined
						}
						t={t}
						activeSection={ui.activeEffectSection}
						setActiveSection={(section) => {
							smartCut.close();
							library.setOpen(false);
							timeline.setSelectedAnnotationId(null);
							timeline.setSelectedZoomId(null);
							timeline.setSelectedClipId(null);
							timeline.setSelectedAudioId(null);
							timeline.setSelectedCaptionId(null);
							ui.setActiveEffectSection(section);
						}}
						settingsPanelProps={{
							...settingsPanelProps,
							onShowOnboarding: showOnboarding,
						}}
					/>
					<EditorPreviewPanel
						t={t}
						videoPath={project.videoPath}
						previewVersion={ui.previewVersion}
						aspectRatio={ui.aspectRatio}
						setAspectRatio={ui.setAspectRatio}
						previewAspectRatioValue={previewAspectRatioValue}
						videoPlaybackRef={ui.videoPlaybackRef}
						timelineRef={ui.timelineRef}
						currentTime={ui.currentTime}
						isPlaying={ui.isPlaying}
						previewVolume={ui.previewVolume}
						setPreviewVolume={ui.setPreviewVolume}
						suspendRendering={
							project.projectBrowserOpen || exportStatus.shouldSuspendPreviewRendering
						}
						appearance={appearance}
						timeline={timeline}
						audio={audio}
						projection={projection}
						playback={playback}
						zoomCommands={zoomCommands}
						annotationCommands={annotationCommands}
						effectiveCursorTelemetry={cursor.effectiveCursorTelemetry}
						effectiveShowCursor={effectiveShowCursor}
						isCropped={ui.isCropped}
						handleOpenCropEditor={ui.handleOpenCropEditor}
						handleSaveAutoCaptionEdit={autoCaption.handleSaveAutoCaptionEdit}
						handleSelectAnnotation={handleSelectAnnotation}
						setDuration={ui.setDuration}
						isPreviewReady={ui.isPreviewReady}
						setIsPreviewReady={ui.setIsPreviewReady}
						setCurrentTime={ui.setCurrentTime}
						setIsPlaying={ui.setIsPlaying}
						setError={handlePreviewError}
					/>
				</div>
				<EditorTimelinePanel
					panelRef={timelinePanelRef}
					timelineRef={ui.timelineRef}
					timeline={timeline}
					projection={projection}
					playback={playback}
					audio={audio}
					zoomCommands={zoomCommands}
					clipCommands={clipCommands}
					audioCommands={audioCommands}
					captionCommands={captionCommands}
					annotationCommands={annotationCommands}
					videoPath={project.videoPath}
					videoSourcePath={project.videoSourcePath}
					cursorTelemetrySourcePath={timeline.cursorTelemetrySourcePath}
					normalizedCursorTelemetry={cursor.normalizedCursorTelemetry}
					autoSuggestZoomsTrigger={ui.autoSuggestZoomsTrigger}
					handleAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
					disableSuggestedZooms={!appearance.autoApplyFreshRecordingAutoZooms}
					currentTime={ui.currentTime}
					handleSelectAnnotation={handleSelectAnnotation}
				/>
			</div>
			{library.importing && (
				<div
					className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
					role="status"
					aria-live="polite"
				>
					<div className="rounded-xl border border-separator bg-background p-6 text-center">
						<p className="font-medium">{t("editor.cloud.addingVideo")}</p>
						<p className="mt-2 text-sm text-muted-foreground">
							{t("editor.cloud.preparingFootage")}
						</p>
						<Button
							className="mt-4"
							variant="ghost"
							size="sm"
							disabled={library.cancelling}
							onClick={() => void library.cancelImport()}
						>
							{t("common.actions.cancel", "Cancel")}
						</Button>
					</div>
				</div>
			)}
			<RecordlySignInDialog
				timelineTarget={cloudTimelineTarget}
				open={signInOpen}
				onOpenChange={setSignInOpen}
				reason={signInReason}
				user={auth.user}
				configured={auth.configured}
				callbackError={auth.callbackError}
				onAuthenticated={handleAuthenticated}
			/>
			{editorDialogs}
			{onboarding}
			<CropEditorDialog
				open={ui.showCropModal}
				t={t}
				videoElement={ui.videoPlaybackRef.current?.video ?? null}
				cropRegion={appearance.cropRegion}
				setCropRegion={appearance.setCropRegion}
				aspectRatio={ui.aspectRatio}
				onCancel={ui.handleCancelCropEditor}
				onDone={ui.handleCloseCropEditor}
			/>
			<Toaster className="pointer-events-auto" />
		</div>
	);
}
