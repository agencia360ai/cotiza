"use client";

import { createClient } from "@/lib/supabase/client";

const BUCKET = "cotiza-projects";

export async function uploadToProjectsBucket(
  file: File,
  path: string,
): Promise<{ path: string } | { error: string }> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) return { error: error.message };
  return { path };
}
