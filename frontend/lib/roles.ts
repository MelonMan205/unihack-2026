import type { SupabaseClient } from "@supabase/supabase-js";

export async function getUserRoles(client: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await client.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((row) => String(row.role));
}

export async function isAdminUser(client: SupabaseClient, userId: string): Promise<boolean> {
  const roles = await getUserRoles(client, userId);
  return roles.includes("admin");
}

export async function isOrganizerUser(client: SupabaseClient, userId: string): Promise<boolean> {
  const roles = await getUserRoles(client, userId);
  return roles.includes("organizer") || roles.includes("admin");
}
