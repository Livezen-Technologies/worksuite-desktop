import { text } from '../../../core/i18n';
import { useQuery, useMutation } from '@tanstack/react-query';
import { call, on, errorMessage } from '../../../core/bridge';
import { probeIce } from '../../meet/ice';
import { iceChecks } from '@shared/ice-probe';
import { meetDiagnosticsSummary } from '@shared/meet-diagnostics';
import { Chip, Button, ErrorNote, Spinner, cx, Switch } from '../../../components/ui';
import { Icon } from '../../../components/Icon';
import { queryClient } from '../../../core/query';
import type { RemoteControlIdentity, RemoteControlView } from '@shared/types';
import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../../core/store';
import { app } from '../../../core/app-state';
import { toast } from '../../../core/toasts';
import { CollapsibleSection } from '../../../components/Collapsible';
import { Select } from '../../../components/Select';
import { STOP_CHORD_CHOICES } from '@shared/remote-control/stop-chord';
import { PROTECTED_APP_LABELS } from '@shared/remote-control/protected-apps';
import { H, Row } from './parts';

/** Settings › Remote control: what it allows, its checks and the identity it shows. */

/** RC09: whether others can control this computer in a meeting, and what it needs to. */
export function methodLabel(method: string | null): string {
  return method === 'sendinput' ? 'Windows input (SendInput, through PowerShell)' : method === 'cgevent' ? 'macOS events (CGEvent, through osascript)' : method === 'xdotool' ? 'xdotool (X11)' : 'None';
}

/** How long the controller waits after the person here moves the mouse (RC-INP-04). */
export function holdLabel(ms: number | null): string {
  if (ms === null) return text('As your organisation’s policy says');

  // Said in whole tenths: "1.5 seconds", not "1500 ms", for a row somebody
  // reads once to know whether their own mouse will win.
  const seconds = ms / 1000;

  return seconds >= 1 ? text('Their input waits {n} seconds', { n: String(Number(seconds.toFixed(1))) }) : text('Their input waits {n} ms', { n: String(Math.round(ms)) });
}

export function clipboardLabel(policy: 'off' | 'text_only' | 'text_and_files' | null): string {
  return policy === 'off'
    ? text('Nothing can be put on your clipboard')
    : policy === 'text_only'
      ? text('Text only')
      : policy === 'text_and_files'
        ? text('Text, and files you accept')
        : text('As your organisation’s policy says');
}

/**
 * The checks the artboard draws (RC09), run on demand.
 *
 * Reads only — no capture is opened and no permission is asked for — so **Run
 * checks again** is safe to press repeatedly and never puts a system prompt in
 * front of anybody. Two of the rows deliberately say they cannot be known from
 * here rather than showing a tick; `shared/meet-diagnostics.ts` says why.
 */
function RemoteControlChecks() {
  const q = useQuery({ queryKey: ['rc-checks'], queryFn: () => call('rc:checks'), refetchOnWindowFocus: false, staleTime: 30_000 });
  /*
   * The media path (RC09), measured here rather than in the main process:
   * gathering ICE candidates needs a browser's own WebRTC. It runs only when
   * asked — gathering sends UDP on somebody's behalf, and a settings page that
   * did that on every visit would be making traffic nobody asked for.
   */
  const probe = useMutation({ mutationFn: () => probeIce() });
  const rows = [...(q.data?.checks ?? []).filter((r) => r.id !== 'meet-media'), ...iceChecks(probe.data ?? null)];
  /*
   * The one word at the top speaks only for rows that were actually measured.
   * A list of nothing but "not measured yet" would otherwise read as "nothing
   * in the way", which is the reassurance these checks exist to withhold.
   */
  const measured = rows.filter((r) => r.status !== 'skip');
  const worst = measured.length ? meetDiagnosticsSummary(measured) : null;
  const run = () => {
    void q.refetch();
    probe.mutate();
  };

  return (
    <div className="mt-4 rounded-[12px] border border-line bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-bold text-ink">Checks</h3>
        {worst ? (
          <Chip tone={worst === 'fail' ? 'danger' : worst === 'warn' ? 'warning' : 'success'}>
            {worst === 'fail' ? 'Something is in the way' : worst === 'warn' ? 'Works, with limits' : 'Nothing in the way'}
          </Chip>
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon="refresh" loading={q.isFetching || probe.isPending} onClick={run}>
          Run checks again
        </Button>
      </div>
      {q.error ? <ErrorNote error={q.error} onRetry={() => void q.refetch()} /> : null}
      {!q.data && q.isLoading ? <Spinner /> : null}
      {!probe.data && !probe.isPending ? (
        <p className="pb-2 text-[12px] text-ink-3">
          The media path is not checked until you ask: it sends a few packets to this server&rsquo;s relays to find out whether a call&rsquo;s audio and video can
          leave this network.
        </p>
      ) : null}
      <ul className="flex flex-col" data-testid="rc-checks">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-2.5 border-t border-line py-2.5 first:border-t-0 first:pt-0">
            <Icon
              name={r.status === 'pass' ? 'check' : r.status === 'fail' ? 'alert' : r.status === 'warn' ? 'warning' : 'info'}
              size={15}
              className={cx('mt-0.5 shrink-0', r.status === 'pass' ? 'text-success' : r.status === 'fail' ? 'text-danger' : r.status === 'warn' ? 'text-warning' : 'text-ink-3')}
            />
            <span className="flex min-w-0 flex-col">
              <b className="text-[13.5px] font-semibold text-ink">{r.label}</b>
              <span className="text-[12.5px] leading-relaxed text-ink-2">{r.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A fresh remote-control state, in place of any older answer still on its way. */
async function fresh(next: Awaited<ReturnType<typeof call<'rc:recheck'>>>): Promise<void> {
  await queryClient.cancelQueries({ queryKey: ['rc-state'] });
  queryClient.setQueryData(['rc-state'], next);
}

/** While Accessibility is not yet granted, it is asked again this often (worksuite-desktop#147). */
export const RC_RECHECK_MS = 2_000;

function yesNo(v: boolean | null | undefined): string {
  return v === null || v === undefined ? text('Unable to verify') : v ? text('Granted') : text('Denied');
}

/** Why macOS may not be applying the entry in System Settings to this running copy. */
function IdentityWarnings({ identity }: { identity: RemoteControlIdentity | null | undefined }) {
  if (!identity) return null;
  const warnings: string[] = [];
  if (identity.development) warnings.push(text('This is a development build. macOS gives its Accessibility access to Electron or to the app that started it, such as Terminal — not to WorkSuite.'));
  if (identity.translocated) warnings.push(text('macOS is running WorkSuite from a temporary location because it was opened where it was downloaded. Move WorkSuite to Applications, open it from there, then allow it again.'));
  if (identity.otherInstalledCopy) warnings.push(text('Another copy of WorkSuite is in Applications. The entry in System Settings may belong to that copy, not to this one.'));
  if (identity.adhoc && !identity.development) warnings.push(text('This copy of WorkSuite is not signed with a Developer ID, so macOS ties Accessibility to this exact build. After an update the old entry stays on but no longer applies: remove WorkSuite from the list and add it again.'));
  if (warnings.length === 0) return null;
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2" data-testid="rc-identity-warnings">
      {warnings.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
}

export function RemoteControlSection() {
  const q = useQuery({ queryKey: ['rc-state'], queryFn: () => call('rc:state'), refetchInterval: 5_000 });
  const v = q.data;
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [verifyError, setVerifyError] = useState(false);
  /** A fresh check of the app and its helper. `quiet` (the 2-second poll) keeps the last answer on screen meanwhile. */
  const recheck = async (quiet = false) => {
    if (quiet && inFlight.current) return;
    const request = ++generation.current;
    inFlight.current = true;
    if (!quiet) {
      setChecking(true);
      setVerifyError(false);
    }
    try {
      await queryClient.cancelQueries({ queryKey: ['rc-state'] });
      const next = await call('rc:recheck');
      if (request === generation.current) {
        await fresh(next);
        setVerifyError(false);
      }
    } catch {
      if (request === generation.current && !quiet) setVerifyError(true);
    } finally {
      if (request === generation.current) {
        inFlight.current = false;
        setChecking(false);
      }
    }
  };
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void recheck(); });
    const back = () => { if (document.visibilityState === 'visible') void recheck(); };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    // The main process checks again when WorkSuite becomes the active app, and says so.
    const off = on<RemoteControlView>('rc:changed', (next) => {
      if (!inFlight.current) void fresh(next);
    });
    return () => {
      mounted = false;
      // The ref is a request counter, not a DOM node. Invalidate outstanding replies.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      inFlight.current = false;
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
      off();
    };
  }, []);
  const s = v?.support;
  // Both are the organisation's to set, so they are read from the policy
  // rather than offered as choices (RC09).
  const localHoldMs = useStore(app, (st) => st.bootstrap?.policy.remote_local_priority_hold_ms ?? null);
  const clipboard = useStore(app, (st) => st.bootstrap?.policy.remote_clipboard ?? null);
  // The banner asks for access: keep asking macOS every two seconds while it is on screen, and stop once granted.
  const waiting = !!s && (s.accessibility === 'denied' || s.accessibility === 'unknown');
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void recheck(true);
    }, RC_RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [waiting]);
  const set = async (value: boolean) => {
    try {
      await call('rc:setAllowRequests', { value });
      void q.refetch();
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };
  /** A different chord on this computer. The main process has the last word. */
  const chooseChord = async (chord: string) => {
    try {
      await fresh(await call('rc:setStopChord', { chord }));
      toast('success', `The emergency stop is now ${chord}.`);
    } catch (e) {
      toast('error', errorMessage(e));
      void q.refetch();
    }
  };
  const restart = async () => {
    setRestarting(true);
    try {
      await call('rc:restart');
    } catch (e) {
      setRestarting(false);
      toast('error', errorMessage(e));
    }
  };
  if (!v || !s) return <>
    <H title="Remote control" />
    <p className="text-ink-2">{checking ? text('Checking Accessibility access…') : text('Unable to verify Accessibility access')}</p>
    <Button size="sm" variant="ghost" loading={checking} onClick={() => void recheck()}>Check again</Button>
  </>;
  const pending = checking || s.accessibility === 'checking';
  const unknown = verifyError || s.accessibility === 'unknown';
  const works = s.available && s.policyAllows && !pending && !unknown;
  const hint = !pending && !unknown && s.accessibility === 'denied' ? (s.accessibilityHint ?? null) : null;
  const d = s.accessibilityDetails;
  const id = d?.identity ?? null;
  const headline = pending
    ? text('Checking Accessibility access…')
    : unknown
      ? text('Unable to verify Accessibility access')
      : hint === 'restart'
        ? text('Access granted — restart WorkSuite to finish')
        : hint === 'helper'
          ? text('WorkSuite has access, but its input helper does not')
          : works
            ? text('This computer can be controlled when you allow it')
            : text('This computer can be shared, but not controlled');
  return (
    <>
      <H title="Remote control" hint="When you share your screen in a meeting, others can ask to use your mouse and keyboard. Nothing happens until you allow it, on this computer, each time." />
      <div className={cx('mb-4 rounded-[12px] border p-4 text-[13.5px]', works || pending || unknown ? 'border-line bg-surface' : 'border-warning-line bg-warning-bg dark:bg-warning-bg')} data-testid="rc-banner">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <Icon name={pending || unknown || hint === 'restart' ? 'refresh' : works ? 'shield-check' : 'warning'} size={17} className={works ? 'text-success' : 'text-warning'} />
          {headline}
        </div>
        {hint === 'restart' ? (
          <p className="mt-1.5 text-ink-2" data-testid="rc-accessibility-hint">
            macOS has given WorkSuite Accessibility access. Its input helper only receives it when WorkSuite starts again, so restart WorkSuite once to finish. Nothing else needs to change in System Settings.
          </p>
        ) : hint === 'helper' ? (
          <div className="mt-1.5 text-ink-2" data-testid="rc-accessibility-hint">
            <p>macOS still does not count WorkSuite’s input helper ({d?.helperPath ?? '/usr/bin/osascript'}) as part of WorkSuite after a restart. Usually another copy, or a stale entry, holds the permission.</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5">
              <li>Quit WorkSuite and open it from the Applications folder in Finder — not from Terminal, a download folder or the disk image.</li>
              <li>In Privacy &amp; Security › Accessibility, select WorkSuite and click − to remove it. Click +, choose WorkSuite in Applications and turn it on.</li>
              <li>Restart WorkSuite, then check again.</li>
            </ol>
          </div>
        ) : !works && !pending && !unknown ? (
          <p className="mt-1.5 text-ink-2">{!s.policyAllows ? text("Your organization's policy for this computer doesn't allow it.") : s.reason}</p>
        ) : works && s.reason ? (
          <p className="mt-1.5 text-ink-2">{s.reason}</p>
        ) : null}
        {!pending && !unknown && s.accessibility === 'granted' ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-ink-2" data-testid="rc-accessibility">
            <Icon name="check" size={14} className="text-success" /> Accessibility access enabled
          </p>
        ) : null}
        {!pending && !unknown && s.accessibility === 'denied' && !hint ? <p className="mt-1.5 text-ink-2">Permission required</p> : null}
        {unknown ? <p className="mt-1.5 text-ink-2">{d?.problem ?? text('The permission check did not complete. Check again to retry.')}</p> : null}
        {!works && !pending ? <IdentityWarnings identity={id} /> : null}
        {s.accessibility !== 'not_required' ? (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {hint ? (
              <Button size="sm" icon="refresh" loading={restarting} onClick={() => void restart()}>
                Restart WorkSuite
              </Button>
            ) : null}
            {s.accessibility === 'denied' && hint !== 'restart' ? (
              <Button size="sm" variant={hint ? 'ghost' : undefined} onClick={() => void call('media:privacySettings', { pane: 'accessibility' })}>
                Open Accessibility settings
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="refresh" loading={checking} onClick={() => void recheck()}>
              Check again
            </Button>
          </div>
        ) : null}
        {waiting ? <p className="mt-2 text-[12px] text-ink-3" data-testid="rc-auto-check">WorkSuite checks again every few seconds while this message is shown, and when you come back to it.</p> : null}
        {d ? (
          <CollapsibleSection variant="row" level={4} defaultOpen={false} persist="settings.remote-control.checks" className="mt-2" bodyClassName="text-[12px] text-ink-3" title="Running app and input-helper checks" summary={text('App Accessibility: {state}', { state: yesNo(d.appTrusted) })} data-testid="rc-details">
            <p className="break-all selectable">{text('Running copy: {path}', { path: id?.bundle ?? d.runningApp })}</p>
            {id ? (
              <p className="selectable">
                {text('Bundle ID: {id}', { id: id.bundleId ?? text('unknown') })} · {text('Team ID: {team}', { team: id.teamId ?? text('not set') })} · {text('Signed by: {who}', { who: id.signingUnavailable ? text('Unable to verify') : id.adhoc ? text('ad-hoc (no Developer ID)') : (id.authority ?? text('unknown')) })}
              </p>
            ) : null}
            <p>
              {text('App Accessibility: {state}.', { state: yesNo(d.appTrusted) })} {text('Helper Accessibility: {state}.', { state: yesNo(d.helperAccessibility) })} {text('Helper event posting: {state}.', { state: yesNo(d.helperTrusted) })}
            </p>
            <p className="break-all">{text('Input helper: {path}, started by WorkSuite, so WorkSuite’s entry in Accessibility covers it. It is not listed separately.', { path: d.helperPath ?? '/usr/bin/osascript' })}</p>
            <p>Compare this running copy with the entry in macOS settings if more than one WorkSuite installation exists. Diagnostics include signing identity and app translocation checks.</p>
          </CollapsibleSection>
        ) : null}
        {s.accessibility !== 'not_required' && s.accessibility !== 'granted' ? (
          <CollapsibleSection variant="row" level={4} defaultOpen={false} persist="settings.remote-control.still-denied" className="mt-2" bodyClassName="text-[12px] text-ink-3" title="Still shows Denied after turning WorkSuite on?" summary={text('4 steps')} data-testid="rc-still-denied">
            <ol className="mt-1.5 list-decimal space-y-1 pl-5">
              <li>Check that the running copy above is the WorkSuite in Applications, and open WorkSuite from there.</li>
              <li>Quit WorkSuite. In System Settings › Privacy &amp; Security › Accessibility, select WorkSuite and click − to remove it, then click + and choose WorkSuite in Applications. Turn it on.</li>
              <li>Open WorkSuite again. This screen updates by itself; you can also press Check again.</li>
              <li>
                If it still does not change, reset WorkSuite’s entry in Terminal with <code className="selectable font-mono">tccutil reset Accessibility {id?.bundleId ?? 'lk.worksuite.desktop'}</code>, then open WorkSuite and allow it again.
              </li>
            </ol>
          </CollapsibleSection>
        ) : null}
        {s.accessibility !== 'not_required' ? (
          <p className="mt-2 text-[12px] text-ink-3">Accessibility only lets WorkSuite take input. Nobody controls this computer until you approve their request, each time.</p>
        ) : null}
      </div>
      <Row label="Let people ask to control my screen" hint="The starting choice each time you share; you can change it in the share picker.">
        <Switch label="Let people ask to control my screen" checked={v.allowRequests} disabled={!works} onChange={(x) => void set(x)} />
      </Row>
      {/* RC09: changeable here only while the organisation has left it at the
        * default. Where they have set one, the row stays what it was — a
        * company that standardised on a chord did so to be able to tell
        * everybody the same thing in an incident. */}
      <Row
        label="Emergency stop"
        hint="Ends control at once, whatever the other person is doing. It is never passed on to them, and it cannot be turned off — only changed."
        lock={v.chordSetByOrganisation ? { reason: 'Set by your organisation’s Meet policy.' } : undefined}
      >
        {v.chordSetByOrganisation ? (
          <span className="font-mono text-[13px] text-ink">{v.emergencyChord}</span>
        ) : (
          <Select
            value={v.emergencyChord}
            aria-label="Emergency stop"
            options={STOP_CHORD_CHOICES.map((c) => ({ value: c.chord, label: c.chord }))}
            onValueChange={(chord) => void chooseChord(String(chord))}
          />
        )}
        {!v.chordRegistered ? <span className="ml-2 text-[12px] text-warning">Another app holds this shortcut — choose another, or use Stop on the bar.</span> : null}
      </Row>
      {!v.chordSetByOrganisation ? (
        <p className="-mt-2 pb-1 text-[12px] text-ink-3">
          {STOP_CHORD_CHOICES.find((c) => c.chord === v.emergencyChord)?.note ?? 'Two modifiers at least, so it cannot be pressed by accident while you type.'}
        </p>
      ) : null}
      <Row label="How input reaches this computer" hint="The system's own tools, started only while someone has control.">
        <span className="text-[13px] text-ink-2">{methodLabel(s.method)}</span>
      </Row>
      {/* RC09: the hold already exists in the service (RC-INP-04) — what was
        * missing was saying how long it is, and that it is not yours to set. */}
      <Row label="When you move your own mouse" hint="Their input waits, so you are never fighting the pointer. Nothing is sent to them while it waits." lock={{ reason: 'Set by your organisation’s Meet policy.' }}>
        <span className="text-[13px] text-ink-2">{holdLabel(localHoldMs)}</span>
      </Row>
      <Row label="Clipboard while someone controls this computer" lock={{ reason: 'Set by your organisation’s Meet policy.' }} hint="You are told each time something is put on your clipboard, and a file always waits for your answer.">
        <span className="text-[13px] text-ink-2">{clipboardLabel(clipboard)}</span>
      </Row>
      <RemoteControlChecks />
      <CollapsibleSection variant="row" level={4} defaultOpen={false} persist="settings.remote-control.protected" className="mt-1" bodyClassName="text-[12.5px] text-ink-2" title="Apps nobody can control" summary={`${PROTECTED_APP_LABELS.length} kinds`}>
        <p>
          Control pauses by itself while one of these is in front, and only you can resume it. This computer decides that on its own — it is not asked of the
          meeting, and it holds even while somebody is driving.
        </p>
        <ul className="mt-1.5 space-y-1">
          {PROTECTED_APP_LABELS.map((p) => (
            <li key={p.label}>
              <b className="font-semibold text-ink">{p.label}</b> — {p.what}
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-[12px] text-ink-3">Your screen is still shared while control is paused. Stop the share itself from the bar at the top of the screen.</p>
      </CollapsibleSection>
      <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
        While someone has control, a red bar stays at the top of your screen with Pause and Stop. Moving your own mouse always wins: their input waits until you stop. Control pauses by itself when the screen locks, the computer sleeps, or a password manager or system prompt comes to the front, and only you can resume it.
      </p>
    </>
  );
}
