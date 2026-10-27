import { useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Button, cx } from '../../../components/ui';
import { apiPost } from '../../../core/api';
import { app } from '../../../core/app-state';
import { LANGUAGES, useLanguage } from '../../../core/i18n';
import { useStore } from '../../../core/store';
import { navigate } from '../../../core/tabs';
import { useTextAi } from '../textTools';
import { GUIDES } from './catalog';
import { findGuides, guideText, mayDo, suggestions, type Guide } from './guides';
import { startShowMe } from './ShowMe';
import { MyRequests, type SupportKind } from './ContactSupport';

/**
 * Help & Guide in the AI Assistant (worksuite-desktop#54): the guide cards in the conversation, the Help & Guide
 * list, the answer when no guide covers a question, and the support request the person reads before it goes.
 */

export const guideById = (id: string | undefined): Guide | null => GUIDES.find((g) => g.id === id) ?? null;

const languageName = (id: string) => (LANGUAGES.find((l) => l.id === id)?.label ?? id).replace(/^.*\((.*)\)$/, '$1');

/** One guide, as an answer: what it needs, the numbered steps, Open, Show me, other guides, and Was this helpful? */
export function GuideCard({ guide, question, others = [], onOpenGuide, onSupport }: { guide: Guide; question?: string; others?: Guide[]; onOpenGuide: (g: Guide) => void; onSupport: (kind: SupportKind, question?: string) => void }) {
  const permissions = useStore(app, (s) => s.bootstrap?.permissions);
  const language = useLanguage();
  const allowed = mayDo(guide, permissions);
  const ai = useTextAi();
  const [translated, setTranslated] = useState<{ phase: 'working' | 'done' | 'error'; text: string } | null>(null);
  const [helpful, setHelpful] = useState<boolean | null>(null);

  const translate = () => {
    setTranslated({ phase: 'working', text: '' });
    ai.run('translate', `${languageName(language)}\n${guideText(guide)}`).done.then(
      (r) => setTranslated({ phase: 'done', text: r.text }),
      (e: unknown) => setTranslated({ phase: 'error', text: e instanceof Error ? e.message : 'It could not be translated just now.' }),
    );
  };
  const rate = (yes: boolean) => {
    setHelpful(yes);
    // A server without the endpoint is fine: the answer is kept from being asked again either way.
    void apiPost('/api/ai/help/feedback', { guide: guide.id, question: question ?? null, helpful: yes, version: app.get().info?.version ?? null }).catch(() => undefined);
  };

  return (
    <section aria-label={`Guide: ${guide.title}`} className="space-y-2 rounded-[12px] border border-line bg-surface p-3 text-[13px]">
      <header className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-selection text-primary">
          <Icon name="book-open" size={15} />
        </span>
        <b className="flex-1 text-[13.5px] text-ink">{guide.title}</b>
        <span className="text-[11px] text-ink-3">Guide · this version</span>
      </header>
      {!allowed ? (
        <p className="flex items-start gap-1.5 rounded-[8px] bg-warning-bg px-2.5 py-1.5 text-[12px] text-warning-strong dark:text-warning">
          <Icon name="lock" size={13} className="mt-0.5 shrink-0" />
          You can read how it is done, but doing it needs: {guide.permissionLabel ?? 'a permission you do not have'}. Ask your administrator for it.
        </p>
      ) : null}
      {translated?.phase === 'done' ? (
        <div className="whitespace-pre-wrap text-ink selectable" lang={language}>{translated.text}</div>
      ) : (
        <ol className="list-decimal space-y-1 pl-5 text-ink selectable">
          {guide.steps.map((s, i) => (
            <li key={i}>{s.text}</li>
          ))}
        </ol>
      )}
      {translated?.phase === 'working' ? <p role="status" className="text-[12px] text-ink-3">Translating…</p> : null}
      {translated?.phase === 'error' ? <p role="alert" className="text-[12px] text-danger">{translated.text}</p> : null}
      {guide.tips?.length && translated?.phase !== 'done' ? (
        <ul className="space-y-0.5 text-[12px] text-ink-2">
          {guide.tips.map((t) => (
            <li key={t} className="flex gap-1.5">
              <Icon name="info" size={12} className="mt-0.5 shrink-0 text-ink-3" />
              {t}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <Button size="sm" variant="primary" icon="sparkles" onClick={() => startShowMe(guide)} title="Highlights each control on the screen. It changes nothing.">
          Show me
        </Button>
        <Button size="sm" icon="external" onClick={() => navigate(guide.route)}>
          Open the screen
        </Button>
        {language !== 'en' && ai.engine && translated?.phase !== 'done' ? (
          <Button size="sm" variant="ghost" onClick={translate} disabled={translated?.phase === 'working'}>
            Show in {languageName(language)}
          </Button>
        ) : null}
      </div>
      {others.length ? (
        <p className="text-[12px] text-ink-3">
          Or:{' '}
          {others.map((g, i) => (
            <span key={g.id}>
              {i ? ' · ' : ''}
              <button type="button" onClick={() => onOpenGuide(g)} className="font-semibold text-primary hover:underline">
                {g.title}
              </button>
            </span>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[12px] text-ink-3">
        {helpful === null ? (
          <>
            Was this helpful?
            <button type="button" onClick={() => rate(true)} className="rounded-[6px] border border-line px-2 py-0.5 font-semibold text-ink hover:bg-subtle">Yes</button>
            <button type="button" onClick={() => rate(false)} className="rounded-[6px] border border-line px-2 py-0.5 font-semibold text-ink hover:bg-subtle">No</button>
          </>
        ) : helpful ? (
          <span role="status">Thanks for telling us.</span>
        ) : (
          <span role="status" className="flex flex-wrap items-center gap-2">
            Thanks — sorry it did not help.
            <button type="button" onClick={() => onSupport('issue', question)} className="font-semibold text-primary hover:underline">Report an issue</button>
          </span>
        )}
      </div>
    </section>
  );
}

/** No guide covers the question: say so, offer the assistant's general guidance, and support. */
export function NoGuideCard({ question, onAsk, onSupport }: { question: string; onAsk?: () => void; onSupport: (kind: SupportKind, question?: string) => void }) {
  return (
    <section aria-label="No guide for this" className="space-y-2 rounded-[12px] border border-line bg-surface p-3 text-[13px]">
      <p className="text-ink">There is no guide for that in this version of WorkSuite yet, so I can’t give you checked steps.</p>
      <div className="flex flex-wrap gap-1.5">
        {onAsk ? (
          <Button size="sm" icon="sparkles" onClick={onAsk}>
            Ask the assistant anyway
          </Button>
        ) : null}
        <Button size="sm" icon="help" onClick={() => onSupport('support', question)}>
          Contact Support
        </Button>
        <Button size="sm" variant="ghost" icon="alert" onClick={() => onSupport('issue', question)}>
          Report an Issue
        </Button>
      </div>
    </section>
  );
}

/** Help & Guide: guides for the app the person is in first, a search, and support. */
export function HelpPanel({ module, onOpenGuide, onSupport, onClose }: { module: string | null; onOpenGuide: (g: Guide) => void; onSupport: (kind: SupportKind) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const found = q.trim() ? findGuides(GUIDES, q, module, 8) : null;
  const list = found ?? suggestions(GUIDES, module, GUIDES.length);
  const here = !found ? list.filter((g) => g.module === module) : [];
  const rest = !found ? list.filter((g) => g.module !== module) : list;
  const row = (g: Guide) => (
    <li key={g.id}>
      <button type="button" onClick={() => onOpenGuide(g)} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-ink hover:bg-subtle">
        <Icon name="book-open" size={14} className="shrink-0 text-ink-3" />
        <span className="flex-1">{g.title}</span>
        <Icon name="chevron-right" size={13} className="text-ink-3" />
      </button>
    </li>
  );
  return (
    <section aria-label="Help & Guide" className="space-y-2 rounded-[12px] border border-line bg-surface p-3">
      <header className="flex items-center gap-2">
        <Icon name="help" size={16} className="text-primary" />
        <b className="flex-1 text-[13.5px] text-ink">Help & Guide</b>
        <button type="button" aria-label="Close Help & Guide" onClick={onClose} className="rounded p-0.5 text-ink-3 hover:bg-subtle hover:text-ink">
          <Icon name="x" size={14} />
        </button>
      </header>
      <p className="text-[12px] text-ink-3">How to do things in WorkSuite, step by step. Ask “How do I…?” below, or pick a guide.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the guides" aria-label="Search the guides" className="h-8 w-full rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-primary" />
      {here.length ? (
        <>
          <div className="pt-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">Suggested here</div>
          <ul className="space-y-0.5">{here.map(row)}</ul>
        </>
      ) : null}
      {found && !found.length ? <p className="text-[12.5px] text-ink-3">No guide matches “{q.trim()}”.</p> : null}
      {rest.length ? (
        <>
          {!found ? <div className="pt-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3 uppercase">{here.length ? 'More guides' : 'Guides'}</div> : null}
          <ul className={cx('space-y-0.5', !found && 'max-h-[220px] overflow-y-auto scroll-thin')}>{rest.map(row)}</ul>
        </>
      ) : null}
      <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
        <Button size="sm" icon="help" onClick={() => onSupport('support')}>
          Contact Support
        </Button>
        <Button size="sm" variant="ghost" icon="alert" onClick={() => onSupport('issue')}>
          Report an Issue
        </Button>
      </div>
      <MyRequests className="border-t border-line pt-2" />
    </section>
  );
}

/** Contact Support and Report an Issue, D-11: ContactSupport.tsx. */
export { SupportDialog, MyRequests, type SupportKind } from './ContactSupport';
