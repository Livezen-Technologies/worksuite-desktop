/**
 * W02 / D02 Create post (SRS p.43; WF-03, WF-17): choose accounts, write once, adapt per network, check, schedule.
 * Covers SMM-CMP-001..015, SMM-MED-001..004, SMM-SCH-001, SMM-APR-002/007, SMM-DSK-003/004/005, AC-04, AC-05, AC-13,
 * AC-18. A post's own page (`/social-media/posts/<id>`) opens here too: editable until it starts publishing, then
 * read-only with each target's result.
 *
 * Nothing typed is lost: the working copy is kept on this computer as it changes and offered back on open; it goes to
 * the server every 10 s while changed and when the window loses focus. A newer version saved by someone else is a
 * choice (theirs or mine), never a silent overwrite (CMP-011).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Modal, Spinner } from '../../../components/ui';
import { ApiError } from '../../../core/api';
import { errorMessage } from '../../../core/bridge';
import { useTab } from '../../../core/tab-context';
import { toast } from '../../../core/toasts';
import {
  dataOf,
  NOT_OFFERED,
  rowsOf,
  SK,
  socialApi,
  useAccounts,
  useBrands,
  useCampaigns,
  useInvalidate,
  useModuleStatus,
  usePost,
  type Person,
  type Post,
  type PostEvent,
  type PostMedia,
  type TargetOptions,
} from '../api';
import { canPublishOn, useSocialAccess, usableAccounts } from '../access';
import { networkInfo, type Network } from '../lib/networks';
import type { PostStatus } from '../lib/status';
import { splitIntoThread } from '../lib/text';
import { currentZone, fromLocalInput } from '../lib/time';
import type { IssueFix } from '../lib/validate';
import { ConfirmButton, Notice, PageBody, PageHeader, Panel, PostStatusPill, Refused } from '../parts';
import { PostTo } from './AccountPicker';
import { AiAssist, SuggestionCard, type AiRequest, type AiSuggestion } from './AiAssist';
import { Checks } from './Checks';
import { Details, LABELS_INPUT_ID, LINK_INPUT_ID } from './Details';
import { Editor, type Tab } from './Editor';
import { MediaDialog, MediaStrip, useDrop, useMediaSources } from './MediaStrip';
import { Preview } from './Preview';
import { PostResult } from './PostResult';
import {
  capsFor,
  checkDraft,
  chosenAccounts,
  clearLocalCopy,
  cropRatioFor,
  draftBrand,
  draftFromPost,
  draftFromQuery,
  draftNetworks,
  editVariantMedia,
  editVariantText,
  loadLocalCopy,
  mediaFor,
  moveLinksToComment,
  removeNetwork,
  resetVariant,
  saveLocalCopy,
  setVariant,
  taggedLink,
  textFor,
  toPostInput,
  type ComposerDraft,
  type LocalCopy,
} from './state';
import { WhenCard, type PrimaryKind } from './WhenCard';

const READ_ONLY: PostStatus[] = ['publishing', 'published', 'partly_published', 'failed'];
const AUTOSAVE_MS = 10_000;

export default function Composer({ postId }: { postId: number | null }) {
  const postQ = usePost(postId);
  if (!postId) return <ComposerForm post={null} events={[]} postId={null} />;
  if (postQ.isLoading) return <Frame title="Edit post" body={<Spinner />} />;
  if (postQ.error) return <Frame title="Edit post" body={<Refused error={postQ.error} onRetry={() => void postQ.refetch()} />} />;
  const data = dataOf(postQ.data);
  // A server without the module: the composer still works on this computer (local copy for this post id).
  return <ComposerForm post={data?.post ?? null} events={data?.events ?? []} postId={postId} />;
}

function Frame({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader crumb="Compose" title={title} scope={false} />
      <PageBody>{body}</PageBody>
    </div>
  );
}

function ComposerForm({ post, events, postId }: { post: Post | null; events: PostEvent[]; postId: number | null }) {
  const { query, go } = useTab();
  const invalidate = useInvalidate();
  const status = dataOf(useModuleStatus().data);
  const access = useSocialAccess(status?.permissions);
  const accountsQ = useAccounts();
  const accountsOffered = !!accountsQ.data?.offered;
  const accounts = rowsOf(accountsQ.data);
  const usable = usableAccounts(accounts, access);
  const brands = rowsOf(useBrands().data);
  const campaignsQ = useCampaigns();
  const campaigns = rowsOf(campaignsQ.data);
  const zone = currentZone();

  const readOnly = !!post && READ_ONLY.includes(post.status);
  const title = readOnly ? 'Post' : postId ? 'Edit post' : 'Create post';

  const [draft, setDraft] = useState<ComposerDraft>(() => (post ? draftFromPost(post) : draftFromQuery(query)));
  const [rev, setRev] = useState(0);
  const [savedRev, setSavedRev] = useState(0);
  const [gen, setGen] = useState(0);
  const [savedId, setSavedId] = useState<number | null>(post?.id ?? null);
  const [version, setVersion] = useState<number | undefined>(post?.version);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [serverSaves, setServerSaves] = useState(true);
  const [conflict, setConflict] = useState<{ current: Post; by: Person | null } | null>(null);
  const [recover, setRecover] = useState<LocalCopy | null>(null);
  const [tabPick, setTab] = useState<Tab>('original');
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [editing, setEditing] = useState<{ scope: Network | null; index: number } | null>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const dirty = rev !== savedRev;
  const ctx = savedId ? String(savedId) : postId ? String(postId) : 'new';
  const chosen = chosenAccounts(draft, accounts);
  const networks = draftNetworks(draft, accounts);
  const tab: Tab = tabPick !== 'original' && networks.includes(tabPick) ? tabPick : 'original';
  const net = tab === 'original' ? null : tab;
  const brand = draftBrand(draft, accounts, brands);
  const campaign = campaigns.find((c) => c.id === draft.campaign_id) ?? null;
  const checks = checkDraft(draft, accounts, !!status?.alt_text_required);
  const aiEnabled = status?.ai_enabled !== false;
  const canPublish = access.publish && (chosen.length === 0 || canPublishOn(access, chosen));
  const primary: PrimaryKind = !canPublish || brand?.approval_policy_id ? 'approval' : draft.mode === 'now' ? 'now' : 'schedule';
  const errors = checks.issues.filter((i) => i.level === 'error').length;
  const blockedBy = checks.blocking
    ? `Fix ${errors} blocking issue${errors === 1 ? '' : 's'} in Checks first.`
    : primary === 'schedule' && draft.mode === 'at' && !draft.when
      ? 'Choose a date and time first.'
      : null;
  const manualNetworks = [...new Set(checks.issues.filter((i) => i.code === 'manual' && i.network).map((i) => networkInfo(i.network!).label))];

  const update = (fn: (d: ComposerDraft) => ComposerDraft) => {
    setDraft(fn);
    setRev((r) => r + 1);
  };
  const replace = (d: ComposerDraft, clean: boolean) => {
    setDraft(d);
    setGen((g) => g + 1);
    const next = rev + 1;
    setRev(next);
    if (clean) setSavedRev(next);
  };

  /* ---- the copy on this computer ---- */
  useEffect(() => {
    let alive = true;
    void loadLocalCopy(postId ? String(postId) : 'new').then((c) => {
      if (alive && c) setRecover(c);
    });
    return () => {
      alive = false;
    };
  }, [postId]);

  useEffect(() => {
    if (!dirty || readOnly) return;
    const t = setTimeout(() => void saveLocalCopy(ctx, draft), 800);
    return () => clearTimeout(t);
  }, [draft, dirty, ctx, readOnly]);

  /* ---- saving ---- */
  const hasContent = !!(draft.base_text.trim() || draft.media.length || draft.account_ids.length);

  async function persist(silent: boolean, versionOverride?: number): Promise<Post | null> {
    const at = rev;
    const v = versionOverride ?? version;
    const input = toPostInput(draft, accounts, brand?.id ?? draft.brand_id, campaign, savedId ? v : undefined, zone);
    try {
      const r = savedId ? await socialApi.updatePost(savedId, input) : await socialApi.createPost(input);
      setSavedId(r.post.id);
      setVersion(r.post.version);
      setSavedRev(at);
      setNote(null);
      setServerSaves(true);
      void clearLocalCopy(ctx);
      invalidate(SK.postsAll, SK.post(r.post.id));
      return r.post;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const data = (e.data ?? null) as { current?: Post; by?: Person | null } | null;
        if (data?.current) setConflict({ current: data.current, by: data.by ?? null });
        else if (!silent) toast('error', 'Someone saved a newer version of this post. Reload it to see their changes.');
        return null;
      }
      await saveLocalCopy(ctx, draft);
      if (e instanceof ApiError && e.offline) {
        setNote('Kept on this computer — the server can’t be reached');
        if (!silent) toast('warning', 'The server can’t be reached. The post is kept on this computer; save again when you’re back online.');
        return null;
      }
      if (e instanceof Error && e.message === NOT_OFFERED) {
        setServerSaves(false);
        setNote('Kept on this computer — this server doesn’t offer Social Media yet');
      }
      if (!silent) toast('error', errorMessage(e));
      return null;
    }
  }

  // Autosave reads the latest state through a ref the effect below keeps current.
  const autosave = useRef<() => void>(() => undefined);
  useEffect(() => {
    autosave.current = () => {
      if (dirty && !busy && !readOnly && serverSaves && hasContent && !conflict) void persist(true);
    };
  });
  useEffect(() => {
    const t = setInterval(() => autosave.current(), AUTOSAVE_MS);
    const blur = () => autosave.current();
    window.addEventListener('blur', blur);
    return () => {
      clearInterval(t);
      window.removeEventListener('blur', blur);
    };
  }, []);

  async function saveDraft() {
    setBusy(true);
    const p = await persist(false);
    setBusy(false);
    if (p) toast('success', 'Draft saved.');
  }

  async function runPrimary(queue = false) {
    if (busy || readOnly) return;
    if (blockedBy && !(queue && !checks.blocking)) {
      toast('error', blockedBy);
      return;
    }
    setBusy(true);
    try {
      const p = await persist(false);
      if (!p) return;
      if (checkDraft(draft, accounts, !!status?.alt_text_required).blocking) {
        toast('error', 'The post still has blocking issues; see Checks.');
        return;
      }
      if (primary === 'approval' && !queue) {
        await socialApi.submit(p.id, { publish_when_approved: true });
        toast('success', brand?.approval_policy ? `Sent for approval (${brand.approval_policy.name}).` : 'Sent for approval.');
      } else {
        const mode = queue ? 'queue' : draft.mode;
        const at = mode === 'at' && draft.when ? fromLocalInput(draft.when, zone) : null;
        await socialApi.schedule(p.id, { mode, at, timezone: zone });
        toast('success', mode === 'now' ? 'Publishing now.' : mode === 'queue' ? 'Added to the queue.' : mode === 'best' ? 'Scheduled at each account’s best time.' : 'Scheduled.');
      }
      invalidate(SK.postsAll, SK.queueAll, SK.post(p.id));
      go('/social-media/calendar');
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---- editing ---- */
  const setText = (text: string) => update((d) => (net ? editVariantText(d, net, text) : { ...d, base_text: text }));
  const setMedia = (scope: Network | null, media: PostMedia[]) => update((d) => (scope ? editVariantMedia(d, scope, media) : { ...d, media }));
  const addMedia = (m: PostMedia[]) => update((d) => (net ? editVariantMedia(d, net, [...mediaFor(d, net), ...m]) : { ...d, media: [...d.media, ...m] }));
  const sources = useMediaSources(brand?.drive_folder?.id ?? null, addMedia);
  const drop = useDrop(!readOnly, (files) => void sources.upload(files));

  function insertText(t: string) {
    const el = captionRef.current;
    const cur = textFor(draft, net);
    const start = el ? el.selectionStart : cur.length;
    const end = el ? el.selectionEnd : cur.length;
    const pad = start > 0 && !/\s$/.test(cur.slice(0, start)) && !/^\s/.test(t) ? ' ' : '';
    const next = cur.slice(0, start) + pad + t + cur.slice(end);
    setText(next);
    const pos = start + pad.length + t.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  const setOptions = (n: Network, o: TargetOptions, customise?: boolean) => update((d) => setVariant(d, n, customise ? { options: o, customised: true, text: textFor(d, n) } : { options: o }));

  async function runAi(req: AiRequest, label: string, scope: Network | null) {
    if (aiBusy) return;
    const media = mediaFor(draft, scope);
    const imageIndex = media.findIndex((m) => m.kind === 'image' && !m.alt_text?.trim());
    const index = req.action === 'alt_text' ? (editing ? editing.index : imageIndex >= 0 ? imageIndex : media.findIndex((m) => m.kind === 'image')) : -1;
    setAiBusy(true);
    try {
      const body: AiRequest = req.action === 'alt_text' ? { action: 'alt_text', file_id: media[index]?.file_id ?? null } : { ...req, text: req.text ?? textFor(draft, scope) };
      const r = await socialApi.aiCompose(body);
      setSuggestion({ text: r.suggestion, scope, kind: req.action === 'alt_text' ? 'alt' : 'text', mediaIndex: index >= 0 ? index : undefined, label });
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setAiBusy(false);
    }
  }

  function applySuggestion(how: 'insert' | 'replace') {
    const s = suggestion;
    if (!s) return;
    setSuggestion(null);
    if (s.kind === 'alt') {
      const media = mediaFor(draft, s.scope);
      const i = s.mediaIndex ?? -1;
      if (i < 0 || !media[i]) return;
      setMedia(
        s.scope && draft.variants[s.scope]?.media ? s.scope : null,
        media.map((m, j) => (j === i ? { ...m, alt_text: s.text } : m)),
      );
      update((d) => ({ ...d, ai_used: true }));
      return;
    }
    if (how === 'insert' && s.scope === net) insertText(s.text);
    else {
      const cur = textFor(draft, s.scope);
      const next = how === 'replace' ? s.text : `${cur}${cur && !/\s$/.test(cur) ? ' ' : ''}${s.text}`;
      update((d) => (s.scope ? editVariantText(d, s.scope, next) : { ...d, base_text: next }));
    }
    update((d) => ({ ...d, ai_used: true }));
  }

  function fix(issue: { network: Network | null }, f: IssueFix) {
    const n = issue.network;
    if (!n) return;
    const caps = capsFor(n, accounts, draft);
    if (f === 'split_thread') {
      update((d) => {
        const text = textFor(d, n);
        return setVariant(d, n, { customised: true, text, options: { thread_parts: splitIntoThread(text, caps.text_limit, caps.counting) } });
      });
      setTab(n);
    } else if (f === 'remove_account') update((d) => removeNetwork(d, n, accounts));
    else if (f === 'crop') {
      const ratio = cropRatioFor(caps);
      update((d) => editVariantMedia(d, n, mediaFor(d, n).map((m) => (m.kind === 'image' ? { ...m, crop: { ratio } } : m))));
    } else if (f === 'add_alt_text') {
      const media = mediaFor(draft, n);
      const i = media.findIndex((m) => m.kind === 'image' && !m.alt_text?.trim());
      if (i >= 0) setEditing({ scope: draft.variants[n]?.media ? n : null, index: i });
    } else if (f === 'move_link_to_comment') update((d) => moveLinksToComment(d, n));
    else if (f === 'shorten') void runAi({ action: 'shorten', network: n }, `Shortened for ${networkInfo(n).label}`, n);
  }

  const shownMedia = mediaFor(draft, net);
  const editingMedia = editing ? mediaFor(draft, editing.scope)[editing.index] : undefined;
  const previewNet = net ?? networks[0] ?? 'facebook';

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void runPrimary();
        }
      }}
      {...drop.props}
    >
      <PageHeader
        crumb="Compose"
        title={title}
        scope={false}
        actions={
          <>
            {post ? <PostStatusPill status={post.status} /> : null}
            {brand ? <span className="rounded-[8px] border border-line px-2 py-1 text-[12.5px] font-semibold text-ink-2">{brand.name}</span> : null}
            {note ? <span className="text-[12px] text-warning">{note}</span> : dirty && !readOnly ? <span className="text-[12px] text-ink-3">Unsaved changes</span> : null}
            {!readOnly ? (
              <>
                <ConfirmButton
                  label="Discard"
                  confirm="Discard changes"
                  variant="ghost"
                  onConfirm={() => {
                    void clearLocalCopy(ctx);
                    go('/social-media/calendar');
                  }}
                />
                <Button variant="secondary" onClick={() => void saveDraft()} disabled={busy}>
                  Save draft
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          {recover && !readOnly ? (
            <Notice
              tone="info"
              icon="history"
              action={
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      replace(recover.draft, false);
                      setRecover(null);
                    }}
                  >
                    Recover unsaved draft
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRecover(null);
                      void clearLocalCopy(postId ? String(postId) : 'new');
                    }}
                  >
                    Dismiss
                  </Button>
                </span>
              }
            >
              There’s an unsaved copy of this post on this computer from {new Date(recover.saved_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
            </Notice>
          ) : null}
          {postId && !post ? <Notice tone="warning" icon="server">This post can’t be loaded from this server. What you write here is kept on this computer.</Notice> : null}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-4">
              {readOnly && post ? <PostResult post={post} events={events} accounts={accounts} canRetry={access.publish} canDuplicate={access.create} /> : null}
              <PostTo chosen={chosen} usable={usable} brands={brands} offered={accountsOffered} disabled={readOnly} onChange={(ids) => update((d) => ({ ...d, account_ids: ids, brand_id: ids.length ? (accounts.find((a) => a.id === ids[0])?.brand_id ?? d.brand_id) : d.brand_id }))} />
              <Panel title={undefined} bodyClassName="pt-4">
                <div className="flex flex-col gap-4">
                  <Editor
                    draft={draft}
                    accounts={accounts}
                    networks={networks}
                    checks={checks}
                    tab={tab}
                    onTab={setTab}
                    captionRef={captionRef}
                    readOnly={readOnly}
                    onText={setText}
                    onReset={(n) => update((d) => resetVariant(d, n))}
                    onOptions={setOptions}
                    onInsert={insertText}
                    onMention={() => insertText('@')}
                    onLink={() => {
                      const l = taggedLink(draft, previewNet, campaign);
                      if (l) insertText(l);
                      else document.getElementById(LINK_INPUT_ID)?.focus();
                    }}
                    onLabels={() => document.getElementById(LABELS_INPUT_ID)?.focus()}
                    onDrive={sources.openDrive}
                    onFiles={sources.openFiles}
                    brandId={brand?.id ?? null}
                  >
                    {aiEnabled && !readOnly ? <AiAssist key={net ?? 'o'} networks={networks} active={net} busy={aiBusy} hasImage={shownMedia.some((m) => m.kind === 'image')} onRun={(req, label) => void runAi(req, label, req.action === 'shorten' ? ((req.network as Network | null) ?? net) : net)} /> : null}
                    {suggestion ? <SuggestionCard s={suggestion} onInsert={() => applySuggestion('insert')} onReplace={() => applySuggestion('replace')} onDismiss={() => setSuggestion(null)} /> : null}
                  </Editor>
                  <MediaStrip media={shownMedia} uploading={sources.uploading} readOnly={readOnly} onChange={(m) => setMedia(net, m)} onAdd={sources.openDrive} onEdit={(i) => setEditing({ scope: net && draft.variants[net]?.media ? net : null, index: i })} />
                  <Details key={gen} draft={draft} campaigns={campaigns} campaignsOffered={!!campaignsQ.data?.offered} readOnly={readOnly} previewNetwork={previewNet} onChange={(p) => update((d) => ({ ...d, ...p }))} />
                </div>
              </Panel>
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Preview draft={draft} accounts={accounts} networks={networks} campaign={campaign} />
              <Checks issues={checks.issues} readOnly={readOnly} aiEnabled={aiEnabled} onFix={fix} />
            </div>
            {!readOnly ? (
              <div className="xl:col-span-2">
                <WhenCard
                  draft={draft}
                  accountIds={draft.account_ids}
                  brand={brand}
                  canPublish={canPublish}
                  primary={primary}
                  blockedBy={blockedBy}
                  busy={busy}
                  manualNetworks={manualNetworks}
                  onWhen={(v) => update((d) => ({ ...d, when: v }))}
                  onMode={(m) => update((d) => ({ ...d, mode: m }))}
                  onPrimary={() => void runPrimary()}
                  onQueue={() => void runPrimary(true)}
                  onSaveDraft={() => void saveDraft()}
                />
              </div>
            ) : null}
          </div>
        </div>
      </PageBody>
      {sources.picker}
      {drop.over ? (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[16px] border-2 border-dashed border-primary bg-selection/80 text-[15px] font-bold text-primary">
          Drop to upload to {brand?.drive_folder?.path ?? 'Drive'} and add to the post
        </div>
      ) : null}
      {editing && editingMedia ? (
        <MediaDialog
          key={`${editing.scope ?? 'o'}-${editing.index}`}
          media={editingMedia}
          aiEnabled={aiEnabled}
          onAltAi={() => void runAi({ action: 'alt_text' }, 'Alt text', editing.scope)}
          onClose={() => setEditing(null)}
          onSave={(m) => {
            setMedia(editing.scope, mediaFor(draft, editing.scope).map((x, j) => (j === editing.index ? m : x)));
            setEditing(null);
          }}
        />
      ) : null}
      {conflict ? (
        <Modal
          title={`${conflict.by?.name ?? 'Someone'} saved a newer version`}
          onClose={() => setConflict(null)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  replace(draftFromPost(conflict.current), true);
                  setVersion(conflict.current.version);
                  setConflict(null);
                }}
              >
                Reload theirs
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const v = conflict.current.version;
                  setVersion(v);
                  setConflict(null);
                  void persist(false, v);
                }}
              >
                Keep mine
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">
            This post changed on the server while you were editing it (version {conflict.current.version}). Reload theirs to see their changes — yours are dropped — or keep yours and save over it.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
