import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function ensureAnonymousIdentity(client: SupabaseClient): Promise<User> {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error("We couldn’t restore your private player session.");
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user) throw new Error("We couldn’t create a private player session. Please try again.");
  return data.user;
}
