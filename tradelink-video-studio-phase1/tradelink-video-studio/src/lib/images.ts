import { supabase } from './supabase';
import { IMAGE_BUCKET, newImagePath, type ImageFolder } from './catalogue';

// Studio's own private bucket only. No marketplace storage is ever touched.

export async function uploadImage(folder: ImageFolder, file: File): Promise<string> {
  if (!supabase) throw new Error('Not configured');
  const path = newImagePath(folder, file.type, crypto.randomUUID());
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/** Best effort: a failed clean-up must never undo a successful save. */
export async function removeImages(paths: Array<string | null | undefined>): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (!supabase || list.length === 0) return;
  try {
    await supabase.storage.from(IMAGE_BUCKET).remove(list);
  } catch {
    /* leave the file; it is only an unused upload */
  }
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!supabase || paths.length === 0) return out;
  const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 3600);
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

export interface ImageChange {
  file: File | null; // a newly chosen image
  removed: boolean; // the current image was removed
  oldPath: string | null; // the image the row has now
}

export type SaveResult = { ok: true } | { ok: false; stage: 'upload' | 'write'; error: { code?: string } };

/**
 * Upload first, write the row, then delete the old file. If the row write fails the new upload is
 * deleted again, so no orphaned files are left behind.
 */
export async function saveWithImage(
  folder: ImageFolder,
  change: ImageChange,
  write: (imagePath: string | null | undefined) => Promise<{ error: { code?: string } | null }>,
): Promise<SaveResult> {
  let newPath: string | null | undefined;
  if (change.file) {
    try {
      newPath = await uploadImage(folder, change.file);
    } catch (e) {
      return { ok: false, stage: 'upload', error: (e as { code?: string }) ?? {} };
    }
  } else if (change.removed) {
    newPath = null;
  }
  const { error } = await write(newPath);
  if (error) {
    if (change.file && typeof newPath === 'string') await removeImages([newPath]);
    return { ok: false, stage: 'write', error };
  }
  if (newPath !== undefined && change.oldPath) await removeImages([change.oldPath]);
  return { ok: true };
}

/** Temporary links for files in the renderer's output buckets (renders, covers). Studio's own storage only. */
export async function signedUrlsIn(bucket: 'renders' | 'covers', paths: string[], downloadName?: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!supabase || paths.length === 0) return out;
  for (const path of paths) {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600, downloadName ? { download: downloadName } : undefined);
    if (data?.signedUrl) out[path] = data.signedUrl;
  }
  return out;
}
