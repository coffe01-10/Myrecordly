import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import { googleDriveHandler } from "./handler.ts";

const client = createClient(
	Deno.env.get("SUPABASE_URL")!,
	Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
	{
		auth: { persistSession: false, autoRefreshToken: false },
	},
);
Deno.serve(
	googleDriveHandler({
		clientId: Deno.env.get("GOOGLE_CLIENT_ID")!,
		clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
		async authenticate(token) {
			const { data, error } = await client.auth.getUser(token);
			return error ? null : (data.user?.id ?? null);
		},
		async read(userId) {
			const { data, error } = await client
				.from("google_drive_connections")
				.select("*")
				.eq("user_id", userId)
				.maybeSingle();
			if (error) throw error;
			return data;
		},
		async save(connection) {
			const { error } = await client.from("google_drive_connections").upsert(connection);
			if (error) throw error;
		},
		async remove(userId) {
			const { error } = await client
				.from("google_drive_connections")
				.delete()
				.eq("user_id", userId);
			if (error) throw error;
		},
	}),
);
