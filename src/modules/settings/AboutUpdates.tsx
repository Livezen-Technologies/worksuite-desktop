import { useState, type ReactNode } from 'react';
import type { Preferences, UpdateChannel, UpdatePrefs, UpdateStatus } from '@shared/types';
import { CHANNEL_INFO, DEFAULT_UPDATE_PREFS, NOT_ALLOWED_NOTE, USER_CHANNELS, channelChange } from '@shared/updates';
import { app, updatePrefs } from '../../core/app-state';
import { call, errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { relative } from '../../core/time';
import { toast } from '../../core/toasts';
import { Select } from '../../components/Select';
import { Button, Chip, Modal, Switch } from '../../components/ui';
import { useRestartToUpdate } from '../../app/overlays/UpdatePill';

/**
 * Settings › About: the update channel, where updates stand, what's new and the update switches
 * (worksuite-desktop#205). The channels offered are the ones the organisation's policy allows; a less stable
 * channel is confirmed first, and a more stable one waits to catch up unless "Reinstall … now" is chosen.
 */

function AboutRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{label}</div>
        {hint ? <div className="mt-0.5 text-[12.5px] text-ink-3">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Where updates stand, in words: up to date, checking, downloading, ready, failed. */
export function updateStateLabel(u: UpdateStatus | null): { word: string; tone: 'success' | 'indigo' | 'warning' | 'danger' | 'muted'; detail: string | null } {
  if (!u) return { word: 'Not checked yet', tone: 'muted', detail: null };
  switch (u.state) {
    case 'CHECKING':
      return { word: 'Checking…', tone: 'indigo', detail: null };
    case 'DOWNLOADING':
      return { word: `Downloading ${u.progress}%`, tone: 'indigo', detail: `WorkSuite ${u.availableVersion} is downloading in the background.` };
    case 'VERIFIED':
      return { word: 'Verifying…', tone: 'indigo', detail: null };
    case 'STAGED':
      return { word: 'Ready', tone: 'success', detail: `WorkSuite ${u.availableVersion} is ready. Restart to update.` };
    case 'INSTALLING':
      return { word: 'Installing…', tone: 'indigo', detail: null };
    case 'FAILED':
      return { word: 'Failed', tone: 'danger', detail: u.error ?? 'The update did not complete.' };
    case 'AVAILABLE':
      return { word: u.downgrade ? 'Reinstall available' : 'Available', tone: 'warning', detail: `WorkSuite ${u.availableVersion} is available.${u.installBlockedReason ? ` ${u.installBlockedReason}` : ''}` };
    default:
      if (u.waitingForChannel) {
        return { word: 'Up to date', tone: 'success', detail: `This computer runs ${u.currentVersion}, newer than ${CHANNEL_INFO[u.waitingForChannel.channel].label}. It moves to ${CHANNEL_INFO[u.waitingForChannel.channel].label} with the next ${CHANNEL_INFO[u.waitingForChannel.channel].label} release that is newer.` };
      }
      return { word: 'Up to date', tone: 'success', detail: u.error ?? (u.lastCheckedAt ? `Checked ${relative(u.lastCheckedAt)}` : 'Not checked yet') };
  }
}

export function ChannelRow({ u }: { u: UpdateStatus | null }) {
  const channel: UpdateChannel = u?.channel ?? app.get().prefs?.updateChannel ?? 'stable';
  const allowed = u?.allowedChannels ?? [...USER_CHANNELS];
  const lock = u?.channelLockReason ?? null;
  const [ask, setAsk] = useState<{ to: UpdateChannel; text: string } | null>(null);
  const [reinstall, setReinstall] = useState(false);
  const [working, setWorking] = useState(false);
  // Every channel is listed; one the organisation does not allow is disabled, with the note why.
  const options = (channel === 'org' ? [channel, ...USER_CHANNELS] : [...USER_CHANNELS]).map((c) => {
    const ok = c === channel || allowed.includes(c);
    return { value: c as UpdateChannel, label: ok ? CHANNEL_INFO[c].label : `${CHANNEL_INFO[c].label} — ${NOT_ALLOWED_NOTE}`, hint: ok ? CHANNEL_INFO[c].description : NOT_ALLOWED_NOTE, disabled: !ok };
  });
  const fallback = u?.channelFallback ?? null;
  const apply = (to: UpdateChannel, confirmed: boolean) => {
    setAsk(null);
    setWorking(true);
    void call('updates:setChannel', { channel: to, confirmed })
      .then((s) => {
        app.set({ update: s });
        if (channelChange(channel, to, allowed).ok && s.waitingForChannel) toast('info', `WorkSuite stays on ${s.currentVersion} until ${CHANNEL_INFO[to].label} catches up.`);
      })
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setWorking(false));
  };
  const choose = (to: UpdateChannel) => {
    const c = channelChange(channel, to, allowed, lock);
    if (!c.ok) {
      toast('error', c.reason);
      return;
    }
    if (c.direction === 'same') return;
    if (c.confirm) setAsk({ to, text: c.confirm });
    else apply(to, false);
  };
  const doReinstall = () => {
    setReinstall(false);
    setWorking(true);
    void call('updates:reinstall')
      .then((s) => app.set({ update: s }))
      .catch((e) => toast('error', errorMessage(e)))
      .finally(() => setWorking(false));
  };
  const waiting = u?.waitingForChannel ?? null;
  const label = CHANNEL_INFO[channel].label;
  return (
    <>
      <AboutRow
        label="Channel"
        hint={
          lock ? (
            <span className="text-warning">{lock}</span>
          ) : fallback ? (
            <span className="text-warning">{`${CHANNEL_INFO[fallback.from].label}: ${NOT_ALLOWED_NOTE}. This computer follows ${CHANNEL_INFO[fallback.to].label} now, without downgrading.`}</span>
          ) : allowed.length < USER_CHANNELS.length ? (
            `${CHANNEL_INFO[channel].description} Your organisation allows: ${allowed.map((c) => CHANNEL_INFO[c].label).join(', ')}.`
          ) : (
            CHANNEL_INFO[channel].description
          )
        }
      >
        <Select label="Update channel" disabled={!!lock || allowed.length < 2 || working} value={channel} options={options} onValueChange={(v) => choose(v)} />
      </AboutRow>
      {waiting ? (
        <div className="flex items-center gap-3 border-b border-line py-3 text-[12.5px] text-ink-2">
          <span className="flex-1">
            Waiting for {label} to catch up: this computer runs {waiting.version}, which is newer. Nothing is downgraded unless you reinstall.
          </span>
          <Button size="sm" loading={working} onClick={() => setReinstall(true)}>
            Reinstall {label} now
          </Button>
        </div>
      ) : null}
      {ask ? (
        <Modal
          title={`Switch to ${CHANNEL_INFO[ask.to].label}?`}
          labelledBy="update-channel-confirm"
          onClose={() => setAsk(null)}
          width={460}
          footer={
            <>
              <Button onClick={() => setAsk(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => apply(ask.to, true)}>
                Switch to {CHANNEL_INFO[ask.to].label}
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">{ask.text}</p>
          <p className="mt-2 text-[12.5px] text-ink-3">You can go back to Stable at any time; WorkSuite then waits for Stable to catch up.</p>
        </Modal>
      ) : null}
      {reinstall ? (
        <Modal
          title={`Reinstall ${label} now?`}
          labelledBy="update-reinstall-confirm"
          onClose={() => setReinstall(false)}
          width={460}
          footer={
            <>
              <Button onClick={() => setReinstall(false)}>Cancel</Button>
              <Button variant="primary" onClick={doReinstall}>
                Download {label}
              </Button>
            </>
          }
        >
          <p className="text-[13.5px] text-ink">
            This downloads the current {label} build, which is older than {waiting?.version ?? 'this version'}, and installs it when you restart. Anything that only the newer version understands may not show
            in the older one.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

export function UpdateStateRow({ u }: { u: UpdateStatus | null }) {
  const [checking, setChecking] = useState(false);
  const restart = useRestartToUpdate();
  const s = updateStateLabel(u);
  const check = async () => {
    setChecking(true);
    await call('updates:check')
      .then((x) => app.set({ update: x }))
      .catch(() => undefined);
    setChecking(false);
  };
  return (
    <AboutRow
      label="Updates"
      hint={
        <>
          {s.detail}
          {u?.state === 'DOWNLOADING' ? (
            <span role="progressbar" aria-label="Download progress" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100} className="mt-1.5 block h-1.5 w-56 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full bg-primary" style={{ width: `${u.progress}%` }} />
            </span>
          ) : null}
          {u?.quietReason && u.state === 'STAGED' ? <span className="block">Notifications wait until {u.quietReason} ends.</span> : null}
        </>
      }
    >
      <div className="flex items-center gap-2">
        <Chip tone={s.tone}>{s.word}</Chip>
        {u?.state === 'STAGED' ? (
          <Button variant="primary" loading={restart.busy} onClick={() => void restart.start()}>
            Restart to update
          </Button>
        ) : u?.state === 'AVAILABLE' && u.installSupported ? (
          <Button
            variant="primary"
            onClick={() =>
              void call('updates:download')
                .then((x) => app.set({ update: x }))
                .catch((e) => toast('error', errorMessage(e)))
            }
          >
            Download
          </Button>
        ) : (
          <Button loading={checking || u?.state === 'CHECKING'} disabled={u?.state === 'DOWNLOADING' || u?.state === 'INSTALLING'} onClick={() => void check()}>
            {u?.state === 'FAILED' ? 'Try again' : 'Check for updates'}
          </Button>
        )}
      </div>
      {restart.dialog}
    </AboutRow>
  );
}

export function WhatsNew({ u }: { u: UpdateStatus | null }) {
  const notes = u?.notes;
  if (!notes || !u?.availableVersion) return null;
  return (
    <section aria-label={`What's new in ${notes.version}`} className="border-b border-line py-3.5">
      <h3 className="text-[14px] font-semibold text-ink">What&apos;s new in {notes.version}</h3>
      {notes.summary && notes.summary !== notes.highlights[0] ? <p className="mt-1 text-[13px] text-ink-2">{notes.summary}</p> : null}
      {notes.highlights.length ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
          {notes.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}
      {notes.url ? (
        <button type="button" className="mt-2 text-[12.5px] font-semibold text-primary hover:underline" onClick={() => void call('app:openExternal', { url: notes.url! })}>
          View full release notes
        </button>
      ) : null}
    </section>
  );
}

export function UpdateSwitches({ prefs, u }: { prefs: Preferences | null; u: UpdateStatus | null }) {
  const p: UpdatePrefs = { ...DEFAULT_UPDATE_PREFS, ...prefs?.updates };
  const enforced = !!u?.channelLockReason;
  const set = (patch: Partial<UpdatePrefs>) => void updatePrefs({ updates: { ...p, ...patch } }).catch((e) => toast('error', errorMessage(e)));
  const rows: Array<{ k: keyof UpdatePrefs; label: string; hint: string; disabled?: boolean }> = [
    {
      k: 'autoDownload',
      label: 'Download updates automatically',
      hint: enforced ? 'Your organization keeps WorkSuite up to date, so updates always download.' : 'In the background. Off: you choose when to download. Security updates download either way.',
      disabled: enforced,
    },
    { k: 'installOnQuit', label: 'Install when quitting', hint: 'A downloaded update installs when you quit WorkSuite, without asking.' },
    { k: 'notifyReady', label: 'Show a notification when an update is ready', hint: 'Once per version. The Update ready button in the top bar shows either way.' },
  ];
  return (
    <div className="mt-6">
      <h3 className="text-[15px] font-bold text-ink">Updates</h3>
      {rows.map((r) => (
        <AboutRow key={r.k} label={r.label} hint={r.hint}>
          <Switch label={r.label} checked={r.k === 'autoDownload' && enforced ? true : p[r.k]} disabled={r.disabled || !prefs} onChange={(v) => set({ [r.k]: v })} />
        </AboutRow>
      ))}
    </div>
  );
}

/** Channel, state, what's new and the switches, together (Settings › About). */
export function AboutUpdates() {
  const u = useStore(app, (s) => s.update);
  const prefs = useStore(app, (s) => s.prefs);
  return (
    <>
      <ChannelRow u={u} />
      <UpdateStateRow u={u} />
      <WhatsNew u={u} />
      <UpdateSwitches prefs={prefs} u={u} />
    </>
  );
}
