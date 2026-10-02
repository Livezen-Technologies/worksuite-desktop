import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { text } from '../../core/i18n';
import { dateLabel } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Button, Empty, ErrorNote, Modal, Spinner, TextField } from '../../components/ui';

/**
 * Mail app passwords (Mail SRS v2.2 MAIL-V2-11, design L11): for Apple Mail,
 * Outlook or a phone reading a WorkSuite mailbox. Created per client and
 * shown once with the server settings; listed with when each was last used;
 * revoked one by one or all at once. The WorkSuite password never works for
 * mail (MAIL-V2-12).
 */

interface AppPassword {
  id: number;
  name: string;
  username: string;
  mailbox: { id: number; email: string };
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface Created {
  password: string;
  settings: { username: string; imap: { host: string; port: number; security: string }; smtp: { host: string; port: number; security: string } };
}

export function AppPasswords({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['mail', 'app-passwords'],
    queryFn: () => apiGet<{ mailboxes: Array<{ id: number; email: string; accepted: boolean }>; passwords: AppPassword[] }>('/api/profile/mail-app-passwords'),
    retry: false,
  });
  const [box, setBox] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['mail', 'app-passwords'] });
  const mailboxes = q.data?.mailboxes ?? [];
  const live = (q.data?.passwords ?? []).filter((p) => !p.revoked_at);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setShown(await apiPost<Created>('/api/profile/mail-app-passwords', { mailbox_id: Number(box || mailboxes[0]?.id), name: name.trim() }));
      setName('');
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (path: string, done: string) => {
    try {
      if (path === 'all') await apiPost('/api/profile/mail-app-passwords/revoke-all');
      else await apiDelete(`/api/profile/mail-app-passwords/${path}`);
      refresh();
      toast('success', done);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  return (
    <Modal title={text('Mail app passwords')} labelledBy="mail-app-passwords-title" width={620} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4 p-5 text-[13px]">
        <p className="text-ink-2">For Apple Mail, Outlook or a phone reading your WorkSuite mailbox. Your WorkSuite password never works for mail.</p>
        {q.isLoading ? <Spinner /> : q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.isSuccess && mailboxes.length === 0 ? <Empty icon="key" title={text('No WorkSuite mailbox')} hint={text('App passwords are for mailboxes on your organization’s WorkSuite mail server.')} /> : null}
        {shown ? (
          <section aria-label={text('New app password')} className="flex flex-col gap-2 rounded-[12px] border-2 border-primary bg-selection p-4">
            <b className="text-ink">Copy it now — it will not be shown again.</b>
            <code className="select-all rounded-[8px] bg-surface px-3 py-2 font-mono text-[15px] tracking-wide text-ink selectable">{shown.password}</code>
            <span className="text-[12px] text-ink-2">{text('User {user} · IMAP {imap} {ip} · SMTP {smtp} {sp}', { user: shown.settings.username, imap: shown.settings.imap.host, ip: shown.settings.imap.port, smtp: shown.settings.smtp.host, sp: shown.settings.smtp.port })}</span>
            <div className="flex gap-2">
              <Button variant="primary" size="sm" icon="copy" onClick={() => void navigator.clipboard.writeText(shown.password).then(() => toast('success', text('Copied.')))}>
                Copy password
              </Button>
              <Button size="sm" onClick={() => setShown(null)}>
                Done
              </Button>
            </div>
          </section>
        ) : mailboxes.length ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void create();
            }}
          >
            {mailboxes.length > 1 ? (
              <div className="w-[220px]">
                <Select label={text('Mailbox')} value={box || String(mailboxes[0]!.id)} options={mailboxes.map((m) => ({ value: String(m.id), label: m.email }))} onValueChange={(v) => setBox(String(v))} />
              </div>
            ) : null}
            <TextField label={text('For which app or device')} placeholder={text('iPhone Mail')} value={name} onChange={(e) => setName(e.target.value)} className="min-w-[200px] flex-1" />
            <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
              Create
            </Button>
          </form>
        ) : null}
        {error ? <ErrorNote error={error} /> : null}
        {live.length ? (
          <section aria-label={text('Your app passwords')} className="overflow-hidden rounded-[12px] border border-line">
            <div className="flex items-center justify-between border-b border-line bg-subtle px-4 py-2">
              <b className="text-ink">Your app passwords</b>
              <Button size="sm" variant="ghost" className="!text-danger" onClick={() => void revoke('all', text('Every app password was revoked.'))}>
                Revoke all
              </Button>
            </div>
            <ul role="list">
              {live.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{p.name}</span>
                    <span className="block truncate text-[12px] text-ink-3">{p.mailbox.email}</span>
                  </span>
                  <span className="w-[110px] text-[12px] text-ink-3">{text('Created {date}', { date: dateLabel(p.created_at) })}</span>
                  <span className="w-[120px] text-[12px] text-ink-3">{p.last_used_at ? text('Last used {date}', { date: dateLabel(p.last_used_at) }) : text('Never used')}</span>
                  <Button size="sm" onClick={() => void revoke(String(p.id), text('Revoked. Any client using it is refused from its next sign-in.'))}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
