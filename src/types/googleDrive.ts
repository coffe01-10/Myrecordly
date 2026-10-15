export type DriveFile = {
	id: string;
	name: string;
	mimeType: string;
	size?: string;
	modifiedTime?: string;
	webViewLink?: string;
	capabilities?: {
		canEdit?: boolean;
		canShare?: boolean;
		canTrash?: boolean;
		canDownload?: boolean;
	};
};

export type DrivePermission = {
	id: string;
	type: string;
	role: string;
	emailAddress?: string;
	displayName?: string;
	permissionDetails?: { inherited?: boolean }[];
};

export type DriveStatus = {
	connected: boolean;
	email?: string;
	folderId?: string;
	reconnect?: boolean;
};

export type DriveTransfer = {
	id: string;
	direction: "upload" | "download";
	accessToken: string;
	uploadUrl?: string;
	filePath?: string;
	file?: DriveFile;
};

export type DriveTransferResult = {
	success: boolean;
	canceled?: boolean;
	error?: string;
	file?: DriveFile;
	filePath?: string;
};
