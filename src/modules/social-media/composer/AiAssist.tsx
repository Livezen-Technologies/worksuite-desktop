/**
 * W02 / D02 Create post — AI assist (SMM-AI-001..004, AC-13): write from a brief, rewrite, shorten for a network,
 * change tone, translate, suggest hashtags, alt text. What comes back is always a suggestion card; nothing reaches
 * the post until someone presses Insert or Replace.
 */
import { useState } from 'react';
import { Button, cx } from '../../../components/ui';
import type { socialApi } from '../api';
import { networkInfo, type Network } from '../lib/networks';
import { INPUT, NativeSelect } from '../parts';

export type AiRequest = Parameters<typeof socialApi.aiCompose>[0];

export interface AiSuggestion {
  text: string;
  /** Where Insert / Replace put it: the Original (null) or one network's variant. */
  scope: Network | null;
  kind: 'text' | 'alt';
  /** For alt text: which picture. */
  mediaIndex?: number;
  label: string;
}

const TONES = ['Friendly', 'Professional', 'Playful', 'Confident', 'Formal'];
const LANGUAGES = ['Sinhala', 'Tamil', 'English'];

export function AiAssist({ networks, active, busy, hasImage, onRun }: { networks: Network[]; active: Network | null; busy: boolean; hasImage: boolean; onRun: (req: AiRequest, label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [net, setNet] = useState<string>(active ?? networks[0] ?? '');
  const [tone, setTone] = useState(TONES[0]!);
  const [lang, setLang] = useState(LANGUAGES[0]!);
  const shortenFor = networks.includes(net as Network) ? net : (active ?? networks[0] ?? '');
  return (
    <div className="rounded-[10px] border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] font-semibold text-ink">
        <span className="inline-flex items-center gap-1.5 text-primary">✦ AI assist</span>
        <span className="text-[11.5px] font-normal text-ink-3">{open ? 'Hide' : 'Suggestions only — you choose what goes in'}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-line px-3 py-3">
          <div className="flex gap-2">
            <input aria-label="Brief" className={INPUT} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="A brief: what the post is about, who it is for" />
            <Button size="sm" variant="secondary" disabled={busy || !brief.trim()} onClick={() => onRun({ action: 'write', brief: brief.trim(), network: active }, 'Written from your brief')}>
              Write
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRun({ action: 'rewrite', network: active }, 'Rewritten')}>
              Rewrite
            </Button>
            {networks.length ? (
              <span className="inline-flex items-center gap-1">
                <Button size="sm" variant="ghost" disabled={busy || !shortenFor} onClick={() => onRun({ action: 'shorten', network: shortenFor }, `Shortened for ${networkInfo(shortenFor).label}`)}>
                  Shorten for
                </Button>
                <NativeSelect label="Shorten for network" value={shortenFor} onChange={setNet} className="h-8 w-auto">
                  {networks.map((n) => (
                    <option key={n} value={n}>
                      {networkInfo(n).label}
                    </option>
                  ))}
                </NativeSelect>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRun({ action: 'tone', tone: tone.toLowerCase(), network: active }, `In a ${tone.toLowerCase()} tone`)}>
                Change tone
              </Button>
              <NativeSelect label="Tone" value={tone} onChange={setTone} className="h-8 w-auto">
                {TONES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </NativeSelect>
            </span>
            <span className="inline-flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRun({ action: 'translate', language: lang, network: active }, `In ${lang}`)}>
                Translate
              </Button>
              <NativeSelect label="Language" value={lang} onChange={setLang} className="h-8 w-auto">
                {LANGUAGES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </NativeSelect>
            </span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRun({ action: 'hashtags', network: active }, 'Suggested hashtags')}>
              Suggest hashtags
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || !hasImage} onClick={() => onRun({ action: 'alt_text' }, 'Alt text')} title={hasImage ? undefined : 'Add a picture first'}>
              Alt text
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SuggestionCard({ s, onInsert, onReplace, onDismiss }: { s: AiSuggestion; onInsert: () => void; onReplace: () => void; onDismiss: () => void }) {
  return (
    <div role="region" aria-label="AI suggestion" className={cx('rounded-[10px] border border-primary/30 bg-selection px-3 py-2.5')}>
      <div className="mb-1 text-[11.5px] font-semibold text-primary">
        ✦ AI suggestion · {s.label}
        {s.scope ? ` · ${networkInfo(s.scope).label}` : ''}
      </div>
      <p className="text-[13px] whitespace-pre-wrap text-ink">{s.text}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onInsert}>
          Insert
        </Button>
        {s.kind === 'text' ? (
          <Button size="sm" variant="secondary" onClick={onReplace}>
            Replace
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
