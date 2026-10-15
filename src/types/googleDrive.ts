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
	configured?: boolean;
	accountId?: string;
	email?: string;
	folderId?: string;
	reconnect?: boolean;
};

export type DriveTransfer = {
	id: string;
	direction: "upload" | "download";
	ticketId: string;
	filePath?: string;
	file?: DriveFile;
};

export type GoogleProfile = {
	id: string;
	email: string;
	name?: string;
	picture?: string;
};

export type GoogleAuthState = {
	revision?: number;
	configured: boolean;
	user: GoogleProfile | null;
	authorizing: boolean;
	reconnect?: boolean;
	sessionOnly?: boolean;
};

export type GoogleResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: string; canceled?: boolean };

export type DriveTransferResult = {
	success: boolean;
	canceled?: boolean;
	error?: string;
	file?: DriveFile;
	filePath?: string;
};
