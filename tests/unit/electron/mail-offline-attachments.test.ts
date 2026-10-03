import { describe, expect, it, vi } from 'vitest';
import { attachmentRisk, extensionOf } from '../../../shared/attachments';
import { defaultFolderOffline, folderOffline, mailBodiesKept, mailListKept } from '../../../shared/mailto';
import { markFromInternet } from '../../../electron/services/quarantine';

/**
 * ENH-MAIL-03 on this computer: what each folder keeps offline (DMO-OFF-01),
 * and attachments that could harm it (DMO-SEC-04).
 */
describe('what a folder keeps on this computer (DMO-OFF-01)', () => {
  it('defaults to recent mail for Inbox, Sent and Drafts, nothing for Archive, headers for the rest', () => {
    expect(['inbox', 'sent', 'drafts', 'archive', 'spam', 'label:Clients'].map(defaultFolderOffline)).toEqual(['recent', 'recent', 'recent', 'online', 'headers', 'headers']);
    expect(folderOffline({ mailFolderOffline: { '3:label:Clients': 'recent' } }, '3', 'label:Clients')).toBe('recent');
    expect(folderOffline({}, null, 'inbox')).toBe('recent');
  });

  it('keeps bodies only where the folder keeps messages, and no list for an online-only folder', () => {
    const prefs = { mailCacheDays: 30, mailFolderOffline: { '3:archive': 'recent' as const, '3:inbox': 'online' as const } };
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?folder=sent&mailbox=3')).toBe(true);
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?folder=label:Clients&mailbox=3')).toBe(false);
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?folder=archive&mailbox=3')).toBe(true);
    expect(mailBodiesKept(prefs, '/api/mail/messages/1?folder=inbox&mailbox=3')).toBe(false);
    expect(mailBodiesKept({ mailCacheDays: 0 }, '/api/mail/messages/1?folder=inbox&mailbox=3')).toBe(false);
    expect(mailListKept(prefs, '/api/mail/messages?folder=inbox&mailbox=3&page=1')).toBe(false);
    expect(mailListKept(prefs, '/api/mail/messages?folder=archive&mailbox=4')).toBe(false);
    expect(mailListKept(prefs, '/api/mail/messages?folder=label:Clients&mailbox=3')).toBe(true);
    expect(mailListKept(prefs, '/api/mail/messages?unified=1&folder=archive')).toBe(true);
    expect(mailListKept(prefs, '/api/mail/folders?mailbox=3')).toBe(true);
  });
});

describe('attachments that could harm this computer (DMO-SEC-04)', () => {
  it('blocks programs and scripts, whatever the case or a trailing dot, and the organisation’s own list', () => {
    expect(attachmentRisk('invoice.pdf.exe')).toBe('blocked');
    expect(attachmentRisk('setup.EXE. ')).toBe('blocked');
    expect(attachmentRisk('run.ps1')).toBe('blocked');
    expect(attachmentRisk('report.docm')).toBe('macro');
    expect(attachmentRisk('report.docx')).toBeNull();
    expect(attachmentRisk('disk.iso')).toBeNull();
    expect(attachmentRisk('disk.iso', ['.ISO'])).toBe('blocked');
    expect(attachmentRisk('README')).toBeNull();
    expect(extensionOf('a.tar.gz')).toBe('gz');
  });

  it('marks a saved attachment as from the internet on macOS and Windows, and leaves Linux alone', async () => {
    const run = vi.fn(async (_cmd: string, _args: string[]) => undefined);
    const write = vi.fn(async (_p: string, _d: string) => undefined);
    expect(await markFromInternet('/Users/a/Downloads/x.zip', 'darwin', run, write)).toBe(true);
    expect(run.mock.calls[0]![0]).toBe('/usr/bin/xattr');
    expect(run.mock.calls[0]![1].slice(0, 2)).toEqual(['-w', 'com.apple.quarantine']);
    expect(await markFromInternet('C:\\Users\\a\\Downloads\\x.zip', 'win32', run, write)).toBe(true);
    expect(write).toHaveBeenCalledWith('C:\\Users\\a\\Downloads\\x.zip:Zone.Identifier', expect.stringContaining('ZoneId=3'));
    expect(await markFromInternet('/home/a/x.zip', 'linux', run, write)).toBe(false);
    expect(await markFromInternet('C:\\x.zip', 'win32', run, async () => Promise.reject(new Error('FAT')))).toBe(false);
  });
});
