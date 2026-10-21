# Cloud account sign-in

Recording and editing work locally without an account or database. The account dialog manages provider connections rather than a Recordly/Supabase identity.

- **OneDrive and Dropbox:** browser OAuth through the bundled rclone runtime. Browse, upload, download, and export finished videos from Recordly.
- **Aliyun, Baidu, Quark, and 123:** official website windows with separate persistent sessions. Complete the provider’s own login and manage files there. A saved website session is not presented as verified API authorization. Website restrictions and verification prompts remain under the provider’s control.
- **Google Drive:** the publisher bundles the desktop OAuth configuration. Users do not register an API application or import JSON. Builds without publisher configuration explain the limitation while other providers remain available.

Provider buttons reopen an existing website session. Use Add separate website session for another independent login; a new session is saved only after its page loads. Connections can be renamed. Removing a local connection clears only this app’s session, not cloud files or the system browser’s session. Revoke server-side grants from the provider’s account settings.

Direct exports save to a `Recordly` folder. Uploading updates a same-name file.

Videos in Google Drive, OneDrive, and Dropbox offer **Import to library** and **+ Add to timeline**. Import saves directly to the configured recordings directory and refreshes the library, without a save dialog. Same-name videos receive numbered filenames. Failed or canceled downloads leave no partial assets.

The plus button downloads and appends the video to the current timeline, or opens it as the first clip in an empty project. A video already imported on the current cloud page can be added without downloading again. Appending uses the existing local clip undo/redo behavior. Non-video downloads retain the native Save As flow.

## Local storage

`cloud-storage/accounts.json` stores labels and provider identifiers. rclone credentials are in an encrypted `accounts.conf`; its random password is stored with the OS safeStorage keyring. Without a secure keyring, direct authorization lasts for the current app run only. Website sessions use distinct Chromium partitions with no Recordly preload.

## Packaging

`npm run build:cloud-runtime` downloads the official rclone runtime. Platform builds run it automatically and include it in the app. OAuth consent can display the rclone application name. No developer keys are requested from end users.

When the runtime cannot be downloaded or the platform is unsupported, the build reports the unavailable component and continues with website sessions. Run the command again when the environment is ready.

For Google, the publisher enables Drive API, registers a Desktop OAuth client, completes the required Google publishing/verification steps, and bundles `public/google-oauth-desktop.json`. Google’s shared rclone client is being retired, so it is not used as a workaround. Existing imported Google configurations remain compatible.

Legacy Supabase/email/GitHub identity code remains separate and is no longer exposed by the primary cloud-account sign-in UI.

See [Chinese guide](authentication.zh-CN.md), [OneDrive](https://rclone.org/onedrive/), [Dropbox](https://rclone.org/dropbox/), and [Google client policy](https://rclone.org/drive/#making-your-own-client-id).
