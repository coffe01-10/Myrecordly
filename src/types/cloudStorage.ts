export const cloudProviders = [
	{ id: "onedrive", name: "OneDrive", mode: "oauth", url: "https://onedrive.live.com/" },
	{ id: "dropbox", name: "Dropbox", mode: "oauth", url: "https://www.dropbox.com/home" },
	{ id: "aliyun", name: "阿里云盘", mode: "web", url: "https://www.alipan.com/drive" },
	{ id: "baidu", name: "百度网盘", mode: "web", url: "https://pan.baidu.com/disk/main" },
	{ id: "quark", name: "夸克网盘", mode: "web", url: "https://pan.quark.cn/list" },
	{ id: "123pan", name: "123 云盘", mode: "web", url: "https://yun.123pan.cn/" },
] as const;
export type CloudProvider = (typeof cloudProviders)[number]["id"];
export type CloudAccount = {
	id: string;
	provider: CloudProvider;
	name: string;
	mode: "oauth" | "web";
	connectedAt: string;
};
export type CloudStorageState = {
	accounts: CloudAccount[];
	authorizing?: CloudProvider;
	runtimeAvailable: boolean;
	sessionOnly: boolean;
};
export type CloudEntry = {
	Path: string;
	Name: string;
	IsDir: boolean;
	Size: number;
	ModTime: string;
};
export type CloudResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; canceled?: boolean };
