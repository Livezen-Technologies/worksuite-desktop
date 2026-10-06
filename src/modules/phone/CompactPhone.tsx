import { useEffect, useMemo, useState } from 'react';
import { isMac } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { useNow } from '../../core/use-now';
import { Icon } from '../../components/Icon';
import { Button, cx, Kbd } from '../../components/ui';
import { PHONE_SHORTCUTS } from '@shared/phone';
import { useHistory } from './api';
import { clock, dialable, isDialable, isMissed, KEYPAD, otherParty, prettyNumber, when } from './lib/format';
import { CallerBadge, Mono } from './parts';
import type { Line } from './softphone/engine';
import { followRemote, isHostWindow, runPhone, usePhaseLabel, usePhoneState } from './softphone/client';
import { useAudioDevices } from './screens/AudioDevices';

/**
 * D01 · WorkSuite Desktop phone (VOIP-DEV-01): a compact always-on-top window — registration and the headset, the
 * call in progress with eight controls, call waiting with "Hold & answer", recent calls, and the global shortcuts.
 * The phone itself stays in the main window (softphone/client.ts); this window drives it.
 */
export default function CompactPhone() {
  useEffect(() => {
    if (isHostWindow()) return;
    const stop = followRemote();
    return stop;
  }, []);
  const phase = usePhoneState((s) => s.phase);
  const heard = isHostWindow() || phase !== 'idle';
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 2500);
    return () => clearTimeout(t);
  }, []);

  if (!heard && late) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-surface p-6 text-center">
        <Icon name="phone-off" size={22} className="text-ink-3" />
        <b className="text-[14px]">The phone runs in the main WorkSuite window</b>
        <p className="text-[12.5px] text-ink-3">Open WorkSuite and sign in; this window follows it.</p>
      </div>
    );
  }
  return <Compact />;
}

function Compact() {
  const lines = usePhoneState((s) => s.lines);
  const chip = usePhaseLabel();
  const server = usePhoneState((s) => s.server);
  const media = usePhoneState((s) => s.media);
  const { outputs } = useAudioDevices();
  const live = useMemo(() => lines.filter((l) => l.state !== 'ended'), [lines]);
  const main = live.find((l) => l.state === 'connected' && !l.held) ?? live.find((l) => l.state !== 'ringing') ?? null;
  const waiting = live.filter((l) => l.state === 'ringing');
  const held = live.filter((l) => l !== main && l.state !== 'ringing');
  const mod = isMac ? '⌥⌘' : 'Alt+Ctrl+';

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-ink">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', chip.tone === 'success' || chip.tone === 'danger' ? 'bg-success' : chip.tone === 'warning' ? 'bg-warning' : 'bg-ink-3/40')} />
        <span className="min-w-0 flex-1 truncate font-semibold">
          {chip.text}
          {server ? ` · ${server}` : ''}
        </span>
        <select aria-label="Headset" value={media.speaker} onChange={(e) => void runPhone({ cmd: 'media', patch: { speaker: e.target.value } })} className="h-7 max-w-[130px] rounded-[6px] border border-line bg-surface px-1 text-[11.5px]">
          <option value="">Default audio</option>
          {outputs
            .filter((d) => d.deviceId && d.deviceId !== 'default')
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Speaker'}
              </option>
            ))}
        </select>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 scroll-thin">
        {main ? <Stage line={main} /> : <QuickDial />}
        {waiting.map((w) => (
          <div key={w.id} className="flex items-center gap-2 rounded-[12px] border border-success/30 bg-success-bg px-3 py-2.5">
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[12.5px]">
                {main ? 'Call waiting' : 'Incoming'} · {w.remoteName ?? prettyNumber(w.remote)}
              </b>
              <span className="block truncate text-[11.5px] text-ink-3">
                {prettyNumber(w.remote)}
                {w.via ? ` · ${w.via}` : ''}
              </span>
            </span>
            <Button size="sm" variant="success" onClick={() => void act({ cmd: 'answer', id: w.id })}>
              {main ? 'Hold & answer' : 'Answer'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => void act({ cmd: 'decline', id: w.id, voicemail: true })} aria-label="Send to voicemail">
              <Icon name="voicemail" size={14} />
            </Button>
          </div>
        ))}
        {held.map((h) => (
          <div key={h.id} className="flex items-center gap-2 rounded-[12px] border border-line px-3 py-2">
            <Icon name="pause" size={14} className="text-warning" />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">
              On hold · <b>{h.remoteName ?? prettyNumber(h.remote)}</b>
            </span>
            <Button size="sm" onClick={() => void act({ cmd: 'focus', id: h.id }).then(() => act({ cmd: 'hold', id: h.id, on: false }))}>
              Resume
            </Button>
          </div>
        ))}
        <Recent />
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-ink-3">
        Global shortcuts: <Kbd tone="key">{mod}A</Kbd> answer · <Kbd tone="key">{mod}H</Kbd> hang up · <Kbd tone="key">{mod}M</Kbd> mute
        <span className="sr-only">
          {PHONE_SHORTCUTS.answer}, {PHONE_SHORTCUTS.hangup}, {PHONE_SHORTCUTS.mute}
        </span>
      </div>
    </div>
  );
}

async function act(c: Parameters<typeof runPhone>[0]) {
  const r = await runPhone(c);
  if (!r.ok) toast('error', r.message);
  return r;
}

type Pane = 'none' | 'keypad' | 'transfer' | 'consult' | 'notes';

function Stage({ line }: { line: Line }) {
  const now = useNow(1000);
  const [pane, setPane] = useState<Pane>('none');
  const [to, setTo] = useState('');
  const connected = line.state === 'connected';
  const name = line.remoteName ?? line.context?.contact?.name ?? null;
  const controls: Array<{ id: Pane | 'mute' | 'hold' | 'conference' | 'park'; label: string; on?: boolean; onClick: () => void }> = [
    { id: 'mute', label: line.muted ? 'Unmute' : 'Mute', on: line.muted, onClick: () => void act({ cmd: 'mute', id: line.id }) },
    { id: 'hold', label: line.held ? 'Resume' : 'Hold', on: line.held, onClick: () => void act({ cmd: 'hold', id: line.id }) },
    { id: 'keypad', label: 'Keypad', on: pane === 'keypad', onClick: () => setPane(pane === 'keypad' ? 'none' : 'keypad') },
    { id: 'transfer', label: 'Transfer', on: pane === 'transfer', onClick: () => setPane(pane === 'transfer' ? 'none' : 'transfer') },
    { id: 'consult', label: 'Consult', on: pane === 'consult', onClick: () => setPane(pane === 'consult' ? 'none' : 'consult') },
    { id: 'conference', label: 'Conference', onClick: () => void act({ cmd: 'conference' }) },
    { id: 'park', label: 'Park', onClick: () => void act({ cmd: 'park', id: line.id }) },
    { id: 'notes', label: 'Notes', on: pane === 'notes', onClick: () => setPane(pane === 'notes' ? 'none' : 'notes') },
  ];
  return (
    <section aria-label="Call in progress" className="flex flex-col gap-3 rounded-[14px] bg-[#0b1220] p-3.5 text-white">
      <div className="flex items-center gap-3">
        <CallerBadge name={name ?? line.remote} size={40} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[15px]">{name ?? prettyNumber(line.remote)}</b>
          <span className="block truncate text-[11.5px] text-white/60">{[line.context?.contact?.company ?? line.context?.account?.name, line.via].filter(Boolean).join(' · ') || prettyNumber(line.remote)}</span>
        </div>
        <Mono className="text-[20px]">{connected ? clock(Math.floor((now.getTime() - (line.answeredAt ?? line.createdAt)) / 1000)) : 'Calling…'}</Mono>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {controls.map((c) => (
          <button key={c.id} type="button" aria-pressed={c.on} disabled={!connected} onClick={c.onClick} className={cx('h-10 rounded-[9px] border text-[11.5px] font-semibold disabled:opacity-35', c.on ? 'border-[#2563eb] bg-[#1d3a8a]' : 'border-white/10 bg-white/5 hover:bg-white/10')}>
            {c.label}
          </button>
        ))}
      </div>
      {pane === 'keypad' ? (
        <div className="grid grid-cols-3 gap-1.5">
          {KEYPAD.map((k) => (
            <button key={k.d} type="button" onClick={() => void runPhone({ cmd: 'dtmf', id: line.id, digit: k.d })} className="h-9 rounded-[8px] bg-white/10 font-mono text-[16px] hover:bg-white/15">
              {k.d}
            </button>
          ))}
        </div>
      ) : null}
      {pane === 'transfer' || pane === 'consult' ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void act(pane === 'transfer' ? { cmd: 'transfer', id: line.id, to } : { cmd: 'consult', id: line.id, to }).then((r) => r.ok && setPane('none'));
          }}
        >
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Extension or number" aria-label={pane === 'transfer' ? 'Transfer to' : 'Speak first to'} autoFocus className="h-9 min-w-0 flex-1 rounded-[8px] border border-white/15 bg-white/5 px-2 font-mono text-[13px] text-white outline-none" />
          <Button type="submit" size="sm" variant="primary" disabled={!isDialable(to)}>
            {pane === 'transfer' ? 'Transfer now' : 'Speak first'}
          </Button>
        </form>
      ) : null}
      {pane === 'notes' ? (
        <textarea value={line.note} onChange={(e) => void runPhone({ cmd: 'note', id: line.id, text: e.target.value })} rows={3} placeholder="Notes, saved to the call" aria-label="Call notes" className="rounded-[8px] border border-white/15 bg-white/5 p-2 text-[12.5px] text-white outline-none" />
      ) : null}
      <button type="button" onClick={() => void act({ cmd: 'hangup', id: line.id })} className="h-10 rounded-full bg-[#D92D20] text-[13px] font-bold hover:opacity-90">
        End call
      </button>
    </section>
  );
}

function QuickDial() {
  const [n, setN] = useState('');
  return (
    <form
      className="flex flex-col gap-2 rounded-[14px] border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ cmd: 'dial', number: n }).then((r) => r.ok && setN(''));
      }}
    >
      <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Number or extension" aria-label="Number or extension" inputMode="tel" className="h-10 rounded-[8px] border border-line bg-surface px-3 font-mono text-[18px] outline-none focus:border-primary" />
      <Button type="submit" variant="success" icon="phone" disabled={!isDialable(dialable(n))} className="rounded-full">
        Call
      </Button>
    </form>
  );
}

function Recent() {
  const h = useHistory({ per_page: 8 });
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold tracking-[.3px] text-ink-3 uppercase">Recent</div>
      <ul className="flex flex-col">
        {(h.data?.calls ?? []).map((c) => {
          const other = otherParty(c);
          const missed = c.direction === 'inbound' && isMissed(c.disposition);
          return (
            <li key={c.id} className="flex items-center gap-2 py-1.5">
              <span className={cx('h-2 w-2 shrink-0 rounded-full', missed ? 'bg-danger' : c.direction === 'outbound' ? 'bg-primary' : c.direction === 'internal' ? 'bg-success' : 'bg-warning')} />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[12.5px]">{c.contact?.name ?? (prettyNumber(other) || 'Unknown')}</b>
                <span className="block text-[11px] text-ink-3">
                  {missed ? 'Missed' : c.direction === 'outbound' ? 'Outbound' : c.direction === 'internal' ? 'Internal' : 'Inbound'} · {clock(c.talk)}
                </span>
              </span>
              {missed && other ? (
                <button type="button" className="text-[11.5px] font-semibold text-primary" onClick={() => void act({ cmd: 'dial', number: other, name: c.contact?.name ?? null })}>
                  Call back
                </button>
              ) : (
                <span className="text-[11px] text-ink-3">{when(c.started_at)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
