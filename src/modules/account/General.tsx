import { useState } from 'react';
import { apiDelete, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { ErrorNote, Spinner } from '../../components/ui';
import { useMe, UserPicture } from '../../components/UserPicture';
import { btn, btnPrimary, Field, input } from '../hr/parts';
import type { OpenEditor } from './AccountPage';
import { abilities, K, usePictures, useProfile, useRefreshMe, type MyProfile, type Section } from './api';
import { Card, Head } from './parts';
import { useRegional, useSaveRegional, useZones } from './regional';
import { VisibilitySelect } from './visibility';

/**
 * Profile settings (AcctGeneral): my picture and who sees it, my name and
 * phone, my time zone, and what my organisation sets for me. Only a name and
 * a phone are mine to change (`PUT /users/me/profile`); email, company,
 * department and job title are shown with who changes them, rather than as
 * grey boxes that give no reason.
 */
export default function General({ onPick, onEdit }: { onPick: (s: Section) => void; onEdit: OpenEditor }) {
  const q = useProfile();
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="flex max-w-[1080px] flex-col gap-4">
      <Head title="Profile settings" sub="Your name, picture and how people reach you." />
      <PhotoCard onPick={onPick} onEdit={onEdit} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Details key={`${q.data!.name}|${q.data!.preferred_name ?? ''}|${q.data!.phone ?? ''}`} p={q.data!} />
        <Card title="Set by your organisation">
          <p className="m-0 -mt-2 mb-3 text-[12.5px] text-ink-3">Ask an administrator to change these.</p>
          <div className="flex flex-col">
            <Fixed label="Email" value={q.data!.email} why="This is how you sign in and how a password reset reaches you." />
            <Fixed label="Company" value={q.data!.company} why="Decides what you can see." />
            <Fixed label="Department" value={q.data!.department} why="Decides mailbox access and where team mail is routed." />
            <Fixed label="Job title" value={q.data!.designation} why="Set in the directory, and it carries role defaults." />
          </div>
        </Card>
      </div>
    </div>
  );
}

function PhotoCard({ onPick, onEdit }: { onPick: (s: Section) => void; onEdit: OpenEditor }) {
  const me = useMe();
  const pics = usePictures();
  const refresh = useRefreshMe();
  const can = abilities(pics.data);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const avatar = me?.avatar ?? null;
  const waiting = (pics.data?.items ?? []).some((i) => i.pending);

  const remove = async () => {
    setBusy(true);
    try {
      await apiDelete('/api/users/me/pictures/current');
      await refresh([K.pictures, K.profile]);
      toast('success', 'Profile picture removed. It stays in your history.');
      setConfirm(false);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-5">
        <UserPicture name={me?.name} src={avatar} size={72} className="!bg-primary text-[24px] !text-white" />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[14.5px] font-bold text-ink">Profile photo</h2>
          <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">{avatar ? 'Shown wherever you appear in WorkSuite.' : 'Shown wherever you appear in WorkSuite. Your initials are shown until you add a picture.'}</p>
          {waiting ? <p className="m-0 mt-1 text-[12px] font-semibold text-warning">A new picture is waiting for an administrator to approve it. Until then, this one shows.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {can.upload ? (
              <button type="button" className={btnPrimary} onClick={() => onEdit('photo')}>
                <Icon name="upload" size={15} /> Upload photo
              </button>
            ) : null}
            {can.avatar ? (
              <button type="button" className={btn} onClick={() => onEdit('avatar')}>
                <Icon name="sparkles" size={15} /> Create avatar
              </button>
            ) : null}
            <button type="button" className={btn} onClick={() => onPick('pictures')}>
              <Icon name="image" size={15} /> Manage pictures
            </button>
            {avatar && can.delete ? (
              confirm ? (
                <span className="flex items-center gap-2 rounded-[8px] bg-subtle px-2.5 text-[12.5px] text-ink-2">
                  Your initials will show instead.
                  <button type="button" disabled={busy} onClick={() => void remove()} className="font-bold text-danger hover:underline">
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirm(false)} className="font-semibold text-ink-2 hover:underline">
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className={btn} onClick={() => setConfirm(true)}>
                  <Icon name="trash" size={15} /> Remove
                </button>
              )
            ) : null}
          </div>
        </div>
        {pics.data?.visibility ? (
          <div className="flex w-[270px] shrink-0 flex-col gap-1">
            <span className="text-[12.5px] font-semibold text-ink">Who sees your picture</span>
            <VisibilitySelect value={pics.data.visibility} canEdit={can.edit} />
            <span className="text-[11.5px] text-ink-3">Anyone left out sees your initials.</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function Details({ p }: { p: MyProfile }) {
  const refresh = useRefreshMe();
  const [name, setName] = useState(p.name ?? '');
  const [preferred, setPreferred] = useState(p.preferred_name ?? '');
  const [phone, setPhone] = useState(p.phone ?? '');
  const [busy, setBusy] = useState(false);
  const editable = p.editable ?? ['name', 'phone'];
  // The additional name (#432) is offered only by a server that keeps it (Users 1.5.0 lists it as editable).
  const offersPreferred = editable.includes('preferred_name');
  const dirty = name !== (p.name ?? '') || phone !== (p.phone ?? '') || (offersPreferred && preferred !== (p.preferred_name ?? ''));
  const regional = useRegional();
  const zones = useZones();
  const zone = useSaveRegional();

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      if (editable.includes('name')) body.name = name;
      if (offersPreferred) body.preferred_name = preferred.trim();
      if (editable.includes('phone')) body.phone = phone;
      await apiPut('/api/users/me/profile', body);
      await refresh([K.profile]);
      toast('success', 'Saved.');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const r = regional.data;
  const locked = r ? !r.effective.may_override : false;
  const zoneValue = r ? (r.mine.timezone_auto ? '' : (r.mine.timezone ?? '')) : '';
  const inherited = r ? `Automatic — ${r.effective.label}` : 'Automatic';

  return (
    <Card title="Your details">
      <div className="flex max-w-[440px] flex-col gap-3.5">
        <Field label="Name">
          <input className={input} value={name} disabled={!editable.includes('name')} maxLength={150} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        </Field>
        {offersPreferred ? (
          <Field label="Preferred name" hint="An additional name you go by, shown beside your name. Your name above stays as it is. Leave it empty to go by your name alone.">
            <input className={input} value={preferred} maxLength={150} onChange={(e) => setPreferred(e.target.value)} aria-label="Preferred name" />
          </Field>
        ) : null}
        <Field label="Phone" hint="Used as a fallback when a meeting invitation cannot reach you another way.">
          <input className={input} value={phone} disabled={!editable.includes('phone')} maxLength={40} placeholder="+94 7X XXX XXXX" onChange={(e) => setPhone(e.target.value)} aria-label="Phone" />
        </Field>
        <div className="flex gap-2">
          <button type="button" className={btnPrimary} disabled={!dirty || busy || !name.trim()} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={btn} disabled={!dirty || busy} onClick={() => (setName(p.name ?? ''), setPreferred(p.preferred_name ?? ''), setPhone(p.phone ?? ''))}>
            Discard changes
          </button>
        </div>
        <div className="mt-1 border-t border-line/70 pt-3.5">
          <Field label="Time zone" hint={locked ? `${r?.organization?.name ?? 'Your company'} sets this for everyone.` : 'Every time in WorkSuite is shown on this clock. Automatic follows your company, or this computer.'}>
            <Select
              label="Time zone"
              value={zoneValue}
              disabled={!r || locked || zone.busy}
              searchable
              options={[{ value: '', label: inherited }, ...(zones.data?.zones ?? []).map((z) => ({ value: z.value, label: `${z.label} (UTC${z.offset})`, group: z.group }))]}
              onValueChange={(v) => void zone.save(v ? { timezone_auto: false, timezone: v } : { timezone_auto: true, detected: Intl.DateTimeFormat().resolvedOptions().timeZone || null })}
            />
          </Field>
        </div>
      </div>
    </Card>
  );
}

function Fixed({ label, value, why }: { label: string; value: string | null; why: string }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 border-t border-line/70 py-2.5 text-[13px] first:border-t-0">
      <span className="text-ink-3">{label}</span>
      <span className="flex min-w-0 flex-col">
        <b className={value ? 'break-words text-ink' : 'font-medium text-ink-3'}>{value || 'Not set'}</b>
        <span className="text-[12px] text-ink-3">{why}</span>
      </span>
    </div>
  );
}

