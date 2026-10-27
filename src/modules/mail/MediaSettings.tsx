import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { app, updatePrefs } from '../../core/app-state';
import { text } from '../../core/i18n';
import { useStore } from '../../core/store';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, TextField } from '../../components/ui';
import { mailMediaPrefs, type AutoDownload, type AutoDownloadType, type MailMediaPrefs } from '@shared/mail-media';
import { flatten, tree as loadTree } from '../files/api';
import { useMailPrefs, useMailboxes } from './api';
import { normaliseDomain, normaliseEmail, ownDomains, type RemoteImagesMode } from './images';
import { SectionHeader, SettingsGroup } from '../../components/SettingsKit';

/**
 * Settings › Mail › Images & media (worksuite-desktop#163).
 *
 * Pictures from the web and whom to trust are the person's on every device —
 * kept with Mail's settings on the server. What this computer downloads
 * ahead, on which connection, and where it keeps it are this computer's own.
 */
const MODES: Array<{ value: RemoteImagesMode; label: string; hint: string }> = [
  { value: 'always', label: 'Always', hint: 'Pictures load in every message, through WorkSuite — except in Junk and in mail that failed its checks.' },
  { value: 'ask', label: 'Ask', hint: 'Pictures stay hidden until you choose Show images, or the sender is trusted.' },
  { value: 'trusted', label: 'Only from trusted senders', hint: 'Pictures load only from the senders and domains below.' },
  { value: 'never', label: 'Never', hint: 'Pictures from the web never load. Pictures inside a message still show.' },
];

const AUTO: Array<{ value: AutoDownload; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: '5', label: 'Under 5 MB' },
  { value: '25', label: 'Under 25 MB' },
  { value: 'all', label: 'All' },
];

const TYPES: Array<{ value: AutoDownloadType; label: string }> = [
  { value: 'images', label: 'Images' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'office', label: 'Office documents' },
  { value: 'all', label: 'All' },
];

/** The chosen kinds after one is ticked or unticked: "All" alone, or the kinds without it; never none. */
export function toggleType(types: readonly AutoDownloadType[], t: AutoDownloadType, on: boolean): AutoDownloadType[] {
  if (t === 'all') return on ? ['all'] : ['images', 'pdf', 'office'];
  const from: AutoDownloadType[] = types.includes('all') ? ['images', 'pdf', 'office'] : [...types];
  const rest = from.filter((x) => x !== t);
  const next = on ? [...rest, t] : rest;
  return next.length ? next : ['all'];
}

export function MediaSettings() {
  const mail = useMailPrefs();
  const boxes = useMailboxes();
  const me = useStore(app, (s) => s.bootstrap?.user ?? null);
  const prefs = useStore(app, (s) => s.prefs);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const media = mailMediaPrefs(prefs);
  const folders = useQuery({ queryKey: ['files', 'tree'], queryFn: ({ signal }) => loadTree(signal), enabled: media.saveTo === 'files', staleTime: 5 * 60_000 });
  if (!prefs) return null;
  const setMedia = (patch: Partial<MailMediaPrefs>) => void updatePrefs({ mailMedia: { ...media, ...patch } });
  const senders = mail.prefs.imageSenders ?? [];
  const domains = mail.prefs.imageDomains ?? [];
  const own = ownDomains([...(boxes.data?.mailboxes ?? []).map((b) => b.email), me?.email]);
  const mode = mail.prefs.remoteImages ?? 'ask';
  const add = () => {
    const email = normaliseEmail(adding);
    const domain = email ? null : normaliseDomain(adding);
    if (!email && !domain) return setError(text('Type an email address (ann@example.com) or a domain (example.com).'));
    setError(null);
    setAdding('');
    if (email) mail.set({ imageSenders: [...senders.filter((x) => x !== email), email].slice(-500) });
    else if (domain) mail.set({ imageDomains: [...domains.filter((x) => x !== domain), domain].slice(-500) });
  };
  const trusted = [...senders.map((v) => ({ v, kind: 'sender' as const })), ...domains.map((v) => ({ v, kind: 'domain' as const }))];
  const folderRows = flatten(folders.data?.tree ?? []);
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={text('Images & media')} />
      <SettingsGroup title={text('Pictures from the web')} description={text('A picture from the web tells its sender that, when and where you opened the message. Allowed pictures load through WorkSuite, so the sender sees WorkSuite, not you, and are kept on this computer. Tracking pixels are always removed.')}>
        <div className="px-[18px] py-3.5">
        <div className="mt-3 max-w-[360px]">
          <Select label={text('Load remote images')} value={mode} options={MODES.map((m) => ({ value: m.value, label: text(m.label) }))} onValueChange={(v) => mail.set({ remoteImages: v })} />
        </div>
        <p className="mt-1.5 text-[12.5px] text-ink-3">{text(MODES.find((m) => m.value === mode)?.hint ?? '')}</p>
        <label className="mt-3 flex items-center gap-2.5 text-[13.5px] text-ink-3" title={text('Pictures never load by themselves in Junk. You can still show them for one message.')}>
          <Checkbox checked={false} disabled onChange={() => undefined} />
          {text('Load images in Junk')}
          <span className="text-[12px]">· {text('always off')}</span>
        </label>
        <h4 className="mt-4 text-[13.5px] font-bold text-ink">{text('Trusted senders and domains')}</h4>
        <label className="mt-2 flex items-center gap-2.5 text-[13.5px] text-ink">
          <Checkbox checked={mail.prefs.trustOwnDomains !== false} onChange={(e) => mail.set({ trustOwnDomains: e.target.checked })} />
          {own.length ? text('Trust my organisation’s domains ({domains})', { domains: own.join(', ') }) : text('Trust my organisation’s domains')}
        </label>
        <div className="mt-3 flex max-w-[520px] items-end gap-2">
          <TextField
            label={text('Add a sender or domain')}
            placeholder="ann@example.com, example.com"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? add() : undefined)}
            error={error}
            className="flex-1"
          />
          <Button onClick={add} disabled={!adding.trim()}>
            Add
          </Button>
        </div>
        {trusted.length ? (
          <ul role="list" aria-label={text('Trusted senders and domains')} className="mt-3 max-w-[520px] overflow-hidden rounded-[10px] border border-line">
            {trusted.map((t) => (
              <li key={`${t.kind}:${t.v}`} className="flex items-center gap-2 border-b border-line px-3 py-2 text-[13px] last:border-b-0">
                <Icon name={t.kind === 'sender' ? 'user' : 'globe'} size={14} className="text-ink-3" />
                <span className="min-w-0 flex-1 truncate text-ink">{t.v}</span>
                <span className="text-[12px] text-ink-3">{t.kind === 'sender' ? text('Sender') : text('Domain')}</span>
                <button
                  type="button"
                  aria-label={text('Remove {name}', { name: t.v })}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-subtle hover:text-ink"
                  onClick={() => (t.kind === 'sender' ? mail.set({ imageSenders: senders.filter((x) => x !== t.v) }) : mail.set({ imageDomains: domains.filter((x) => x !== t.v) }))}
                >
                  <Icon name="x" size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12.5px] text-ink-3">{text('Nobody yet. Choose Always show from… above a message, or add one here.')}</p>
        )}
        </div>
      </SettingsGroup>
      <SettingsGroup title={text('Attachments on this computer')} description={text('Downloaded with the messages Mail keeps offline, encrypted in the local mail store, so they open at once — also offline. Never a file WorkSuite blocks, and never from Junk.')}>
        <div className="px-[18px] py-3.5">
        <div className="mt-3 grid max-w-[720px] grid-cols-2 gap-4">
          <Select label={text('Auto-download attachments')} value={media.autoDownload} options={AUTO.map((a) => ({ value: a.value, label: text(a.label) }))} onValueChange={(v) => setMedia({ autoDownload: v })} />
          <Select
            label={text('Auto-download on')}
            value={media.network}
            disabled={media.autoDownload === 'off'}
            options={[
              { value: 'any', label: text('Wi-Fi or any network') },
              { value: 'unmetered', label: text('Not on a metered connection or mobile hotspot') },
            ]}
            onValueChange={(v) => setMedia({ network: v })}
          />
        </div>
        {media.network === 'unmetered' && media.autoDownload !== 'off' ? (
          <div className="mt-3 max-w-[720px] rounded-[10px] bg-subtle p-3 text-[12.5px] text-ink-2">
            <label className="flex items-center gap-2.5 text-[13.5px] text-ink">
              <Checkbox checked={!!prefs.drive.meteredConnection} onChange={(e) => void updatePrefs({ drive: { ...prefs.drive, meteredConnection: e.target.checked } })} />
              {text('This connection is metered')}
            </label>
            <p className="mt-1.5">{text('Windows, macOS and Linux do not tell apps reliably whether a connection is metered, so WorkSuite does not guess: turn this on while you use a mobile hotspot or a connection with a data allowance. It is the same switch as Drive › Settings.')}</p>
          </div>
        ) : null}
        <fieldset className="mt-4" disabled={media.autoDownload === 'off'}>
          <legend className="text-[13.5px] font-semibold text-ink">{text('Download types')}</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-[13.5px] text-ink">
            {TYPES.map((t) => (
              <label key={t.value} className="flex items-center gap-2">
                <Checkbox checked={media.types.includes(t.value) || (t.value !== 'all' && media.types.includes('all'))} onChange={(e) => setMedia({ types: toggleType(media.types, t.value, e.target.checked) })} />
                {text(t.label)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid max-w-[720px] grid-cols-2 gap-4">
          <Select
            label={text('Save attachments to')}
            value={media.saveTo}
            options={[
              { value: 'local', label: text('Local cache only') },
              { value: 'files', label: text('Also save to a WorkSuite Files folder…') },
            ]}
            onValueChange={(v) => setMedia({ saveTo: v })}
          />
          {media.saveTo === 'files' ? (
            <Select
              label={text('Files folder')}
              value={media.filesFolder ? String(media.filesFolder.id) : ''}
              options={[{ value: '', label: text('My Drive') }, ...folderRows.map((f) => ({ value: String(f.id), label: `${' '.repeat(f.depth * 2)}${f.name}` }))]}
              onValueChange={(v) => {
                const row = folderRows.find((f) => String(f.id) === v);
                setMedia({ filesFolder: row ? { id: row.id, name: row.name } : null });
              }}
              searchable
            />
          ) : null}
        </div>
        {media.saveTo === 'files' ? <p className="mt-1.5 text-[12.5px] text-ink-3">{text('Each attachment downloaded ahead is also filed in Files by the server, where it versions and shares like any other file.')}</p> : null}
        </div>
      </SettingsGroup>
    </div>
  );
}
