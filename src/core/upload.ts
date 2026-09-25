import { apiPost, request } from './api';

/**
 * Uploads an in-memory blob (a pasted screenshot, FR-XFR-05) through
 * WorkSuite's chunked upload API. Files that exist on disk go through the
 * main process's transfer manager instead; this is only for data that never
 * had a path.
 */
export async function uploadBlob(blob: Blob, name: string, target: { kind: 'chat'; roomId: string } | { kind: 'files'; folderId: string | null }, onProgress?: (fraction: number) => void): Promise<{ uploadId: string; fileId: number | null }> {
  const chunkSize = 5 * 1024 * 1024;
  const init = await apiPost<{ upload_id: string; chunk_size: number; total_chunks: number }>('/api/uploads/init', {
    filename: name,
    total_size: blob.size,
    chunk_size: chunkSize,
    mime_type: blob.type || undefined,
    ...(target.kind === 'chat' ? { purpose: 'chat', room_id: target.roomId } : { purpose: 'drive', folder_id: target.folderId }),
  });
  const size = Number(init.chunk_size) || chunkSize;
  const total = Number(init.total_chunks) || Math.ceil(blob.size / size);
  for (let i = 0; i < total; i++) {
    const form = new FormData();
    form.set('chunk_index', String(i));
    form.set('chunk', blob.slice(i * size, (i + 1) * size), name);
    await request('POST', `/api/uploads/${init.upload_id}/chunk`, { body: form });
    onProgress?.((i + 1) / total);
  }
  const done = await apiPost<{ file_id?: number }>(`/api/uploads/${init.upload_id}/complete`, {});
  return { uploadId: init.upload_id, fileId: done.file_id ?? null };
}
