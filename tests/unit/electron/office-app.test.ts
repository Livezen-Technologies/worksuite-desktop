import { describe, expect, it, vi } from 'vitest';
import { OfficeApp, type OfficeAppDeps } from '../../../electron/services/office-app';
import { parseOfficeAppLink } from '@shared/office-open';

function make(over: Partial<OfficeAppDeps> = {}) {
  const opened: string[] = [];
  const audit = vi.fn();
  const deps: OfficeAppDeps = {
    protocolApp: () => 'WorkSuite Office',
    open: async (url) => void opened.push(url),
    account: () => ({ origin: 'https://app.worksuite.lk', userId: '7' }),
    canOpenFiles: () => true,
    audit,
    ...over,
  };
  return { svc: new OfficeApp(deps), opened, audit };
}

describe('WorkSuite Office from this app (#322)', () => {
  it('is installed when a program takes worksuiteoffice:// links', () => {
    const asked: string[] = [];
    expect(make({ protocolApp: (u) => (asked.push(u), 'WorkSuite Office') }).svc.status()).toEqual({ installed: true, appName: 'WorkSuite Office', canOpen: true });
    expect(asked).toEqual(['worksuiteoffice://']);
    expect(make({ protocolApp: () => '' }).svc.status()).toEqual({ installed: false, appName: null, canOpen: false });
    expect(make({ protocolApp: () => { throw new Error('xdg-mime missing'); } }).svc.status().installed).toBe(false);
    expect(make({ canOpenFiles: () => false }).svc.status().canOpen).toBe(false);
  });

  it('hands a Drive file over by its id on the signed-in server, for the signed-in user', async () => {
    const { svc, opened, audit } = make();
    await expect(svc.open({ kind: 'drive', fileId: 42, name: 'Plan.docx', organizationId: '3' })).resolves.toBe(true);
    expect(opened).toHaveLength(1);
    const p = parseOfficeAppLink(opened[0]!);
    expect(p).toEqual({ ok: true, link: { server: 'https://app.worksuite.lk', uid: '7', org: '3', name: 'Plan.docx', doc: { file: 42, mode: null } } });
    // The audit names the file, never the link or the name.
    expect(audit).toHaveBeenCalledWith('office.desktop_app.open', { fileId: 42, mode: null });
  });

  it('hands a copy over by the path this server serves it at', async () => {
    const { svc, opened } = make();
    await svc.open({ kind: 'copy', path: '/media/abcdefgh12345678?download=1', name: 'Bid.xlsx' });
    const p = parseOfficeAppLink(opened[0]!);
    expect(p.ok && p.link.doc).toEqual({ src: '/media/abcdefgh12345678?download=1' });
  });

  it('refuses when it is not installed, nobody is signed in, or the policy says no', async () => {
    await expect(make({ protocolApp: () => '' }).svc.open({ kind: 'drive', fileId: 1, name: 'a.docx' })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(make({ account: () => null }).svc.open({ kind: 'drive', fileId: 1, name: 'a.docx' })).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' });
    await expect(make({ canOpenFiles: () => false }).svc.open({ kind: 'drive', fileId: 1, name: 'a.docx' })).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('never builds a link to a server it should not name', async () => {
    const { svc, opened } = make({ account: () => ({ origin: 'http://intranet.example', userId: '7' }) });
    await expect(svc.open({ kind: 'drive', fileId: 1, name: 'a.docx' })).rejects.toMatchObject({ code: 'IPC_VALIDATION_FAILED' });
    expect(opened).toEqual([]);
  });
});
