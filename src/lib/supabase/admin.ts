import "server-only";
import { createClient } from "@supabase/supabase-js";

let cached: ReturnType<typeof createClient> | null = null;

export class MissingServiceRoleKeyError extends Error {
  constructor() {
    super("SUPABASE_SERVICE_ROLE_KEY no está configurada");
    this.name = "MissingServiceRoleKeyError";
  }
}

export function hasAdminCredentials(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Server-only Supabase client with the service role key — bypasses RLS.
 * Use for admin operations: creating auth users, listing all members of an org,
 * inviting people, etc. NEVER expose this to the client.
 */
export function createAdminClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new MissingServiceRoleKeyError();
  }
  cached = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "cotiza" as never },
  });
  return cached;
}
