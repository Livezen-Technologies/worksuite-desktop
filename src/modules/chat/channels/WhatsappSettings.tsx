import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { call, errorMessage } from '../../../core/bridge';
import { text } from '../../../core/i18n';
import { toast } from '../../../core/toasts';
import { timeLabel } from '../../../core/time';
import { Menu } from '../../../components/Menu';
import { Icon } from '../../../components/Icon';
import { Button, Modal, Spinner, cx } from '../../../components/ui';
import { LinkPhone } from './LinkPhone';
import { checkWa, confirmedWaPhone, formatWaPhone, isConnected, makeDefaultWa, moveWaEngine, numberState, unlinkWa, useWaEngines, type WaAccount } from './whatsapp';
import { SettingsGroup } from '../../../components/SettingsKit';

const ROLES: Record<string, string> = { owner: 'Owner', admin: 'Admin', agent: 'Agent', viewer: 'Viewer' };

/**
 * WhatsApp's channel settings in Chat (worksuite-desktop#35), what the separate WhatsApp module's numbers screen did:
 * the numbers shared with you and where each stands, checking a connection, linking a number again by QR code or
 * unlinking it from the phone (its conversations stay), the default number, and connecting another. Each action is
 * offered only where the server says this person may (`can_connect`) and it checks again. Sharing a number,
 * broadcasts, editing templates and business hours are on the web.
 */
export function WhatsappSettings({ accounts, loading, onConnect, onClose }: {
  accounts: WaAccount[];
  loading: boolean;
  onConnect: (() => void) | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [menu, setMenu] = useState<number | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const activeAction = useRef(false);
  const [results, setResults] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<number | null>(null);
  // "Link again" opens the code and its progress inside the number's own card, where it was pressed.
  const [linking, setLinking] = useState<number | null>(null);
  // Moving a number to the other engine, waiting for a yes: unlinked from the one it leaves, linked again on the new one.
  const [moving, setMoving] = useState<{ id: number; engine: string } | null>(null);
  const engines = useWaEngines(accounts.some((a) => a.provider === 'web_js' && a.can_connect === true));
  const running = (engines.data?.engines ?? []).filter((e) => e.available);
  const engineLabel = (id: string) => engines.data?.engines.find((e) => e.id === id)?.label ?? id;
  const web = (path: string) => void call('app:openInBrowser', { path });

  const act = async (key: string, run: () => Promise<unknown>, done: string) => {
    if (activeAction.current) return;
    activeAction.current = true;
    setBusy(key);
    try {
      const r = (await run()) as { ok?: boolean; error?: string | null; note?: string | null } | null;
      const result = r?.note ?? r?.error ?? (r?.ok === false ? text('That did not work.') : done);
      if (key.startsWith('check:')) setResults((old) => ({ ...old, [Number(key.split(':')[1])]: result }));
      toast(r?.ok === false ? 'error' : 'success', result);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      activeAction.current = false;
      setBusy(null);
      setUnlinking(null);
      void qc.invalidateQueries({ queryKey: ['whatsapp'] });
    }
  };

  return (
    <Modal
      title={text('WhatsApp settings')}
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button icon="external" onClick={() => web('/whatsapp')}>{text('More on the web')}</Button>
          <Button variant="primary" onClick={onClose}>{text('Done')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[12.5px]">
        <SettingsGroup
          title={text('Your numbers')}
          className="!mb-0"
          list={text('Your numbers')}
          actions={onConnect ? <Button size="sm" variant="primary" icon="plus" onClick={onConnect}>{text('Connect a number')}</Button> : null}
        >
        {loading ? <li className="px-[18px] py-3"><Spinner /></li> : null}
        {!loading && !accounts.length ? (
          <li className="px-[18px] py-3 text-ink-3">
            {onConnect ? text('No number yet. Connect one to answer customers from Chat.') : text('No number is shared with you yet. Ask whoever manages WhatsApp numbers to share one with you.')}
          </li>
        ) : null}
          {accounts.map((a) => {
            const up = isConnected(a);
            const where = numberState(a);
            const phone = confirmedWaPhone(a);
            const may = a.can_connect === true;
            return (
              <li key={a.id} aria-label={a.name} className="flex flex-col gap-2 px-[18px] py-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-subtle text-ink-2"><Icon name="phone" size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b className="text-[13.5px] text-ink">{a.name}</b>
                      <span className={cx('rounded-full px-2 py-px text-[11px] font-semibold', where.tone === 'connected' ? 'bg-success-bg text-success' : where.tone === 'waiting' ? 'bg-subtle text-ink-2' : 'bg-warning-bg text-warning-ink')}>{text(where.label)}</span>
                      {a.is_default ? <span className="rounded-full bg-subtle px-2 py-px text-[11px] font-semibold text-ink-2">{text('Default')}</span> : null}
                    </span>
                    <span className="block text-ink-3">
                      {[phone ? formatWaPhone(phone) : a.provider === 'web_js' ? text('Number not linked yet') : null, a.provider_label ?? null, a.role ? text(ROLES[a.role] ?? a.role) : null].filter(Boolean).join(' · ')}
                    </span>
                    {a.connected_at ? <span className="block text-ink-3">{text('Last connected: {time}', { time: timeLabel(a.connected_at) })}</span> : null}
                    {a.device_label ? <span className="block text-ink-3">{text('Connected on: {device}', { device: a.device_label })}</span> : null}
                    {results[a.id] ? <span role="status" className="block text-ink-2">{results[a.id]}</span> : null}
                    {!up && a.status_note && linking !== a.id ? <span className="mt-0.5 block text-ink-2">{a.status_note}</span> : null}
                    {a.provider === 'web_js' && may && running.length > 1 ? (
                      <label className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-3">
                        {text('Engine')}
                        <select aria-label={`Engine for ${a.name}`} value={a.engine || engines.data?.default || ''} disabled={busy !== null} onChange={(e) => setMoving({ id: a.id, engine: e.target.value })} className="h-7 rounded-[7px] border border-line bg-surface px-1.5 text-[12px] text-ink outline-none focus:border-primary">
                          {running.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                        </select>
                      </label>
                    ) : a.provider === 'web_js' && (a.engine || engines.data?.default) ? <span className="block text-[11.5px] text-ink-3">{text('Engine: {engine}', { engine: engineLabel(a.engine || engines.data?.default || '') })}</span> : null}
                  </span>
                </div>
                {may && moving?.id === a.id ? (
                  <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[8px] bg-subtle p-2 text-ink-2">
                    <span className="flex-1">{text('Move {name} to {engine}? It is unlinked from the engine it leaves and the phone scans a new code once. Its conversations stay.', { name: a.name, engine: engineLabel(moving.engine) })}</span>
                    <Button size="sm" onClick={() => setMoving(null)}>{text('Cancel')}</Button>
                    <Button size="sm" variant="primary" loading={busy === `engine:${a.id}`} onClick={() => void act(`engine:${a.id}`, () => moveWaEngine(a.id, moving.engine), text('{name} moved to {engine}. Scan the code to link it.', { name: a.name, engine: engineLabel(moving.engine) })).then(() => { setMoving(null); setLinking(a.id); })}>{text('Move and link')}</Button>
                  </div>
                ) : null}
                {may ? (
                  unlinking === a.id ? (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[8px] bg-danger-bg p-2 text-danger">
                      <span className="flex-1">{text('Unlink {name} from the phone? Its conversations stay here.', { name: a.name })}</span>
                      <Button size="sm" onClick={() => setUnlinking(null)}>{text('Cancel')}</Button>
                      <Button size="sm" variant="danger" loading={busy === `unlink:${a.id}`} onClick={() => void act(`unlink:${a.id}`, () => unlinkWa(a.id), text('{name} is unlinked.', { name: a.name }))}>{text('Unlink')}</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <Button disabled={busy !== null} size="sm" icon="refresh" loading={busy === `check:${a.id}`} onClick={() => void act(`check:${a.id}`, () => checkWa(a.id), text('{name} was checked.', { name: a.name }))}>{text('Check connection')}</Button>
                      {a.provider === 'web_js' && !up ? <Button size="sm" icon="qr-code" aria-expanded={linking === a.id} onClick={() => setLinking(linking === a.id ? null : a.id)}>{linking === a.id ? text('Hide the code') : text('Link again')}</Button> : null}
                      {!a.is_default ? <Button disabled={busy !== null} size="sm" loading={busy === `default:${a.id}`} onClick={() => void act(`default:${a.id}`, () => makeDefaultWa(a.id), text('{name} is the default number now.', { name: a.name }))}>{text('Make default')}</Button> : null}
                      {a.provider === 'web_js' && up ? <><button ref={menu === a.id ? anchor : undefined} type="button" aria-label={`More actions for ${a.name}`} aria-haspopup="menu" aria-expanded={menu === a.id} disabled={busy !== null} onClick={(e) => { anchor.current = e.currentTarget; setMenu(menu === a.id ? null : a.id); }} className="rounded px-2 text-ink-2 hover:bg-subtle"><Icon name="more" size={16} /></button>{menu === a.id ? <Menu label={`Actions for ${a.name}`} anchor={anchor} onClose={() => setMenu(null)} sections={[{ id: 'number', items: [{ id: 'unlink', label: text('Unlink from phone'), danger: true, onSelect: () => { setMenu(null); setUnlinking(a.id); } }] }]} /> : null}</> : null}
                    </div>
                  )
                ) : null}
                {may && linking === a.id && !up ? (
                  <div className="rounded-[10px] border border-line bg-surface p-3">
                    <LinkPhone accountId={a.id} onLinked={() => { setLinking(null); toast('success', text('{name} is linked.', { name: a.name })); }} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </SettingsGroup>
        <p className="text-ink-3">{text('Sharing a number, broadcasts, templates, labels and business hours are set on the web.')}</p>
      </div>
    </Modal>
  );
}
