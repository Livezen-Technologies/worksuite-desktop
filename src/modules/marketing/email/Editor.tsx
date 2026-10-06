import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { ApiError } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { Button, cx, Empty, IconButton, Modal, Spinner } from '../../../components/ui';
import {
  fetchCampaign,
  fetchContent,
  fetchImages,
  fetchMergeTags,
  fetchVersions,
  MK,
  restoreVersion,
  saveContent,
  saveTemplate,
  updateCampaign,
  uploadImage,
  type Block,
  type Campaign,
  type Content,
  type LibraryImage,
  type MergeTag,
} from '../api';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Mono, Notice, OptionalView, Panel, Planned, Tabs, TextArea, useAction } from '../parts';
import { campaignStatus } from '../lib/consent';
import { clockLabel, full, plural } from '../lib/format';
import { asBlocks, blocksToPlainText, imagesWithoutAlt, moveBlock, newBlock, patchBlock, removeBlock, safeUrl, textsOf, type BlockPatch, type BlockType } from '../lib/blocks';
import { MERGE_TAGS, missingRequired, tagsIn, tagText, unknownTags } from '../lib/merge';
import { Confirm, useCampaignCommands } from './Campaigns';
import { AudiencePicker, senderErrors, TopicField } from './NewCampaign';
import { BlockView } from './Templates';
import { TestSendModal } from './TestSend';

/**
 * DK07 · Campaign editor (W07; PDF p42, p55) — WF-06 steps 2–8, MKT-EDT-01..06, MKT-EML-03. The campaign has the
 * tab to itself: Setup (name, topic, audience, sender, subject) and Content — the blocks and the closed merge-tag
 * list on the left, the email at desktop or mobile width or as plain text in the middle, the chosen block's
 * properties on the right. Content saves itself 1.5 s after a change with the version it was read at (MKT-EDT-06,
 * partial): a save someone else got in first is reloaded, never overwritten. Past draft it is read-only.
 */

type Step = 'setup' | 'content';
type View = 'desktop' | 'mobile' | 'plain';
type FieldKey = 'html' | 'left' | 'right' | 'label' | 'url' | 'alt' | 'link';
interface Caret {
  block: string;
  field: FieldKey;
  start: number;
  end: number;
}

const PALETTE: Array<{ type: BlockType; label: string; icon: string }> = [
  { type: 'text', label: 'Text', icon: 'type' },
  { type: 'image', label: 'Image', icon: 'image' },
  { type: 'button', label: 'Button', icon: 'rounded' },
  { type: 'columns', label: 'Columns', icon: 'layout-side' },
  { type: 'divider', label: 'Divider', icon: 'minus' },
  { type: 'footer', label: 'Footer', icon: 'layout-strip' },
];

const VIEWS: Array<{ id: View; label: string; icon: string }> = [
  { id: 'desktop', label: 'Desktop', icon: 'monitor' },
  { id: 'mobile', label: 'Mobile', icon: 'mobile' },
  { id: 'plain', label: 'Plain text', icon: 'type' },
];

const WIDTHS: Array<{ value: 'full' | 'half' | 'auto'; label: string }> = [
  { value: 'full', label: 'Full width' },
  { value: 'half', label: 'Half width' },
  { value: 'auto', label: 'Its own size' },
];

const ALIGNS: Array<{ value: 'left' | 'center'; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
];

const LINK_ERROR = 'Use an https://, http:// or mailto: address, or one merge tag.';

const nameOf = (t: BlockType) => PALETTE.find((p) => p.type === t)?.label ?? t;
const braces = (tag: string) => `{{${tag}}}`;

/** Where a click on a merge tag writes when no field of the block had the cursor. */
function tagField(t: BlockType): FieldKey | null {
  switch (t) {
    case 'text':
    case 'footer':
      return 'html';
    case 'columns':
      return 'left';
    case 'button':
      return 'label';
    default:
      return null;
  }
}

function fieldValue(b: Block, f: FieldKey): string | null {
  const v = (b as unknown as Record<string, unknown>)[f];
  return typeof v === 'string' ? v : v === null ? '' : null;
}

const clockOf = (s: string | null) => clockLabel(s);

/** The server's merge-tag list, or this desktop's when the server does not list one. */
function useMergeTagList(): MergeTag[] {
  const org = useMarketingOrg();
  const q = useQuery({ queryKey: MK.mergeTags(org), queryFn: ({ signal }) => fetchMergeTags(org, signal), staleTime: 5 * 60_000 });
  return q.data ?? MERGE_TAGS;
}

export default function Editor({ id, step }: { id: number; step: Step }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const campaign = useQuery({ queryKey: MK.campaign(org, id), queryFn: ({ signal }) => fetchCampaign(id, signal) });
  // Always read afresh on opening: the editor starts from what the server has now, with its version.
  const content = useQuery({ queryKey: MK.content(org, id), queryFn: ({ signal }) => fetchContent(id, signal), refetchOnMount: 'always', refetchOnWindowFocus: false });
  const [generation, setGeneration] = useState(0);
  const reload = async (fresh?: Content) => {
    if (fresh) qc.setQueryData<Content>(MK.content(org, id), fresh);
    else await qc.refetchQueries({ queryKey: MK.content(org, id), exact: true });
    setGeneration((g) => g + 1);
  };
  return (
    <Loaded q={campaign} what="This campaign">
      {(c) => (
        <Loaded q={content} what="This campaign’s content">
          {(ct) => (content.isFetchedAfterMount ? <Workspace key={`${id}:${generation}`} campaign={c} content={ct} step={step} onReload={(fresh) => void reload(fresh)} /> : <Spinner />)}
        </Loaded>
      )}
    </Loaded>
  );
}

/** What this editor holds beyond React state: read and written by saves, never during render. */
interface Live {
  blocks: Block[];
  version: number;
  dirty: boolean;
  /** Replaced by a reload (a conflict, a restored version): saves nothing more. */
  retired: boolean;
  queue: Promise<unknown>;
}

type SaveState = { state: 'saved' | 'dirty' | 'saving' | 'failed'; at: string | null };

function Workspace({ campaign, content, step, onReload }: { campaign: Campaign; content: Content; step: Step; onReload: (fresh?: Content) => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const commands = useCampaignCommands();
  const tags = useMergeTagList();
  const readOnly = campaign.status !== 'draft';
  const [initial] = useState(() => asBlocks(content.blocks));
  const [blocks, setBlocks] = useState<Block[]>(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null);
  const [save, setSave] = useState<SaveState>({ state: 'saved', at: content.saved_at ?? campaign.content_saved_at });
  const [edits, setEdits] = useState(0);
  const [modal, setModal] = useState<'test' | 'history' | 'template' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [stranded, setStranded] = useState<string | null>(null);
  // Setup's form keeps its own changes until its Save; leaving with some unsaved asks first.
  const [setupDirty, setSetupDirty] = useState(false);
  const [unsavedSetup, setUnsavedSetup] = useState<string | null>(null);
  const live = useRef<Live>({ blocks: initial, version: content.version, dirty: false, retired: false, queue: Promise.resolve() });
  const base = `/marketing/campaigns/${campaign.id}`;

  /** Every change to the content goes through here. */
  const edit = (fn: (b: Block[]) => Block[]) => {
    if (readOnly) return;
    const s = live.current;
    s.blocks = fn(s.blocks);
    s.dirty = true;
    setBlocks(s.blocks);
    setSave((x) => ({ ...x, state: 'dirty' }));
    setEdits((n) => n + 1);
  };

  /** Saves what is unsaved, one save at a time. False when it could not (refused, or someone else saved first). */
  const persist = (): Promise<boolean> => {
    const s = live.current;
    const once = async (): Promise<boolean> => {
      if (s.retired) return false;
      if (!s.dirty) return true;
      const snapshot = s.blocks;
      const plain = blocksToPlainText(snapshot);
      s.dirty = false;
      setSave((x) => ({ ...x, state: 'saving' }));
      try {
        const r = await saveContent(campaign.id, { blocks: snapshot, plain_text: plain, version: s.version });
        s.version = r.version;
        qc.setQueryData<Content>(MK.content(org, campaign.id), { blocks: snapshot, plain_text: plain, version: r.version, saved_at: r.saved_at });
        void qc.invalidateQueries({ queryKey: MK.check(org, campaign.id) });
        setSave({ state: s.dirty ? 'dirty' : 'saved', at: r.saved_at });
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          s.retired = true;
          toast('error', 'Someone else saved this campaign’s content while you were editing. Their version is loaded now; your latest changes were not kept.');
          onReload();
          return false;
        }
        s.dirty = true;
        setSave((x) => ({ ...x, state: 'failed' }));
        toast('error', `Not saved: ${errorMessage(e)}`);
        return false;
      }
    };
    const p = s.queue.then(once);
    s.queue = p.catch(() => undefined);
    return p;
  };

  // Autosave once the edits have stopped for 1.5 s.
  const onQuiet = useEffectEvent(() => {
    void persist();
  });
  useEffect(() => {
    if (!edits) return;
    const t = setTimeout(() => onQuiet(), 1500);
    return () => clearTimeout(t);
  }, [edits]);

  // Leaving with changes not yet saved: they are saved on the way out (fire and forget).
  useEffect(() => {
    const s = live.current;
    const id = campaign.id;
    return () => {
      void s.queue
        .then(async () => {
          if (!s.dirty || s.retired) return;
          const plain = blocksToPlainText(s.blocks);
          const r = await saveContent(id, { blocks: s.blocks, plain_text: plain, version: s.version });
          s.dirty = false;
          s.version = r.version;
          qc.setQueryData<Content>(MK.content(org, id), { blocks: s.blocks, plain_text: plain, version: r.version, saved_at: r.saved_at });
        })
        .catch(() => undefined);
    };
  }, [campaign.id, org, qc]);

  /** To another screen, after the content is saved; a save that fails, or Setup changes not saved, ask first. */
  const leave = async (route: string) => {
    if (readOnly) return go(route);
    if (setupDirty) return setUnsavedSetup(route);
    await proceed(route);
  };

  const proceed = async (route: string) => {
    setLeaving(true);
    const ok = await persist();
    setLeaving(false);
    if (ok) go(route);
    else if (!live.current.retired) setStranded(route);
  };

  const retire = (fresh: Content) => {
    live.current.retired = true;
    onReload(fresh);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-stretch gap-x-4 border-b border-line bg-surface px-3">
        <div className="flex min-w-0 flex-1 basis-[240px] items-center gap-2 py-2">
          <IconButton icon="chevron-left" label="Back to campaigns" onClick={() => void leave('/marketing/campaigns')} />
          <div className="min-w-0">
            <div className="truncate text-[11.5px] text-ink-3">
              Email campaign · {campaignStatus(campaign.status).label} ·{' '}
              {readOnly ? 'read-only' : save.state === 'saving' ? 'saving…' : save.state === 'dirty' ? 'unsaved changes' : save.state === 'failed' ? 'not saved' : save.at ? `autosaved ${clockOf(save.at)}` : 'nothing saved yet'}
            </div>
            <h1 className="truncate text-[15px] leading-tight font-bold text-ink">{campaign.name}</h1>
          </div>
        </div>
        <Tabs
          label="Campaign steps"
          value={step as Step | 'review'}
          onChange={(v) => (v === 'review' ? void leave(`${base}/review`) : go(`${base}/${v}`))}
          tabs={[
            { id: 'setup', label: 'Setup' },
            { id: 'content', label: 'Content' },
            { id: 'review', label: 'Review & send' },
          ]}
          className="-mb-px self-end pt-2"
        />
        <div className="flex flex-1 basis-[240px] flex-wrap items-center justify-end gap-2 py-2">
          <Button size="sm" variant="ghost" icon="history" onClick={() => setModal('history')}>
            History
          </Button>
          <Button size="sm" variant="ghost" icon="bookmark" disabled={!blocks.length} onClick={() => setModal('template')}>
            Save as template
          </Button>
          <Button icon="send" disabled={readOnly} onClick={() => setModal('test')}>
            Send test
          </Button>
          <Button variant="primary" icon="chevron-right" loading={leaving} onClick={() => void leave(`${base}/review`)}>
            Review
          </Button>
        </div>
      </header>
      {readOnly ? (
        <div className="shrink-0 border-b border-line bg-surface px-4 py-2.5">
          <Notice
            tone="warning"
            icon="lock"
            action={
              <Button size="sm" icon="copy" loading={commands.busy !== null} onClick={() => void commands.duplicate(campaign)}>
                Duplicate
              </Button>
            }
          >
            This campaign is {campaignStatus(campaign.status).label.toLowerCase()}; its content can’t change. Duplicate it to send a new version.
          </Notice>
        </div>
      ) : null}
      <SetupStep campaign={campaign} readOnly={readOnly} hidden={step !== 'setup'} onDirty={setSetupDirty} />
      <ContentStep hidden={step !== 'content'} blocks={blocks} selected={selected} onSelect={setSelected} edit={edit} readOnly={readOnly} tags={tags} />
      {modal === 'test' ? <TestSendModal campaign={campaign} beforeSend={persist} onClose={() => setModal(null)} /> : null}
      {modal === 'history' ? <HistoryModal campaign={campaign} readOnly={readOnly} flush={persist} onRestored={retire} onClose={() => setModal(null)} /> : null}
      {modal === 'template' ? <SaveTemplateModal name={campaign.name} blocks={blocks} onClose={() => setModal(null)} /> : null}
      {stranded ? (
        <Confirm
          title="Leave without saving?"
          action="Leave anyway"
          danger
          onClose={() => setStranded(null)}
          onYes={() => {
            live.current.retired = true;
            const to = stranded;
            setStranded(null);
            go(to);
          }}
        >
          The latest changes to the content could not be saved. Stay to try again, or leave and lose them.
        </Confirm>
      ) : null}
      {unsavedSetup ? (
        <Confirm
          title="Setup isn’t saved"
          action="Leave without them"
          danger
          onClose={() => {
            setUnsavedSetup(null);
            go(`${base}/setup`);
          }}
          onYes={() => {
            const to = unsavedSetup;
            setUnsavedSetup(null);
            void proceed(to);
          }}
        >
          The name, audience, sender or subject on Setup has changes that aren’t saved. Go back to save them, or leave
          without them.
        </Confirm>
      ) : null}
      {commands.dialog}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------------ */

interface SetupForm {
  name: string;
  topic_id: number | null;
  list_ids: number[];
  segment_ids: number[];
  from_name: string;
  from_email: string;
  reply_to: string;
  subject: string;
  preview_text: string;
}

const formOf = (c: Campaign): SetupForm => ({
  name: c.name,
  topic_id: c.topic?.id ?? null,
  list_ids: c.lists.map((l) => l.id),
  segment_ids: c.segments.map((s) => s.id),
  from_name: c.from_name ?? '',
  from_email: c.from_email ?? '',
  reply_to: c.reply_to ?? '',
  subject: c.subject ?? '',
  preview_text: c.preview_text ?? '',
});

const keyOf = (f: SetupForm) => JSON.stringify({ ...f, list_ids: [...f.list_ids].sort(), segment_ids: [...f.segment_ids].sort() });

function SetupStep({ campaign, readOnly, hidden, onDirty }: { campaign: Campaign; readOnly: boolean; hidden: boolean; onDirty: (dirty: boolean) => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const [f, setF] = useState(() => formOf(campaign));
  const [tried, setTried] = useState(false);
  const [busy, run] = useAction();
  const set = (p: Partial<SetupForm>) => setF((x) => ({ ...x, ...p }));
  const errs = senderErrors(f);
  const nameMissing = !f.name.trim();
  const dirty = keyOf(f) !== keyOf(formOf(campaign));
  useEffect(() => onDirty(dirty && !readOnly), [dirty, readOnly, onDirty]);

  const submit = () => {
    setTried(true);
    if (nameMissing || errs.from_email || errs.reply_to) return;
    void run(
      'save',
      async () => {
        const c = await updateCampaign(campaign.id, {
          name: f.name.trim(),
          topic_id: f.topic_id,
          list_ids: f.list_ids,
          segment_ids: f.segment_ids,
          from_name: f.from_name.trim() || null,
          from_email: f.from_email.trim() || null,
          reply_to: f.reply_to.trim() || null,
          subject: f.subject.trim() || null,
          preview_text: f.preview_text.trim() || null,
        });
        qc.setQueryData<Campaign>(MK.campaign(org, campaign.id), c);
        setF(formOf(c));
        setTried(false);
        void qc.invalidateQueries({ queryKey: ['marketing', 'campaigns'] });
        void qc.invalidateQueries({ queryKey: MK.check(org, campaign.id) });
        void qc.invalidateQueries({ queryKey: MK.audience(org, campaign.id) });
      },
      'Setup saved.',
    );
  };

  return (
    <div hidden={hidden} className="min-h-0 flex-1 overflow-y-auto bg-ground p-5 scroll-thin">
      <form
        noValidate
        className="mx-auto flex w-full max-w-[1000px] flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Campaign" bodyClassName="flex flex-col gap-3">
            <Field label="Name" error={tried && nameMissing ? 'Give the campaign a name.' : null}>
              <Input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={160} disabled={readOnly} />
            </Field>
            <TopicField value={f.topic_id} onChange={(topic_id) => set({ topic_id })} disabled={readOnly} />
          </Panel>
          <Panel title="Sender" sub="Who the email is from, and where replies go." bodyClassName="flex flex-col gap-3">
            <Field label="From name">
              <Input value={f.from_name} onChange={(e) => set({ from_name: e.target.value })} maxLength={120} disabled={readOnly} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From address" error={tried ? errs.from_email : null}>
                <Input type="email" value={f.from_email} onChange={(e) => set({ from_email: e.target.value })} className="font-mono" disabled={readOnly} />
              </Field>
              <Field label="Reply-to" error={tried ? errs.reply_to : null}>
                <Input type="email" value={f.reply_to} onChange={(e) => set({ reply_to: e.target.value })} className="font-mono" disabled={readOnly} />
              </Field>
            </div>
          </Panel>
        </div>
        <Panel title="Subject" bodyClassName="flex flex-col gap-3">
          <Field label="Subject" hint={`${f.subject.length} characters · merge tags may be used here too`}>
            <Input value={f.subject} onChange={(e) => set({ subject: e.target.value })} maxLength={200} disabled={readOnly} />
          </Field>
          <Field label="Preview text" hint="The line most inboxes show after the subject.">
            <Input value={f.preview_text} onChange={(e) => set({ preview_text: e.target.value })} maxLength={200} disabled={readOnly} />
          </Field>
        </Panel>
        <Panel title="Audience" sub="Duplicates are removed, and anyone suppressed, unsubscribed or not subscribed to the topic is left out; Review & send shows the count.">
          <AudiencePicker listIds={f.list_ids} segmentIds={f.segment_ids} onChange={set} disabled={readOnly} />
        </Panel>
        {readOnly ? null : (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 rounded-[12px] border border-line bg-surface px-4 py-2.5">
            <span className="text-[12px] text-ink-3" aria-live="polite">
              {tried && (nameMissing || errs.from_email || errs.reply_to) ? 'Fix the marked fields first.' : dirty ? 'Unsaved changes' : 'All saved'}
            </span>
            <Button type="submit" variant="primary" icon="check" loading={busy === 'save'} disabled={!dirty}>
              Save
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Content
 * ------------------------------------------------------------------------ */

function ContentStep({ hidden, blocks, selected, onSelect, edit, readOnly, tags }: { hidden: boolean; blocks: Block[]; selected: string | null; onSelect: (id: string | null) => void; edit: (fn: (b: Block[]) => Block[]) => void; readOnly: boolean; tags: MergeTag[] }) {
  const uid = useId();
  const [view, setView] = useState<View>('desktop');
  const caret = useRef<Caret | null>(null);
  const known = useMemo(() => new Set(tags.map((t) => t.tag)), [tags]);
  const issues = useMemo(() => ({ unknown: unknownTags(textsOf(blocks), tags), missing: missingRequired(blocks, tags), noAlt: imagesWithoutAlt(blocks) }), [blocks, tags]);
  const plain = useMemo(() => (view === 'plain' ? blocksToPlainText(blocks) : ''), [blocks, view]);
  const sel = blocks.find((b) => b.id === selected) ?? null;
  const fieldId = (block: string, f: FieldKey) => `${uid}-${block}-${f}`;

  const add = (type: BlockType) => {
    const footer = blocks.find((x) => x.type === 'footer');
    if (type === 'footer' && footer) {
      onSelect(footer.id);
      toast('info', 'This email already has a footer; it is selected.');
      return;
    }
    const b = newBlock(type);
    edit((bs) => {
      const i = bs.findIndex((x) => x.id === selected);
      const foot = bs.findIndex((x) => x.type === 'footer');
      // After the chosen block; with none chosen (or the footer), just above the footer.
      const at = type === 'footer' ? bs.length : i >= 0 && bs[i]!.type !== 'footer' ? i + 1 : foot >= 0 ? foot : bs.length;
      return [...bs.slice(0, at), b, ...bs.slice(at)];
    });
    onSelect(b.id);
  };

  const insertTag = (t: MergeTag) => {
    if (!sel) {
      toast('info', 'Choose a text block on the canvas first; the tag goes in where its cursor is.');
      return;
    }
    const c = caret.current?.block === sel.id ? caret.current : null;
    const field = c?.field ?? tagField(sel.type);
    const now = field ? fieldValue(sel, field) : null;
    if (!field || now === null) {
      toast('info', 'Merge tags go into text, button, columns and footer blocks.');
      return;
    }
    const token = tagText(t);
    let at = now.length;
    let end = now.length;
    if (c) {
      at = Math.min(c.start, now.length);
      end = Math.min(c.end, now.length);
    } else {
      // At the end of the last paragraph rather than after it.
      const m = /<\/(p|h[1-3]|li)>\s*$/i.exec(now);
      if (m) at = end = m.index;
    }
    const pos = at + token.length;
    edit((bs) => patchBlock(bs, sel.id, { [field]: now.slice(0, at) + token + now.slice(end) } as BlockPatch));
    caret.current = { block: sel.id, field, start: pos, end: pos };
    requestAnimationFrame(() => {
      const el = document.getElementById(fieldId(sel.id, field));
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const move = (id: string, dir: 'up' | 'down') => edit((bs) => moveBlock(bs, id, dir));
  const drop = (id: string) => {
    const i = blocks.findIndex((b) => b.id === id);
    edit((bs) => removeBlock(bs, id));
    onSelect(blocks[i + 1]?.id ?? blocks[i - 1]?.id ?? null);
  };

  return (
    <div hidden={hidden} className="min-h-0 flex-1 overflow-y-auto lg:flex lg:overflow-hidden">
      {/* Palette */}
      <aside aria-label="Blocks and merge tags" className="flex shrink-0 flex-col gap-4 border-b border-line bg-surface p-3 scroll-thin lg:w-[212px] lg:overflow-y-auto lg:border-r lg:border-b-0">
        <section aria-labelledby={`${uid}-blocks`}>
          <h2 id={`${uid}-blocks`} className="mb-2 text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">
            Blocks
          </h2>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-2">
            {PALETTE.map((p) => (
              <button
                key={p.type}
                type="button"
                disabled={readOnly}
                onClick={() => add(p.type)}
                className="flex h-[54px] flex-col items-center justify-center gap-1 rounded-[8px] border border-line bg-surface text-[11.5px] font-semibold text-ink-2 hover:border-primary/40 hover:text-primary disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink-2"
              >
                <Icon name={p.icon} size={17} />
                {p.label}
              </button>
            ))}
          </div>
        </section>
        <section aria-labelledby={`${uid}-tags`}>
          <h2 id={`${uid}-tags`} className="text-[10.5px] font-bold tracking-[.6px] text-ink-3 uppercase">
            Merge tags
          </h2>
          <p className="mt-1 mb-1.5 text-[11.5px] leading-snug text-ink-3">Closed list — unknown tags block sending.</p>
          <ul className="flex flex-col">
            {tags.map((t) => {
              const fb = t.fallback ? tagsIn(tagText(t))[0]?.fallback : null;
              return (
                <li key={t.tag} className="border-b border-line last:border-b-0">
                  <button type="button" disabled={readOnly} onClick={() => insertTag(t)} aria-label={`Insert ${t.label}: ${tagText(t)}`} className="flex w-full items-baseline justify-between gap-2 py-1.5 text-left disabled:opacity-60 enabled:hover:bg-subtle">
                    <Mono className="min-w-0 truncate text-[11.5px] text-primary">{tagText(t)}</Mono>
                    {t.required ? <span className="shrink-0 text-[10.5px] text-ink-3">required</span> : fb ? <span className="shrink-0 text-[10.5px] text-ink-3">fallback “{fb}”</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </aside>

      {/* Canvas */}
      <section aria-label="Email" className="flex min-w-0 flex-col bg-ground lg:flex-1">
        <div className="flex shrink-0 justify-center px-4 py-2.5">
          <div role="group" aria-label="Preview" className="inline-flex rounded-[8px] border border-line bg-surface p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={view === v.id}
                onClick={() => setView(v.id)}
                className={cx('inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-semibold', view === v.id ? 'bg-selection text-primary' : 'text-ink-2 hover:bg-subtle')}
              >
                <Icon name={v.icon} size={14} />
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div
          className="min-h-0 flex-1 px-4 pb-10 scroll-thin lg:overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) onSelect(null);
          }}
        >
          <div className="mx-auto mb-3 flex max-w-[600px] flex-col gap-2">
            {issues.unknown.length ? (
              <Notice tone="danger">
                Not in the merge-tag list:{' '}
                {issues.unknown.map((t) => (
                  <Mono key={t} className="mr-1">
                    {braces(t)}
                  </Mono>
                ))}
                — sending is blocked until they are fixed.
              </Notice>
            ) : null}
            {issues.missing.length ? (
              <Notice tone="danger">
                The email must carry{' '}
                {issues.missing.map((t) => (
                  <Mono key={t} className="mr-1">
                    {braces(t)}
                  </Mono>
                ))}
                — put {issues.missing.length === 1 ? 'it' : 'them'} in the footer.
              </Notice>
            ) : null}
            {issues.noAlt.length ? (
              <Notice
                tone="warning"
                action={
                  <Button size="sm" variant="ghost" onClick={() => onSelect(issues.noAlt[0]!.id)}>
                    Show
                  </Button>
                }
              >
                {plural(issues.noAlt.length, 'image')} without alt text.
              </Notice>
            ) : null}
          </div>
          {view === 'plain' ? (
            <div className="mx-auto flex max-w-[600px] flex-col gap-2">
              <pre aria-label="Plain-text version" className="min-h-[200px] rounded-[10px] border border-line bg-surface p-5 font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                {plain || 'Nothing to show yet.'}
              </pre>
              <p className="text-[11.5px] text-ink-3">Sent alongside the HTML for inboxes that show only text. The merge tags are filled in for each recipient.</p>
            </div>
          ) : (
            <div className="mx-auto max-w-full overflow-hidden rounded-[10px] border border-line bg-surface shadow-[0_1px_3px_rgb(15_23_42/.06)] dark:shadow-none" style={{ width: view === 'mobile' ? 360 : 600 }}>
              {blocks.length === 0 ? (
                <Empty icon="panel-top" title="No blocks yet" hint={readOnly ? 'This campaign has no content.' : 'Add one from Blocks on the left: text, an image, a button, columns, a divider and the footer.'} />
              ) : (
                blocks.map((b, i) => (
                  <CanvasBlock
                    key={b.id}
                    block={b}
                    index={i}
                    total={blocks.length}
                    selected={b.id === selected}
                    readOnly={readOnly}
                    mobile={view === 'mobile'}
                    known={known}
                    onSelect={() => onSelect(b.id)}
                    onMove={(dir) => move(b.id, dir)}
                    onDelete={() => drop(b.id)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </section>

      {/* Properties */}
      <aside aria-label="Block properties" className="flex shrink-0 flex-col gap-3 border-t border-line bg-surface p-4 scroll-thin lg:w-[280px] lg:overflow-y-auto lg:border-t-0 lg:border-l">
        {sel ? (
          <>
            <h2 className="text-[14px] font-bold text-ink">{nameOf(sel.type)} block</h2>
            <BlockProps
              key={sel.id}
              block={sel}
              readOnly={readOnly}
              tags={tags}
              fieldId={(f) => fieldId(sel.id, f)}
              onPatch={(p) => edit((bs) => patchBlock(bs, sel.id, p))}
              onCaret={(c) => {
                caret.current = c;
              }}
            />
          </>
        ) : (
          <p className="text-[12.5px] text-ink-3">Choose a block on the email to change it.</p>
        )}
        <Notice className="mt-1">Images are served from the public images library so they load in every inbox without sign-in.</Notice>
      </aside>
    </div>
  );
}

function CanvasBlock({
  block,
  index,
  total,
  selected,
  readOnly,
  mobile,
  known,
  onSelect,
  onMove,
  onDelete,
}: {
  block: Block;
  index: number;
  total: number;
  selected: boolean;
  readOnly: boolean;
  mobile: boolean;
  known: ReadonlySet<string>;
  onSelect: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onDelete: () => void;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    } else if (!readOnly && e.key === 'Delete' && selected) {
      e.preventDefault();
      onDelete();
    } else if (!readOnly && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      onMove(e.key === 'ArrowUp' ? 'up' : 'down');
    }
  };
  return (
    <div className="group relative">
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${nameOf(block.type)} block, ${index + 1} of ${total}`}
        onClick={onSelect}
        onKeyDown={onKey}
        // Links in the email are shown, not followed.
        onClickCapture={(e) => {
          if (e.target instanceof Element && e.target.closest('a')) e.preventDefault();
        }}
        className={cx('relative cursor-pointer outline-none', selected ? 'z-[1] ring-2 ring-primary ring-inset' : 'hover:ring-1 hover:ring-primary/40 hover:ring-inset focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset')}
      >
        <BlockView block={block} mobile={mobile} known={known} />
      </div>
      {selected && !readOnly ? (
        <div className="absolute top-1 right-1 z-[2] flex gap-0.5 rounded-[8px] border border-line bg-surface p-0.5 shadow-sm">
          <IconButton icon="arrow-up" label="Move up" size={15} disabled={index === 0} onClick={() => onMove('up')} />
          <IconButton icon="arrow-down" label="Move down" size={15} disabled={index === total - 1} onClick={() => onMove('down')} />
          <IconButton icon="trash" label="Delete block" size={15} onClick={onDelete} />
        </div>
      ) : null}
    </div>
  );
}

/** Unknown tags in one block, said where the block is edited. */
function TagNote({ texts, tags }: { texts: string[]; tags: MergeTag[] }) {
  const unknown = unknownTags(texts, tags);
  if (!unknown.length) return null;
  return (
    <p role="status" className="flex items-start gap-1.5 text-[11.5px] text-danger">
      <Icon name="alert" size={13} className="mt-px shrink-0" />
      <span>
        Not in the merge-tag list: <Mono>{unknown.map(braces).join(' ')}</Mono>
      </span>
    </p>
  );
}

function Warn({ children }: { children: string }) {
  return (
    <p role="status" className="-mt-1.5 flex items-start gap-1.5 text-[11.5px] text-warning-ink dark:text-warning">
      <Icon name="warning" size={13} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function BlockProps({ block: b, readOnly, tags, fieldId, onPatch, onCaret }: { block: Block; readOnly: boolean; tags: MergeTag[]; fieldId: (f: FieldKey) => string; onPatch: (p: BlockPatch) => void; onCaret: (c: Caret) => void }) {
  /** The field remembers where its cursor was, for a merge tag clicked next. */
  const track = (field: FieldKey) => ({
    id: fieldId(field),
    readOnly,
    onSelect: (e: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => onCaret({ block: b.id, field, start: e.currentTarget.selectionStart ?? 0, end: e.currentTarget.selectionEnd ?? 0 }),
  });
  const html = 'Paragraphs, headings (h1–h3), bold, italic, underline, links and lists, as HTML. Anything else is removed.';
  switch (b.type) {
    case 'text':
      return (
        <>
          <Field label="Text" hint={html}>
            <TextArea {...track('html')} value={b.html} rows={12} spellCheck onChange={(e) => onPatch({ html: e.target.value })} className="font-mono leading-relaxed" />
          </Field>
          <TagNote texts={[b.html]} tags={tags} />
        </>
      );
    case 'footer': {
      const missing = missingRequired([b], tags);
      return (
        <>
          <Field label="Footer" hint="The postal address, the preference centre and the unsubscribe link belong here.">
            <TextArea {...track('html')} value={b.html} rows={8} onChange={(e) => onPatch({ html: e.target.value })} className="font-mono leading-relaxed" />
          </Field>
          {missing.length ? (
            <Notice tone="danger">
              The footer must carry <Mono>{missing.map(braces).join(' ')}</Mono>: sending is blocked without {missing.length === 1 ? 'it' : 'them'}.
            </Notice>
          ) : null}
          <TagNote texts={[b.html]} tags={tags} />
        </>
      );
    }
    case 'columns':
      return (
        <>
          <Field label="Left column" hint={html}>
            <TextArea {...track('left')} value={b.left} rows={7} onChange={(e) => onPatch({ left: e.target.value })} className="font-mono leading-relaxed" />
          </Field>
          <Field label="Right column">
            <TextArea {...track('right')} value={b.right} rows={7} onChange={(e) => onPatch({ right: e.target.value })} className="font-mono leading-relaxed" />
          </Field>
          <p className="text-[11.5px] text-ink-3">On a phone the right column goes under the left.</p>
          <TagNote texts={[b.left, b.right]} tags={tags} />
        </>
      );
    case 'image':
      return (
        <>
          <ImagePicker value={b.src} readOnly={readOnly} onPick={(img) => onPatch({ src: img.url })} />
          <Field label="Alt text">
            <Input {...track('alt')} value={b.alt} maxLength={200} onChange={(e) => onPatch({ alt: e.target.value })} placeholder="What the picture shows" aria-invalid={!b.alt.trim() || undefined} />
          </Field>
          {!b.alt.trim() ? <Warn>Alt text is required — screen readers and blocked images</Warn> : null}
          <Field label="Link" hint="Where a click on the picture goes; optional." error={b.link && !safeUrl(b.link) ? LINK_ERROR : null}>
            <Input {...track('link')} value={b.link ?? ''} onChange={(e) => onPatch({ link: e.target.value === '' ? null : e.target.value })} placeholder="https://" className="font-mono" />
          </Field>
          <Field label="Width">
            <Select value={b.width} onValueChange={(width) => onPatch({ width })} options={WIDTHS} aria-label="Width" disabled={readOnly} />
          </Field>
        </>
      );
    case 'button':
      return (
        <>
          <Field label="Label">
            <Input {...track('label')} value={b.label} maxLength={60} onChange={(e) => onPatch({ label: e.target.value })} />
          </Field>
          <Field label="Link" error={b.url.trim() && !safeUrl(b.url) ? LINK_ERROR : null}>
            <Input {...track('url')} value={b.url} onChange={(e) => onPatch({ url: e.target.value })} placeholder="https://" className="font-mono" />
          </Field>
          {!b.url.trim() ? <Warn>A button needs the address it opens.</Warn> : null}
          <Field label="Align">
            <Select value={b.align} onValueChange={(align) => onPatch({ align })} options={ALIGNS} aria-label="Align" disabled={readOnly} />
          </Field>
          <TagNote texts={[b.label, b.url]} tags={tags} />
        </>
      );
    case 'divider':
      return <p className="text-[12.5px] text-ink-3">A thin line between blocks; there is nothing to set.</p>;
  }
}

/** The public images library (MKT-EDT-03): pick a picture, or upload one to it. */
function ImagePicker({ value, readOnly, onPick }: { value: string | null; readOnly: boolean; onPick: (img: LibraryImage) => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const images = useQuery({ queryKey: MK.images(org), queryFn: ({ signal }) => fetchImages(org, signal), staleTime: 60_000 });
  const [uploading, setUploading] = useState(false);
  const current = images.data?.find((i) => i.url === value) ?? null;

  const upload = async (f: File) => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
      toast('error', 'Use a PNG, JPEG, GIF or WebP picture.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast('error', 'That picture is over 5 MB; inboxes load smaller ones far faster.');
      return;
    }
    setUploading(true);
    try {
      const img = await uploadImage(org, f);
      void qc.invalidateQueries({ queryKey: MK.images(org) });
      onPick(img);
      toast('success', `${img.name} is in the public images library.`);
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink-2">Image</span>
        <Button size="sm" icon="upload" loading={uploading} disabled={readOnly} onClick={() => file.current?.click()}>
          Upload
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          aria-label="Upload a picture to the public images library"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
      </div>
      <div className="truncate rounded-[8px] border border-line bg-subtle px-3 py-1.5 font-mono text-[12px] text-ink-2" title={value ?? undefined}>
        {current?.name ?? (value ? value.split('/').pop() : 'No picture chosen')}
      </div>
      <Loaded q={images} what="The public images library">
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-[12px] text-ink-3">The library has no pictures yet. Upload one.</p>
          ) : (
            <div role="group" aria-label="Public images library" className="grid max-h-[210px] grid-cols-3 gap-1.5 overflow-y-auto scroll-thin">
              {rows.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  aria-pressed={img.url === value}
                  aria-label={img.name}
                  title={img.name}
                  disabled={readOnly}
                  onClick={() => onPick(img)}
                  className={cx('aspect-square overflow-hidden rounded-[6px] border bg-subtle', img.url === value ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:border-primary/40')}
                >
                  <img src={img.url} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )
        }
      </Loaded>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * History and templates
 * ------------------------------------------------------------------------ */

function HistoryModal({ campaign, readOnly, flush, onRestored, onClose }: { campaign: Campaign; readOnly: boolean; flush: () => Promise<boolean>; onRestored: (c: Content) => void; onClose: () => void }) {
  const org = useMarketingOrg();
  const titleId = useId();
  const versions = useQuery({ queryKey: MK.versions(org, campaign.id), queryFn: ({ signal }) => fetchVersions(campaign.id, signal) });
  const [busy, run] = useAction();
  const restore = (v: number) =>
    void run(`restore:${v}`, async () => {
      if (!(await flush())) return;
      const r = await restoreVersion(campaign.id, v);
      if (!r.offered) {
        toast('info', r.message);
        return;
      }
      toast('success', `Version ${v} restored.`);
      onRestored(r.data);
      onClose();
    });
  return (
    <Modal title="Version history" labelledBy={titleId} onClose={onClose} width={520}>
      <OptionalView
        q={versions}
        what="Version history"
        notOffered={
          <div className="flex flex-col items-center gap-1 pt-2">
            <Planned />
            <Empty icon="history" title="Version history is planned" hint="This WorkSuite server keeps the latest content only. Every change is still autosaved, and a save someone else got in first is never overwritten." />
          </div>
        }
      >
        {(rows) =>
          rows.length === 0 ? (
            <Empty icon="history" title="No earlier versions yet" hint="A version is kept each time the content is saved." />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {rows.map((v) => (
                <li key={v.version} className="flex items-center gap-3 py-2">
                  <Mono className="w-10 shrink-0 text-[12px] text-ink-3">v{v.version}</Mono>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {full(v.saved_at)}
                    {v.by ? <span className="text-ink-3"> · {v.by}</span> : null}
                  </span>
                  {readOnly ? null : (
                    <Button size="sm" icon="undo" loading={busy === `restore:${v.version}`} disabled={busy !== null} onClick={() => restore(v.version)}>
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </OptionalView>
    </Modal>
  );
}

function SaveTemplateModal({ name, blocks, onClose }: { name: string; blocks: Block[]; onClose: () => void }) {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const titleId = useId();
  const [n, setN] = useState(name);
  const [busy, run] = useAction();
  const save = () => {
    if (!n.trim()) return;
    void run(
      'save',
      async () => {
        await saveTemplate(org, null, { name: n.trim(), blocks });
        void qc.invalidateQueries({ queryKey: MK.templates(org) });
        onClose();
      },
      `Saved “${n.trim()}” as a template.`,
    );
  };
  return (
    <Modal
      title="Save as template"
      labelledBy={titleId}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="bookmark" loading={busy === 'save'} disabled={!n.trim()} onClick={save}>
            Save template
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-[12.5px] text-ink-2">The layout and words of these {plural(blocks.length, 'block')} become a template anyone in the company can start a campaign from. This campaign is not changed.</p>
        <Field label="Template name">
          <Input value={n} onChange={(e) => setN(e.target.value)} autoFocus maxLength={120} />
        </Field>
      </form>
    </Modal>
  );
}
