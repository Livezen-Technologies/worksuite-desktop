import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalWorkspace } from '../../../electron/services/local-workspace';
import { LocalWorkspaceImport, importPayload, type ImportAccount, type ImportClient } from '../../../electron/services/local-workspace-import';
const stores: LocalWorkspace[] = [];
afterEach(() => { stores.splice(0).forEach((store) => store.close()); });
const account: ImportAccount = { key: 'user-1-org-7', name: 'One', organization: 'Seven', orgId: '7', timezone: 'Asia/Colombo' };
function fixture() {
  const store = new LocalWorkspace(':memory:'); stores.push(store);
  const note = store.save({ kind: 'note', title: 'Duplicate title', body: '<script>private</script> & text', completed: false, start: null, end: null, due: null, reminder: null });
  let selected: ImportAccount | null = account;
  const client = { get: vi.fn<ImportClient['get']>(async () => [{ title: note.title }]), post: vi.fn<ImportClient['post']>(async () => ({ id: 123 })) };
  const importer = new LocalWorkspaceImport(store, () => selected);
  return { store, note, client, importer, change: (next: ImportAccount | null) => { selected = next; } };
}
describe('consented, account-bound guest import', () => {
  it('never uploads on initialization or review, defaults to skipping potential duplicates, and uses idempotent writes for explicit copies', async () => {
    const { store, note, client, importer } = fixture();
    expect(client.post).not.toHaveBeenCalled();
    const review = await importer.review(client);
    expect(review.rows[0]).toMatchObject({ duplicate: true, alreadyImported: false }); expect(client.post).not.toHaveBeenCalled();
    expect(await importer.run(review.token, [note.id], false)).toMatchObject({ imported: 0, skipped: 1 });
    expect(await importer.run(review.token, [note.id], true)).toMatchObject({ imported: 1 });
    expect(client.post).toHaveBeenCalledWith('/api/notes', expect.objectContaining({ body: '<p>&lt;script&gt;private&lt;/script&gt; &amp; text</p>' }), expect.stringMatching(/^local-import-[a-f0-9]{64}$/));
    expect(await importer.run(review.token, [note.id], true)).toMatchObject({ imported: 0, skipped: 1 }); expect(client.post).toHaveBeenCalledTimes(1);
    expect(store.read().items).toHaveLength(1);
  });
  it('rejects changed accounts and local edits after review', async () => {
    const { note, client, importer, store, change } = fixture();
    const review = await importer.review(client); change({ ...account, key: 'other-account' });
    await expect(importer.run(review.token, [note.id], true)).rejects.toThrow('account changed'); expect(client.post).not.toHaveBeenCalled();
    change(account); store.save({ ...note, title: 'Edited after review' });
    await expect(importer.run(review.token, [note.id], true)).rejects.toThrow('after review'); expect(client.post).not.toHaveBeenCalled();
  });
  it('records partial failures without deleting originals and retries with the same key', async () => {
    const { note, client, importer, store } = fixture(); client.post.mockRejectedValueOnce(new Error('offline'));
    const review = await importer.review(client);
    expect(await importer.run(review.token, [note.id], true)).toMatchObject({ imported: 0, failures: [{ title: note.title, message: 'offline' }] });
    expect(await importer.run(review.token, [note.id], true)).toMatchObject({ imported: 1 });
    expect(client.post.mock.calls[0]![2]).toBe(client.post.mock.calls[1]![2]); expect(store.read().items).toHaveLength(1);
  });
  it('maps completed tasks and absolute event times to the destination account without company records', () => {
    const { note } = fixture();
    expect(importPayload({ ...note, kind: 'task', completed: true, due: '2026-10-02T09:00:00Z' }, account)).toMatchObject({ status: 'done', org_id: '7', due_at: '2026-10-02T09:00:00Z' });
    expect(importPayload({ ...note, kind: 'event', start: '2026-10-02T09:00:00Z', end: '2026-10-02T10:00:00Z' }, account)).toMatchObject({ start: '2026-10-02 14:30:00', end: '2026-10-02 15:30:00' });
  });
});
