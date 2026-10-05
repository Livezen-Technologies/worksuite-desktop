import { avatarTone, cx } from '../../../../components/ui';
import { text } from '../../../../core/i18n';
import { callClock, clock, groupOf, initialsOf, onCall, ordinal, pathOf, since, STATE, STATES, stateOf, whereOf, type Group, type OnlineVisitor } from './liveMap';

/**
 * "On the site now" (worksuite-desktop C-00, ported from the web's OnSiteNow, WS-WCHAT MAP-UI-01/02): everybody on the
 * site, in the order they are acted on — the ones who need us first (waiting, at risk on top in red, the longest wait
 * next, each with its clock running and Join), then the ones in a chat (on a call, a colleague typing, or what was
 * said last, with Open), then the ones browsing (the page, which visit, where from, how long, with Start chat).
 */

const GROUPS: Array<{ id: Group; title: string }> = [
  { id: 'needs', title: 'Needs you' },
  { id: 'chat', title: 'In a chat' },
  { id: 'browsing', title: 'Browsing' },
];

/** The design's row tints for the two who need us (C-00): at risk red, waiting amber, each with a bar at the left. */
export const TINT: Partial<Record<string, string>> = {
  at_risk: 'bg-[#fdecea] shadow-[inset_3px_0_0_#c2392d] dark:bg-danger-bg',
  waiting: 'bg-[#fdf6e7] shadow-[inset_3px_0_0_#d9922e] dark:bg-warning-bg',
};

export function OnSiteNow({ visitors, now, skew = 0, limit = 10, selected = null, hidePlace = false, lastOf, onJoin, onOpen, onStart, onSelect }: {
  visitors: OnlineVisitor[];
  now: number;
  /** How far the server's clock is ahead of this one, in ms: waits are counted on its clock. */
  skew?: number;
  /** At most this many rows in all; each group still says how many it has. */
  limit?: number;
  selected?: number | null;
  /** Everybody listed is in one place, already named above: leave it off each row. */
  hidePlace?: boolean;
  /** What was said last in a chat, when the inbox knows it. */
  lastOf?: (conversationId: number) => string | null;
  onJoin: (v: OnlineVisitor) => void;
  onOpen: (v: OnlineVisitor) => void;
  onStart: (v: OnlineVisitor) => void;
  onSelect?: (v: OnlineVisitor) => void;
}) {
  const wait = (v: OnlineVisitor) => since(v.chat?.waiting_since, now, skew) ?? 0;
  const ranked = visitors.map((v) => ({ v, s: stateOf(v) }));
  const groups = GROUPS.map((g) => ({
    ...g,
    rows: ranked
      .filter((r) => groupOf(r.s) === g.id)
      .sort((a, b) =>
        g.id === 'needs'
          ? STATES.indexOf(a.s) - STATES.indexOf(b.s) || wait(b.v) - wait(a.v)
          : g.id === 'chat'
            ? STATES.indexOf(a.s) - STATES.indexOf(b.s)
            : a.v.on_site_seconds - b.v.on_site_seconds,
      ),
  })).filter((g) => g.rows.length > 0);

  if (!visitors.length) return <p className="px-3.5 py-6 text-center text-ink-3">{text('Nobody is on your sites right now.')}</p>;

  // Each group takes what is left of the limit, in order: the ones who need us are never cut for the ones browsing.
  const cut: number[] = [];
  groups.reduce((left, g) => {
    cut.push(Math.max(0, Math.min(left, g.rows.length)));
    return left - g.rows.length;
  }, limit);

  return (
    <div className="flex flex-col">
      {groups.map((g, gi) => (
        <div key={g.id} role="group" aria-label={text(g.title)}>
          <p className={cx('flex gap-1.5 px-3.5 pt-2.5 pb-1 text-[10.5px] font-bold tracking-[0.9px] uppercase', g.id === 'needs' ? 'text-[#c2392d] dark:text-danger' : 'text-ink-3')} aria-hidden>
            {text(g.title)}
            <span className="text-[#868997]">{g.rows.length}</span>
          </p>
          <ul className="flex flex-col">
            {g.rows.slice(0, cut[gi] ?? 0).map(({ v, s }) => {
              const who = v.name || v.label;
              const waited = g.id === 'needs' ? since(v.chat?.waiting_since, now, skew) : null;
              const call = onCall(v.chat) ? since(v.chat?.call?.since, now, skew) : null;
              const said = v.conversation_id && lastOf ? lastOf(v.conversation_id) : null;
              // Mine: "You" (MAP-UI-04 "On a call 02:14 · You").
              const agent = v.chat?.mine ? text('You') : (v.chat?.agent ?? text('Nobody yet'));
              const detail =
                g.id === 'needs'
                  ? `${text('Waiting')} · ${pathOf(v.current_url)}`
                  : g.id === 'chat'
                    ? call !== null
                      ? agent
                      : v.chat?.agent_typing
                        ? `${agent} · ${text('typing…')}`
                        : said
                          ? `${agent} · “${said}”`
                          : agent
                    : [
                        pathOf(v.current_url),
                        v.visits > 1 ? text('{n} visit', { n: ordinal(v.visits) }) : null,
                        v.referrer_host ? text('from {host}', { host: v.referrer_host }) : null,
                        v.on_site_seconds >= 60 ? `${Math.floor(v.on_site_seconds / 60)}m` : text('just arrived'),
                      ]
                        .filter(Boolean)
                        .join(' · ');
              return (
                <li
                  key={v.id}
                  aria-label={who}
                  aria-current={selected === v.id ? 'true' : undefined}
                  onClick={onSelect ? () => onSelect(v) : undefined}
                  className={cx('flex items-center gap-2.5 px-3.5 py-2', TINT[s] ?? (selected === v.id ? 'bg-selection' : 'hover:bg-subtle'), onSelect && 'cursor-pointer')}
                >
                  <VisitorAvatar v={v} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {who}
                      {!hidePlace ? (
                        <span className="text-[12px] font-normal">
                          {' · '}
                          <span className="text-ink-3">{whereOf(v)}</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-2">
                      {v.chat?.not_reaching_staff ? <NotReachingBadge /> : null}
                      {call !== null ? (
                        <>
                          <span className="font-semibold text-[#2b7a4b] dark:text-success">{text('On a call {time}', { time: callClock(call) })}</span>
                          {' · '}
                        </>
                      ) : null}
                      {detail}
                    </span>
                  </span>
                  {waited !== null ? (
                    <span className={cx('shrink-0 font-mono text-[12px] font-semibold whitespace-nowrap tabular-nums', s === 'at_risk' ? 'text-[#c2392d] dark:text-danger' : 'text-[#9a5b10] dark:text-warning')} aria-label={text('Waiting {time}', { time: clock(waited) })}>
                      {clock(waited)}
                    </span>
                  ) : null}
                  {g.id === 'needs' && v.conversation_id ? (
                    <Pill tone="join" onClick={() => onJoin(v)}>{text('Join')}</Pill>
                  ) : g.id === 'chat' && v.conversation_id ? (
                    <Pill onClick={() => onOpen(v)}>{text('Open')}</Pill>
                  ) : g.id === 'browsing' ? (
                    <Pill onClick={() => onStart(v)}>{text('Start chat')}</Pill>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * A visitor message no staff device has received for a minute (WS-WCHAT DLV-09, AC-D09): said on the row, for whoever
 * supervises to act on. It goes when a device of whoever holds the chat acknowledges it, or somebody answers.
 */
export function NotReachingBadge() {
  return (
    <span className="mr-1.5 inline-flex items-center rounded-full bg-[#fdecea] px-1.5 text-[10px] font-bold tracking-[0.4px] text-[#c2392d] uppercase dark:bg-danger-bg dark:text-danger" title={text('A message from this visitor has not reached any staff device')}>
      {text('Not reaching staff')}
    </span>
  );
}

/**
 * A visitor's initials in their colour, ringed in their state's colour when they need us or are on a call (C-00); the
 * Live map window's and the tray's rows draw it a little smaller (MAP-UI-04/05).
 */
export function VisitorAvatar({ v, small }: { v: OnlineVisitor; small?: boolean }) {
  const s = stateOf(v);
  const ring = s === 'at_risk' || s === 'waiting' || s === 'on_call' ? STATE[s].colour : null;
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold', small ? 'h-7 w-7' : 'h-[30px] w-[30px]', avatarTone(v.name || v.label))}
      style={ring ? { boxShadow: `0 0 0 2px var(--ws-surface), 0 0 0 4px ${ring}` } : undefined}
      title={text(STATE[s].label)}
      aria-hidden
    >
      {initialsOf(v)}
    </span>
  );
}

/** A row's action: Join in green, Open and Start chat outlined (C-00); the Live map window and the tray use them too. */
export function Pill({ tone, onClick, children, label }: { tone?: 'join'; onClick: () => void; children: string; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx(
        'h-7 shrink-0 rounded-full text-[12px] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary',
        tone === 'join' ? 'bg-[#2f9e67] px-3 font-bold text-white hover:bg-[#278a59]' : 'border border-line bg-surface px-2.5 font-semibold text-primary hover:bg-subtle',
      )}
    >
      {children}
    </button>
  );
}
