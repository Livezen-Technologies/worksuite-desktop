import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../../../../components/Icon';
import { text } from '../../../../core/i18n';
import { cx } from '../../../../components/ui';
import { RADIUS_MAX, clampOffset, firstName, initialsOf, namesLine, palette, type HoursSummary, type PreviewPerson, type WidgetDesign } from './design';

/**
 * A live preview of the visitor widget (worksuite-desktop#199): the home screen, a conversation, the away screen and
 * the launcher, drawn from the design being edited, before it is saved. The same sizes, colours and words as the
 * widget itself (`public/widget.js` on the server): a 380px panel with a 20px radius, 40px overlapping photos with
 * green dots, a 56px launcher, and text on the brand colour chosen for contrast.
 *
 * As #207 left it: the header names the company (never its web address), with minimise and maximise at its top right;
 * one status line; a start card that is just the message box; a dark theme with a darker brand header; and on the
 * Launcher screen, the launcher where its offsets put it.
 *
 * S-02 (UX-SET-03) adds the new chat as Widget › Appearance draws it — the header with the header title and subtitle,
 * the welcome message, the conversation starters, the message box with the send button in the accent colour, and the
 * button (an icon, or the icon and its words) — and every screen takes the panel's corner radius and the accent.
 *
 * Nothing in it can be focused or pressed: it is a picture of a page, described for a screen reader by its label.
 */

export type PreviewScreen = 'start' | 'home' | 'chat' | 'away' | 'launcher';

/** What the away screen says without an offline message of the widget's own (and what Business hours shows then, S-10). */
export const AWAY_MESSAGE = 'Leave a message and we will reply by email when we are back.';

const TINTS: Array<[string, string]> = [['#F4B183', '#5A2A08'], ['#A7D3F5', '#0B3B63'], ['#C9E6B8', '#23431A'], ['#D9C8F2', '#3B1F6B'], ['#F7D27A', '#4A3500'], ['#F5B8C4', '#5C1426']];

function tint(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length]!;
}

interface Tokens {
  ink: string;
  sub: string;
  mut: string;
  bg: string;
  sf: string;
  ln: string;
  fl: string;
  fln: string;
  ok: string;
  okb: string;
  day: string;
}

const LIGHT: Tokens = { ink: '#121633', sub: '#4B5070', mut: '#6B7090', bg: '#F6F7FB', sf: '#FFFFFF', ln: '#E4E7F1', fl: '#F6F7FB', fln: '#DDE1EE', ok: '#15803D', okb: '#E7F7EC', day: '#E9ECF5' };
const DARK: Tokens = { ink: '#EEF0FA', sub: '#C9CCE0', mut: '#A3A8C3', bg: '#0F1226', sf: '#1A1E3A', ln: '#2A2F52', fl: '#12152C', fln: '#3A4170', ok: '#4ADE80', okb: '#14352A', day: '#262B4D' };

function Face({ p, size, ring, dot, dim }: { p: PreviewPerson | { name: string; avatar: string | null }; size: number; ring?: string; dot?: 'on' | 'off' | null; dim?: boolean }) {
  const [bg, fg] = tint(p.name);
  return (
    <span className="relative block shrink-0" style={{ width: size, height: size, opacity: dim ? 0.75 : 1 }}>
      {p.avatar ? (
        <img src={p.avatar} alt="" className="block h-full w-full rounded-full object-cover" style={{ border: ring ? `2px solid ${ring}` : undefined }} />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full font-bold" style={{ background: bg, color: fg, fontSize: Math.round(size * 0.34), border: ring ? `2px solid ${ring}` : undefined }}>
          {initialsOf(p.name)}
        </span>
      )}
      {dot ? <span className="absolute rounded-full" style={{ right: -1, bottom: -1, width: Math.max(9, size * 0.28), height: Math.max(9, size * 0.28), background: dot === 'on' ? '#22C55E' : '#9AA0BC', border: `2px solid ${ring ?? '#fff'}` }} /> : null}
    </span>
  );
}

function Stack({ people, size, ring, dot, more }: { people: PreviewPerson[]; size: number; ring: string; dot?: 'on' | 'off' | null; more?: number }) {
  return (
    <span className="flex items-center">
      {people.slice(0, 3).map((p, i) => (
        <span key={p.name + i} style={{ marginLeft: i ? -10 : 0 }}>
          <Face p={p} size={size} ring={ring} dot={dot} dim={dot === 'off'} />
        </span>
      ))}
      {more && more > 0 ? (
        <span className="flex items-center justify-center rounded-full font-bold" style={{ marginLeft: -10, width: size, height: size, fontSize: 13, background: 'rgba(255,255,255,.22)', border: `2px solid ${ring}` }}>
          +{more}
        </span>
      ) : null}
    </span>
  );
}

const SEND = 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z';

function Svg({ d, size = 18, color }: { d: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** The logo, or the company's initial; without a company name, a chat mark rather than the initial of anything else. */
function Logo({ design, name, color }: { design: WidgetDesign; name: string | null; color: string }) {
  return design.logo_url ? (
    <img src={design.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-[9px] bg-white object-cover" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-white text-[16px] font-extrabold" style={{ color }} data-testid="preview-logo">
      {name ? name.charAt(0).toUpperCase() : <Icon name="message-circle" size={17} />}
    </span>
  );
}

/** Minimise and maximise, as the widget draws them at the top right of its header (#207). */
function Controls({ bg, color }: { bg: string; color?: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-testid="preview-controls" style={{ color }}>
      <span className="flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ background: bg }} title="Minimise chat"><Icon name="minus" size={16} /></span>
      <span className="flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ background: bg }} title="Maximise chat"><Icon name="maximize" size={16} /></span>
    </span>
  );
}

function Powered({ t }: { t: Tokens }) {
  return (
    <div className="p-2.5 text-center text-[11px]" style={{ color: t.mut, background: t.sf, borderTop: `1px solid ${t.ln}` }}>
      Powered by <b style={{ color: t.ink }}>WorkSuite</b>
    </div>
  );
}

const LINK_ICON = (label: string, url: string): string => {
  const s = `${label} ${url}`.toLowerCase();
  if (url.startsWith('mailto:')) return 'mail';
  if (url.startsWith('tel:')) return 'phone';
  if (/price|pricing|plan|cost|quote|billing/.test(s)) return 'banknote';
  if (/support|help|technical|issue|fix|faq/.test(s)) return 'wrench';
  if (/demo|book|meet|appointment|calendar|schedule/.test(s)) return 'calendar';
  return 'file-text';
};
const LINK_TINTS: Array<(soft: string, text: string) => [string, string]> = [(s, a) => [s, a], () => ['#FFF1E6', '#B4540E'], () => ['#E7F7EC', '#15803D']];

function Hero({ design, name, people, replyTime, away, hours, accent, onAccent }: { design: WidgetDesign; name: string | null; people: PreviewPerson[]; replyTime: string | null; away: boolean; hours: HoursSummary | null; accent: string; onAccent: string }) {
  const bg = away ? '#121633' : accent;
  const fg = away ? '#ffffff' : onAccent;
  const ctl = fg === '#ffffff' ? 'rgba(255,255,255,.16)' : 'rgba(18,22,51,.08)';
  const greeting = away ? 'We are away\nright now' : design.greeting || 'Hi there,\nhow can we help?';
  const tag = away ? design.offline_message || AWAY_MESSAGE : design.header_subtitle || 'Ask us anything, and someone from the team will reply here.';
  const online = people.length ? `${namesLine(people.map((p) => firstName(p.name)))} ${people.length === 1 ? 'is' : 'are'} online` : 'We are online';
  // One status line while the team is here (#207): "Hasarinda is online · usually replies in a few minutes".
  const line1 = away ? (hours?.back_at ? `Back at ${hours.back_at}` : 'We will reply as soon as we are back') : replyTime ? `${online} · ${replyTime.charAt(0).toLowerCase()}${replyTime.slice(1)}` : online;
  const line2 = away ? (hours ? `Business hours: ${hours.text}${hours.zone ? ` (${hours.zone})` : ''}` : '') : '';
  return (
    <div className="flex shrink-0 flex-col gap-[18px] px-5 pt-5 pb-[60px]" style={{ background: bg, color: fg }}>
      <div className="flex items-center justify-between gap-2.5">
        <span className="flex min-w-0 items-center gap-2.5">
          <Logo design={design} name={name} color={palette(design.brand_color).accentText} />
          <span className="truncate text-[15px] font-bold">{name ?? 'Chat with us'}</span>
        </span>
        <Controls bg={away ? 'rgba(255,255,255,.16)' : ctl} />
      </div>
      <div>
        <div className="text-[26px] leading-[1.15] font-extrabold tracking-[-0.02em] whitespace-pre-line">{greeting}</div>
        <div className="mt-1.5 text-[14px] opacity-90">{tag}</div>
      </div>
      <div className="flex min-h-10 items-center gap-3">
        {people.length ? <Stack people={people} size={40} ring={bg} dot={away ? 'off' : 'on'} more={away ? 0 : people.length - 3} /> : null}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-bold">{line1}</span>
          {line2 ? <span className="text-[12px] opacity-85">{line2}</span> : null}
        </span>
      </div>
    </div>
  );
}

function Card({ t, children, className, style }: { t: Tokens; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('flex flex-col gap-3 rounded-[16px] p-4', className)} style={{ background: t.sf, boxShadow: '0 6px 20px -8px rgba(18,22,51,.18), 0 0 0 1px rgba(18,22,51,.05)', ...style }}>
      {children}
    </div>
  );
}

function Pill({ t, on, children }: { t: Tokens; on: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={on ? { color: t.ok, background: t.okb } : { color: t.sub, background: t.day }}>
      <i className="block h-[7px] w-[7px] rounded-full" style={{ background: on ? '#22C55E' : '#9AA0BC' }} />
      {children}
    </span>
  );
}

function HomeScreen({ design, name, people, replyTime, hours, away, dark, t }: { design: WidgetDesign; name: string | null; people: PreviewPerson[]; replyTime: string | null; hours: HoursSummary | null; away: boolean; dark: boolean; t: Tokens }) {
  const p = palette(design.brand_color);
  const send = palette(design.accent_color);
  const links = design.quick_links.filter((l) => l.label.trim() && l.url.trim());
  const field = { background: t.fl, border: `1px solid ${t.fln}`, color: t.mut };
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: t.bg }}>
      {/* Dark: a darker brand header over the dark body, white on it (#207). */}
      <Hero design={design} name={name} people={people} replyTime={replyTime} away={away} hours={hours} accent={dark ? p.darkHeader : p.accent} onAccent={dark ? '#ffffff' : p.onAccent} />
      <div className="-mt-10 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
        {away ? (
          <Card t={t}>
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-bold">Leave a message</span>
              <Pill t={t} on={false}>Away</Pill>
            </div>
            {['Your name', 'Email', 'How can we help?'].map((l) => (
              <span key={l} className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold" style={{ color: t.sub }}>{l}</span>
                <span className="h-[38px] rounded-[10px]" style={field} />
              </span>
            ))}
            <span className="flex h-[42px] items-center justify-center rounded-[12px] text-[14px] font-bold" style={{ background: p.accent, color: p.onAccent }}>Send message</span>
          </Card>
        ) : (
          // Just the message box (#207): the header already says who is here and when they reply.
          <Card t={t}>
            <span className="flex items-center gap-2 rounded-[12px] py-1.5 pr-1.5 pl-3.5" style={field} data-testid="preview-start">
              <span className="flex-1 text-[14px]">Write a message…</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ background: send.accent, color: send.onAccent }} data-testid="preview-send"><Svg d={SEND} /></span>
            </span>
          </Card>
        )}
        {away && design.whatsapp_number ? (
          <Card t={t} className="flex-row items-center gap-2.5 px-3.5 py-3" style={{ boxShadow: '0 0 0 1px rgba(18,22,51,.05)' }}>
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px]" style={{ background: '#E7F7EC', color: '#15803D' }}><Icon name="phone" size={17} /></span>
            <span className="flex flex-col">
              <b className="text-[13px]">Urgent? Message us on WhatsApp</b>
              <span className="text-[12px]" style={{ color: t.mut }}>{design.whatsapp_number}</span>
            </span>
          </Card>
        ) : null}
        {links.length ? (
          <Card t={t} className="gap-0 p-1.5" style={{ boxShadow: '0 0 0 1px rgba(18,22,51,.05)' }}>
            <span className="px-3 pt-2.5 pb-1.5 text-[11px] font-bold tracking-[.08em] uppercase" style={{ color: t.mut }}>Quick help</span>
            {links.map((l, i) => {
              const [bg, fg] = LINK_TINTS[i % 3]!(p.accentSoft, p.accentText);
              return (
                <span key={i} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5">
                  <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px]" style={{ background: bg, color: fg }}><Icon name={LINK_ICON(l.label, l.url)} size={17} /></span>
                  <span className="flex-1 truncate text-[14px] font-semibold">{l.label}</span>
                  <Icon name="chevron-right" size={16} className="text-[#9AA0BC]" />
                </span>
              );
            })}
          </Card>
        ) : null}
      </div>
      <Powered t={t} />
    </div>
  );
}

function ChatScreen({ design, people, t }: { design: WidgetDesign; people: PreviewPerson[]; t: Tokens }) {
  const ctl = t === DARK ? '#232849' : '#F1F3F9';
  const p = palette(design.brand_color);
  const who = people[0] ?? { name: 'Alex Morgan', role: 'Support', avatar: null, online: true };
  const bubbleThem = { background: t.sf, boxShadow: '0 0 0 1px rgba(18,22,51,.06)', borderRadius: '16px 16px 16px 4px' };
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: t.bg }}>
      <div className="flex items-center gap-2.5 py-3 pr-3 pl-2" style={{ background: t.sf, borderBottom: `1px solid ${t.ln}` }}>
        <Icon name="chevron-left" size={18} />
        <Face p={who} size={40} ring={t.sf} dot="on" />
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="truncate text-[15px]">{who.name}</b>
          <span className="truncate text-[12px] font-semibold" style={{ color: t.ok }}>Online{who.role ? ` · ${who.role}` : ''}</span>
        </span>
        <Icon name="more" size={18} />
        <Controls bg={ctl} color={t.sub} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-4 text-[14px] leading-[1.45]">
        <span className="self-center rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: t.day, color: t.mut }}>Today</span>
        <span className="flex items-center gap-2 self-center text-[12px]" style={{ color: t.mut }}>
          <Face p={who} size={18} /> {firstName(who.name)} joined the conversation
        </span>
        <span className="flex max-w-[78%] flex-col items-end gap-1 self-end">
          <span className="px-3.5 py-2.5" style={{ background: p.accent, color: p.onAccent, borderRadius: '16px 16px 4px 16px' }}>Hi, I need the renewal quote for our plan.</span>
          <span className="flex items-center gap-1 text-[11px]" style={{ color: t.mut }}>9:41 AM <Icon name="check-check" size={14} className="text-[color:var(--at)]" /></span>
        </span>
        <span className="flex max-w-[82%] items-end gap-2 self-start">
          <Face p={who} size={26} />
          <span className="px-3.5 py-2.5" style={bubbleThem}>Sure, I can share the renewal quote now. Which domain is it for?</span>
        </span>
        <span className="flex items-end gap-2 self-start">
          <Face p={who} size={26} />
          <span className="flex w-[236px] items-center gap-2.5 rounded-[14px] p-2.5" style={{ background: t.sf, boxShadow: '0 0 0 1px rgba(18,22,51,.06)' }}>
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[9px] text-[10px] font-extrabold" style={{ background: '#FDECEC', color: '#B42318' }}>PDF</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-[13px]">Renewal-quote.pdf</b>
              <span className="text-[11px]" style={{ color: t.mut }}>242 KB · PDF</span>
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ background: p.accentSoft, color: p.accentText }}><Icon name="download" size={16} /></span>
          </span>
        </span>
        <span className="flex items-center gap-2 self-start">
          <Face p={who} size={26} />
          <span className="flex gap-1 rounded-[16px] px-3.5 py-3" style={{ background: t.sf, boxShadow: '0 0 0 1px rgba(18,22,51,.06)' }}>
            {['#9AA0BC', '#B9BED4', '#D6D9E6'].map((c) => <i key={c} className="block h-[7px] w-[7px] rounded-full" style={{ background: c }} />)}
          </span>
          <span className="text-[11px]" style={{ color: t.mut }}>{firstName(who.name)} is typing</span>
        </span>
      </div>
      <div className="flex flex-col gap-2 px-3 pt-2.5 pb-3" style={{ background: t.sf, borderTop: `1px solid ${t.ln}` }}>
        <div className="flex items-end gap-2">
          <span className="flex flex-1 items-center gap-1 rounded-[14px] py-1 pr-1 pl-3" style={{ background: t.fl, border: `1px solid ${t.fln}`, color: t.mut }}>
            <span className="flex-1 py-2 text-[14px]">Write a message…</span>
            <Icon name="smile" size={18} className="m-[9px]" />
            <Icon name="paperclip" size={18} className="m-[9px]" />
          </span>
          <span className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px]" style={{ background: palette(design.accent_color).accent, color: palette(design.accent_color).onAccent }}><Svg d={SEND} /></span>
        </div>
        <span className="text-center text-[11px]" style={{ color: t.mut }}>Powered by <b style={{ color: t.ink }}>WorkSuite</b></span>
      </div>
    </div>
  );
}

function Launcher({ design, people, style }: { design: WidgetDesign; people: PreviewPerson[]; style?: CSSProperties }) {
  const p = palette(design.brand_color);
  const round = design.launcher_style === 'bubble' || people.length === 0;
  return (
    <span
      className={cx('relative flex h-[56px] items-center gap-2.5 rounded-full text-[15px] font-bold', round ? 'w-[56px] justify-center' : 'pr-5 pl-2')}
      style={{ background: p.accent, color: p.onAccent, boxShadow: `0 10px 24px -8px ${p.accent}8C, 0 2px 6px rgba(18,22,51,.14)`, ...style }}
      data-testid="preview-launcher"
    >
      {round ? <Icon name="message-circle" size={24} /> : <><Stack people={people} size={40} ring={p.accent} /><span>Chat with us</span></>}
      <span className="absolute -top-1 right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#D92D20] px-1 text-[11px] text-white">1</span>
    </span>
  );
}

function Greeting({ design, name, people, t }: { design: WidgetDesign; name: string | null; people: PreviewPerson[]; t: Tokens }) {
  const p = palette(design.brand_color);
  const who = people[0];
  const company = name ?? 'Chat with us';
  return (
    <div className="flex w-[300px] flex-col gap-3 rounded-[18px] p-3.5" style={{ background: t.sf, color: t.ink, boxShadow: '0 18px 40px -14px rgba(18,22,51,.3), 0 0 0 1px rgba(18,22,51,.06)' }}>
      <div className="flex items-center gap-2.5">
        {who ? <Face p={who} size={36} dot="on" ring={t.sf} /> : <Logo design={design} name={name} color={p.accentText} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="text-[13px]">{who ? `${firstName(who.name)} from ${company}` : company}</b>
          <span className="text-[12px] font-semibold" style={{ color: t.ok }}>Online now</span>
        </span>
        <Icon name="x" size={14} />
      </div>
      <div className="text-[14px] leading-[1.45]">{design.greeting_text || 'Hi there. Ask us anything — we are here to help.'}</div>
    </div>
  );
}

/** The panel's corners, as the widget holds them: 0–32px. */
const radiusOf = (design: WidgetDesign) => Math.max(0, Math.min(RADIUS_MAX, Math.round(design.border_radius)));

/**
 * The new chat as S-02 draws it: what a visitor sees on opening the chat — the header in the brand colour with the
 * company's initials, the header title and subtitle; the welcome message and the conversation starters; the message box
 * with the send button in the accent colour — and under it the button, an icon or the icon and its words.
 */
function StartScreen({ design, siteName, starters, dark, launcher = true }: { design: WidgetDesign; siteName: string | null; starters: string[]; dark: boolean; launcher?: boolean }) {
  const t = dark ? DARK : LIGHT;
  const p = palette(design.brand_color);
  const send = palette(design.accent_color);
  const left = design.position === 'bottom_left';
  const title = design.header_title?.trim() || siteName || 'Chat with us';
  const head = dark ? p.darkHeader : p.accent;
  const onHead = dark ? '#ffffff' : p.onAccent;
  const round = design.launcher_style === 'bubble';
  return (
    <div className={cx('flex w-full flex-col gap-3', left ? 'items-start' : 'items-end')} data-testid="preview-start-chat">
      <div className="w-[310px] max-w-full overflow-hidden" style={{ borderRadius: radiusOf(design), background: t.sf, color: t.ink, boxShadow: '0 16px 40px rgba(17,27,59,0.18)' }} data-testid="preview-panel">
        <div className="flex items-center gap-2.5 px-4 py-3.5" style={{ background: head, color: onHead }}>
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: onHead === '#ffffff' ? 'rgba(255,255,255,0.2)' : 'rgba(18,22,51,0.1)' }}>{initialsOf(title)}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="truncate text-[14px]">{title}</b>
            {design.header_subtitle ? <span className="truncate text-[11.5px] opacity-85">{design.header_subtitle}</span> : null}
          </span>
        </div>
        <div className="flex min-h-[170px] flex-col gap-2.5 p-3.5" style={{ background: dark ? t.bg : '#F8F9FC' }}>
          {design.welcome_message ? (
            <span className="self-start px-3 py-2 text-[13px] whitespace-pre-line" style={{ background: t.sf, border: `1px solid ${t.ln}`, borderRadius: '12px 12px 12px 4px' }}>{design.welcome_message}</span>
          ) : null}
          {starters.length ? (
            <span className="flex flex-wrap gap-1.5">
              {starters.slice(0, 4).map((x, i) => (
                <span key={i} className="rounded-[14px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ border: `1px solid ${dark ? p.accentSoft : p.accentText}`, color: dark ? p.accentSoft : p.accentText }}>{x}</span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderTop: `1px solid ${t.ln}` }}>
          <span className="flex-1 text-[12.5px]" style={{ color: t.mut }}>Write a message…</span>
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full" style={{ background: send.accent, color: send.onAccent }} data-testid="preview-send"><Svg d={SEND} size={15} /></span>
        </div>
      </div>
      {launcher ? <span
        className={cx('flex h-[52px] items-center justify-center gap-2 rounded-full text-[14px] font-bold', round ? 'w-[52px]' : 'px-5')}
        style={{ background: p.accent, color: p.onAccent, boxShadow: '0 8px 20px rgba(17,27,59,0.25)' }}
        data-testid="preview-button"
      >
        <Icon name="message-circle" size={24} />
        {round ? null : <span>{design.header_title?.trim() || 'Chat with us'}</span>}
      </span> : null}
    </div>
  );
}

/** `launcher`: the button under the new chat; Conversation starters' preview (S-08) shows the chat alone. */
export function WidgetPreview({ design, siteName, people, replyTime, hours, screen, dark, starters = [], launcher = true }: { design: WidgetDesign; siteName: string | null; people: PreviewPerson[]; replyTime: string | null; hours: HoursSummary | null; screen: PreviewScreen; dark: boolean; starters?: string[]; launcher?: boolean }) {
  if (screen === 'start') {
    return (
      <div role="img" aria-label="Preview of a new chat" data-testid="widget-preview" className="flex w-full" style={{ fontFamily: '"Plus Jakarta Sans", -apple-system, "Segoe UI", system-ui, sans-serif' }}>
        <StartScreen design={design} siteName={siteName} starters={starters} dark={dark} launcher={launcher} />
      </div>
    );
  }
  const t = dark ? DARK : LIGHT;
  const p = palette(design.brand_color);
  const left = design.position === 'bottom_left';
  // Where the launcher sits on the page: its offsets from the bottom and from its side (#207).
  const bottom = clampOffset(design.launcher_offset_bottom);
  const side = clampOffset(left ? design.launcher_offset_left : design.launcher_offset_right);
  const label = { home: 'the home screen', chat: 'a conversation', away: 'the away screen', launcher: 'the launcher' }[screen as Exclude<PreviewScreen, 'start'>];
  return (
    <div
      role="img"
      aria-label={`Preview of ${label}`}
      data-testid="widget-preview"
      className={cx('flex w-[420px] shrink-0 flex-col gap-4 rounded-[14px] p-5', left ? 'items-start' : 'items-end')}
      style={{ background: dark ? '#05060F' : '#E9ECF5', color: t.ink, fontFamily: '"Plus Jakarta Sans", -apple-system, "Segoe UI", system-ui, sans-serif', ['--at' as string]: p.accentText }}
    >
      {screen === 'launcher' ? (
        // The corner of a page, to scale: the launcher sits where its offsets put it, the greeting card 16px above it.
        <div className="relative h-[560px] w-full rounded-[10px]" style={{ outline: `1px dashed ${t.fln}` }} data-testid="preview-page">
          <div className={cx('absolute flex flex-col gap-4', left ? 'items-start' : 'items-end')} style={{ bottom, [left ? 'left' : 'right']: side }} data-testid="preview-corner">
            {design.greeting_delay > 0 ? <Greeting design={design} name={siteName} people={people} t={t} /> : <span className="text-[12px]" style={{ color: t.mut }}>No greeting card: its delay is off.</span>}
            <Launcher design={design} people={people} />
          </div>
          <span className="absolute top-2 text-[11px]" style={{ color: t.mut, [left ? 'right' : 'left']: 8 }}>{text('{bottom}px from the bottom, {side}px from the {edge}', { bottom, side, edge: left ? text('left') : text('right') })}</span>
        </div>
      ) : (
        <>
          <div className="flex h-[600px] w-[380px] flex-col overflow-hidden" style={{ borderRadius: radiusOf(design), boxShadow: '0 24px 60px -16px rgba(18,22,51,.35), 0 0 0 1px rgba(18,22,51,.06)' }}>
            {screen === 'chat' ? <ChatScreen design={design} people={people} t={t} /> : <HomeScreen design={design} name={siteName} people={people} replyTime={replyTime} hours={hours} away={screen === 'away'} dark={dark} t={t} />}
          </div>
          {/* Open, the launcher is the cross that closes it, 16px under the panel. */}
          <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full" style={{ background: p.accent, color: p.onAccent }} title="Close chat"><Icon name="x" size={22} /></span>
        </>
      )}
    </div>
  );
}
