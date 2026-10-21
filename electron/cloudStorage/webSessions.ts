import { session, type Session } from "electron";

const websiteSessions = new WeakSet<Session>();

export function cloudWebsiteSession(id: string) {
	const partition = session.fromPartition(`persist:${id}`);
	websiteSessions.add(partition);
	return partition;
}

export function isCloudWebsiteSession(partition: Session) {
	return websiteSessions.has(partition);
}
