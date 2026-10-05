import { DriveFilePicker } from '../../components/DriveFilePicker';
import { apiUrl } from '../../core/api';
import { Checkbox } from '../../components/Checkbox';
import { queueMedia } from './outgoing';
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from 'react';
import type { PickedFile } from '@shared/ipc/contract';
import { websiteDraftKey, websiteReplyMutation } from '@shared/website-reply';
import { app } from '../../core/app-state';
import { apiGet, apiPost, request } from '../../core/api';
import { call, errorMessage, registerDropped } from '../../core/bridge';
import { useDraft } from '../../core/drafts';
import { holdWhileSending } from '../../core/closeGuard';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { uploadBlob } from '../../core/upload';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';
import { UserAvatar } from '../../components/UserAvatar';
import { AttachMenu, CameraCapture, DrivePicker, RefusedNotes, Tray, type AttachChoice, type Staged } from './attach';
import { KIND, type CardKind } from './cards/CardFrame';
import { recordsIn } from './cards/recordLinks';
import { SharePicker, ShareMenu, type ShareKind } from './cards/SharePicker';
import { caretPoint } from './caret';
import { PRESENCE } from './Details';
import { mentionQuery } from './mentions';
import { EmojiPicker, VoiceRecorder } from './parts';
import { typingLine } from './typing';
import type { ReplyTarget } from './Thread';
import type { ChatMessage } from './types';
import { refuseForVisitor, savedReplyQuery, type SavedReply } from './website/profile';
import { inSlashMenu, SlashMenu, type SlashMenuHandle } from './SlashMenu';
import { transcript, useChatSavedReplies, type RepliesState, type Turn } from './replies';
import { AiTextDialog } from '../ai/AiTextDialog';
import { AiMenuButton } from '../ai/AiMenuButton';
import { WRITING_TASKS, type TextTask } from '../ai/textTools';
import { openConversationData, startWebsiteReply, team, useAgents } from './website/api';
import { NOTE_TONE } from './kit/MessageBubble';
import { TEAM_COMPOSER, WEBSITE_COMPOSER } from './kit/caps';
import { usePresence } from './presence';

/**
 * The website channel (WS-WCHAT ENH-02, RDC-01/02): the same composer, for a
 * website visitor. Attach, paste, drop, camera, emoji and saved replies are
 * on; @mentions, voice messages, urgent, sharing records and Drive links are
 * not there at all — a visitor could receive none of them.
 */
export interface ComposerChannel {
  inputLabel?: string;
  draftModule: string;
  draftContext: string;
  refusal: string | null;
  allowBlockedDraft: boolean;
  maxLength: number;
  maxCaptionLength?: number;
  voice: boolean;
  attachChoices?: AttachChoice[];
  notice?: ReactNode;
  context: () => Turn[];
  refuseFile: (file: File) => string | null;
  /** `canned`: the saved reply the words started from, counted as a use once sent (RDC-03). */
  send: (text: string, files: File[], meta?: { canned: number | null }) => Promise<boolean>;
  /**
   * The channel's saved replies (C-07, UX-VIS-04): the chips above the box (by shortcut, "/m365"), the Saved replies
   * button and the "/" menu, as a website conversation has them. Without, "/" offers Team Chat's.
   */
  replies?: SavedReply[];
  /** Plain text: no WhatsApp formatting row and no character counter under the box (speaking first to a visitor). */
  plain?: boolean;
  /** Everything staged went: the words and every file (speaking first then opens the new chat, C-07). */
  onSent?: () => void;
}

export interface WebsiteChannel {
  conversationId: number;
  replies: SavedReply[];
  maxUploadKb?: number;
  /**
   * The Internal note tab (C-08, TEAM-60, TEAM-61): this same box writes a note only staff see — amber and dashed as the
   * note's bubble is, words only, @ to mention a colleague, who is notified. It never goes through the visitor's outbox,
   * and colleagues see "typing" for it while the visitor never does (LIVE-03).
   */
  note?: boolean;
}

/** Where an unsent internal note waits: beside the reply's draft, never mixed with it (C-08). */
export const websiteNoteDraftKey = (conversationId: number): { module: string; context: string } => {
  const k = websiteDraftKey(conversationId);
  return { module: k.module, context: `${k.context}:note` };
};

/** At most one "typing" signal per few seconds; "stopped" after a pause or on send. */
const TYPING_EVERY = 4_000;
const TYPING_IDLE = 5_000;
const URGENT = 'chat.message.urgent';

type Target = { type: string; id: number; name: string; detail?: string | null };
type Mentionable = Record<'people' | 'teams' | 'departments' | 'everyone', Target[]>;
type BlobItem = Extract<Staged, { kind: 'blob' }>;
type DiskItem = Extract<Staged, { kind: 'disk' }>;
type Extra = { caption?: string; replyTo?: number };

/** What a conversation asks of its composer: files dropped on it, a message to edit. */
export interface ComposerHandle {
  stage: (files: PickedFile[]) => void;
  edit: (m: { id: number; message: string }) => void;
  focus: () => void;
}

/** A pasted or clipboard picture's name when it came without one. */
const screenshotName = () => `Screenshot ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}.png`;

/**
 * The message box (ChatComposer — polished): attach, emoji, the text, then @
 * to mention, a voice message, urgent and send (P-04 "One chat kit"); a reply
 * or an edit shown above it; files wait in a tray until Send; a voice message
 * records in its place. `compact` is the drawer's and the call panel's size.
 *
 * One composer for Team Chat and website chats (RDC-01/02): `website` gives it
 * the website channel profile (WEBSITE_COMPOSER), which hides what a visitor
 * cannot receive and adds saved replies and the writing assistant.
 */
export function Composer({ roomId, roomName, group, reply, onClearReply, typing = [], compact, look = 'box', extras, inside, website, channel, ref }: {
  roomId: string;
  roomName: string;
  group: boolean;
  reply: ReplyTarget | null;
  onClearReply: () => void;
  typing?: string[];
  compact?: boolean;
  /** `pill`: the chat drawer's message box — a rounded field with the voice/send button beside it. */
  look?: 'box' | 'pill';
  /** Actions above the box (the chat drawer's quick actions). */
  extras?: ReactNode;
  /** A small chip inside the box, above the line you type in (the drawer's open record). */
  inside?: ReactNode;
  /** A website visitor's conversation rather than a Team Chat room. */
  website?: WebsiteChannel;
  channel?: ComposerChannel;
  ref?: Ref<ComposerHandle>;
}) {
  const qc = useQueryClient();
  const site = website ?? null;
  // The channel profile (P-04, RDC-02): what this composer offers, Team Chat's or a website visitor's.
  const caps = site ? WEBSITE_COMPOSER : TEAM_COMPOSER;
  const note = !!site?.note;
  // A website draft keeps the key the website thread always used, so none is lost in the move (RDC-06); a note has its own.
  const siteKey = site ? (note ? websiteNoteDraftKey(site.conversationId) : websiteDraftKey(site.conversationId)) : null;
  const draft = useDraft<string>(channel?.draftModule ?? siteKey?.module ?? 'chat', channel?.draftContext ?? siteKey?.context ?? `room:${roomId}`, '');
  const canUrgent = useStore(app, (s) => caps.urgent && !channel && !!s.bootstrap?.permissions.some((p) => p === '*' || p === URGENT));
  const transfers = useStore(app, (s) => s.transfers);
  const [sending, setSending] = useState(false);
  const sendingGate = useRef(false);
  const draftRevision = useRef(0);
  const [editing, setEditing] = useState<{ id: number; original: string; text: string } | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [menu, setMenu] = useState<'attach' | 'emoji' | 'share' | null>(null);
  const [modal, setModal] = useState<'drive' | 'camera' | null>(null);
  const [sharing, setSharing] = useState<Exclude<ShareKind, 'drive'> | null>(null);
  const origin = useStore(app, (s) => s.auth?.server?.origin);
  const [recording, setRecording] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  // Files refused before any upload, each with why, under the tray (P-04 AttachmentTray; RDC-04).
  const [refused, setRefused] = useState<Array<{ key: string; text: string }>>([]);
  const [originalQuality, setOriginalQuality] = useState(false);
  const [asking, setAsking] = useState<{ start: number; word: string; left: number } | null>(null);
  const [pick, setPick] = useState(0);
  const [slash, setSlash] = useState<{ start: number; word: string } | null>(null);
  const [ai, setAi] = useState<{ task: TextTask; title: string } | null>(null);
  const picked = useRef<Target[]>([]);
  const slashMenu = useRef<SlashMenuHandle>(null);
  // The "/" the Saved replies button put in the box, rather than one typed (C-07).
  const slashTyped = useRef(false);
  // The saved reply the website message being written started from, if any.
  const cannedUsed = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingAt = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = useQuery({
    queryKey: ['chat', 'mentionable', roomId, asking?.word ?? ''],
    queryFn: ({ signal }) => apiGet<Mentionable>(`/api/chat/rooms/${roomId}/mentionable`, { q: asking?.word ?? '' }, signal),
    enabled: group && asking !== null,
    staleTime: 30_000,
  });
  // In a note, @ names a colleague who answers this website's chats (TEAM-61): the invite picker's list, not a room's.
  const colleagues = useAgents(note, site?.conversationId);
  const myId = useStore(app, (s) => s.auth?.user?.id ?? null);
  const noteFound = (word: string): Mentionable => ({
    everyone: [],
    teams: [],
    departments: [],
    people: (colleagues.data?.agents ?? [])
      .filter((a) => String(a.id) !== String(myId) && a.name.toLowerCase().includes(word.toLowerCase()))
      .slice(0, 8)
      .map((a) => ({ type: 'user', id: a.id, name: a.name, detail: a.department ?? null })),
  });
  const found = asking ? (note ? noteFound(asking.word) : suggestions.data) : undefined;
  const people = found?.people ?? [];
  const options = found ? [...found.everyone, ...people, ...found.teams, ...found.departments].slice(0, 10) : [];
  const presenceOf = usePresence(people.map((p) => p.id));

  const text = editing ? editing.text : draft.value;
  const setText = (v: string) => {
    draftRevision.current++;
    if (editing) setEditing({ ...editing, text: v });
    else draft.setValue(v);
  };
  const done = (s: Staged) => s.kind === 'disk' && !!s.transfer && transfers.find((t) => t.id === s.transfer)?.state === 'done';
  const tray = staged.filter((s) => !done(s));
  const ready = tray.filter((s) => (s.kind === 'disk' ? !s.transfer : s.state === 'ready'));
  const limit = channel ? (ready.length ? channel.maxCaptionLength ?? channel.maxLength : channel.maxLength) : undefined;
  const canSend = editing ? editing.text.trim() !== '' : text.trim() !== '' || ready.length > 0;

  const focus = (at?: number) =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      if (at !== undefined) el.setSelectionRange(at, at);
    });

  const stage = (all: Staged[]) => {
    // A note is words only (TEAM-60): files go to the visitor, from Reply to visitor.
    if (note) {
      toast('error', 'A note is words only. Attach files from Reply to visitor.');
      return;
    }
    // What a visitor cannot receive is refused here, with the reason, before anything is uploaded (RDC-04).
    const notes: Array<{ key: string; text: string }> = [];
    const items = channel ? all.filter((it) => {
      if (it.kind !== 'blob') { toast('error', 'Choose channel files using Attach.'); return false; }
      const why = channel.refuseFile(new File([it.blob], it.name, { type: it.blob.type }));
      if (why) toast('error', why);
      return !why;
    }) : site
      ? all.filter((it) => {
          const why = it.kind === 'disk' ? refuseForVisitor(it.file.name, it.file.size, site.maxUploadKb) : refuseForVisitor(it.name, it.blob.size, site.maxUploadKb);
          if (why) notes.push({ key: it.key, text: why });
          return !why;
        })
      : all;
    // What this batch refused replaces what an earlier one did: the notes say why the files just chosen did not join.
    if (site) setRefused(notes);
    if (!items.length) return;
    setStaged((list) => [...list.filter((s) => !done(s)), ...items]);
    focus();
  };
  const stageDisk = (files: PickedFile[]) => stage(files.map((file) => ({ key: file.handle, kind: 'disk' as const, file, transfer: null })));
  const stageBlob = (blob: Blob, name: string) => stage([{ key: crypto.randomUUID(), kind: 'blob', blob, name, state: 'ready', progress: 0, error: null, extra: null }]);
  /**
   * "Paste a screenshot" (P-04 AttachmentPicker · website): the picture on the clipboard joins the tray, as pasting it
   * into the box would. Where the clipboard cannot be read without a paste, the box is focused and the key is named.
   */
  const pasteScreenshot = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        stageBlob(await item.getType(type), screenshotName());
        return;
      }
      toast('info', 'There is no screenshot on the clipboard. Copy one, then choose Paste a screenshot.');
    } catch {
      focus();
      toast('info', `Press ${/Mac/i.test(navigator.platform) ? '⌘V' : 'Ctrl+V'} in the message box to paste the screenshot.`);
    }
  };

  useImperativeHandle(ref, () => ({
    stage: stageDisk,
    edit: (m) => {
      setEditing({ id: m.id, original: m.message, text: m.message });
      setMenu(null);
      setRecording(false);
      focus(m.message.length);
    },
    focus: () => focus(),
  }));

  const typingSignal = (state: 'start' | 'stop') => {
    if (channel) return;
    // A website visitor sees "Nuwan is typing…" at once, and it goes at once on send, clear or blur (LIVE-03, LIVE-04).
    if (site) {
      // Writing a note: colleagues see "Nimal (a note)", the visitor nothing (LIVE-03, C-08).
      void apiPost(`/api/chat/widget-admin/conversations/${site.conversationId}/typing`, note ? { state, internal: true } : { state }).catch(() => undefined);
      return;
    }
    void apiPost('/api/chat/typing', { room_id: Number(roomId), state }).catch(() => undefined);
  };
  const stopTyping = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    if (typingAt.current) {
      typingAt.current = 0;
      typingSignal('stop');
    }
  };
  const onTyped = (now: number) => {
    if (!typingAt.current || now - typingAt.current > TYPING_EVERY) {
      typingAt.current = now;
      typingSignal('start');
    }
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(stopTyping, TYPING_IDLE);
  };
  // Leaving the conversation ends "typing" there.
  useEffect(() => stopTyping, [roomId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (t: Target) => {
    if (!asking) return;
    const caret = input.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, asking.start)}@${t.name} ${text.slice(caret)}`);
    picked.current = [...picked.current.filter((p) => !(p.type === t.type && p.id === t.id)), t];
    setAsking(null);
    focus(asking.start + t.name.length + 2);
  };
  /** Only who is still written in the text is mentioned. */
  const mentionsIn = (words: string) =>
    picked.current.filter((t) => words.includes(`@${t.name}`)).map((t) => (t.type === 'everyone' ? { type: 'everyone' } : { type: t.type, id: t.id, name: t.name }));

  const refresh = () => {
    if (site) {
      void qc.invalidateQueries({ queryKey: ['website'] });
      return;
    }
    void qc.invalidateQueries({ queryKey: ['chat', 'messages', roomId] });
    void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
  };

  // Held, so closing a chat window waits for it (#103).
  const sendBlob = (s: BlobItem, extra: Extra | null) => holdWhileSending(sendBlobNow(s, extra));
  const sendBlobNow = async (s: BlobItem, extra: Extra | null) => {
    const update = (patch: Partial<BlobItem>) => setStaged((list) => list.map((x) => (x.key === s.key && x.kind === 'blob' ? { ...x, ...patch } : x)));
    update({ state: 'sending', progress: 0, error: null, extra });
    if (site) {
      // A pasted screenshot or a camera picture: straight to the conversation's attach.
      try {
        const form = new FormData();
        form.append('file', s.blob, s.name);
        if (extra?.caption) form.append('caption', extra.caption.slice(0, 400));
        await request('POST', `/api/chat/widget-admin/conversations/${site.conversationId}/attach`, { body: form });
        setStaged((list) => list.filter((x) => x.key !== s.key));
        refresh();
      } catch (e) {
        update({ state: 'failed', error: errorMessage(e) });
      }
      return;
    }
    try {
      const { uploadId } = await uploadBlob(s.blob, s.name, { kind: 'chat', roomId }, (p) => update({ progress: p }));
      await apiPost('/api/chat/messages/attachments', {
        room_id: Number(roomId),
        upload_id: uploadId,
        client_message_id: `desktop-${crypto.randomUUID()}`,
        ...(extra?.caption ? { caption: extra.caption } : {}),
        ...(extra?.replyTo ? { reply_to: extra.replyTo } : {}),
      });
      setStaged((list) => list.filter((x) => x.key !== s.key));
      refresh();
    } catch (e) {
      update({ state: 'failed', error: errorMessage(e) });
    }
  };

  const sendDisk = async (list: DiskItem[], extra: Extra) => {
    if (!list.length) return;
    const target = site ? { kind: 'website' as const, conversationId: site.conversationId, ...(extra.caption ? { caption: extra.caption.slice(0, 400) } : {}) } : { kind: 'chat' as const, roomId, ...extra };
    const out = await call('transfers:upload', { handles: list.map((s) => s.file.handle), target });
    const byKey = new Map(list.map((s, i) => [s.key, out[i]?.id ?? null]));
    setStaged((all) => all.map((x) => (x.kind === 'disk' && byKey.has(x.key) ? { ...x, transfer: byKey.get(x.key) ?? null } : x)));
  };

  /** Words go through the offline queue (urgent ones only while online, so they are never late). */
  const sendWords = async (words: string, asUrgent: boolean): Promise<boolean> => {
    if (site && note) {
      // A note goes straight to the server, never the visitor's outbox; only colleagues still named in it are mentioned.
      const named = picked.current.filter((t) => t.type === 'user' && words.includes(`@${t.name}`)).map((t) => t.id);
      try {
        await team.note(site.conversationId, words, named);
      } catch (e) {
        toast('error', errorMessage(e));
        return false;
      }
      picked.current = [];
      void qc.invalidateQueries({ queryKey: ['website'] });
      return true;
    }
    if (site) {
      // Drawn at once, "Sending…", and as the stored message the moment the server has it (worksuite-desktop#252).
      const finish = startWebsiteReply(qc, site.conversationId, words, reply?.id ?? null);
      // A reply to a visitor goes through the outbox too: pending while offline, sent once on reconnecting (RDC-07).
      const r = await call('offline:submit', websiteReplyMutation(site.conversationId, words, reply?.id ?? null, cannedUsed.current)).catch((e: unknown) => {
        finish(null);
        throw e;
      });
      finish(r);
      cannedUsed.current = null;
      if (!r.delivered && !r.queued) {
        toast('error', r.error ?? 'Not sent.');
        return false;
      }
      // Delivered: only this thread and the open list are asked again (finish); queued: the outbox shows it.
      if (r.queued) void qc.invalidateQueries({ queryKey: ['offline'] });
      return true;
    }
    const mentions = mentionsIn(words);
    const r = await call('offline:submit', {
      module: 'chat',
      entity: 'message',
      entityId: roomId,
      label: `Message: ${words.slice(0, 180)}`,
      method: 'POST',
      path: '/api/chat/messages',
      body: {
        room_id: Number(roomId),
        message: words,
        client_message_id: `desktop-${crypto.randomUUID()}`,
        ...(reply ? { reply_to: reply.id } : {}),
        ...(mentions.length ? { mentions } : {}),
        ...(asUrgent ? { urgent: true } : {}),
      },
      queueIfOffline: !asUrgent,
    });
    if (!r.delivered && !r.queued) {
      toast('error', r.code === 'POLICY_DENIED' ? `${r.error} Your message is kept as a draft.` : (r.error ?? 'Not sent.'));
      return false;
    }
    void qc.invalidateQueries({ queryKey: r.queued ? ['offline'] : ['chat', 'messages', roomId] });
    void qc.invalidateQueries({ queryKey: ['chat', 'rooms'] });
    return true;
  };

  /**
   * With files, the words are the first file's caption and the reply goes
   * with it. Urgent words go as their own message first: a file cannot be
   * urgent.
   */
  const send = async () => {
    if (!canSend || sending || sendingGate.current || channel?.refusal) return;
    if (limit && text.length > limit) { toast('error', `Keep this message within ${limit} characters.`); return; }
    stopTyping();
    setAsking(null);
    if (editing) return saveEdit();
    const words = text.trim();
    const revision = draftRevision.current;
    const clearSentDraft = async () => {
      if (draftRevision.current !== revision) return;
      draft.setValue('');
      await draft.clear();
    };
    const files = ready;
    const wordsAlone = words !== '' && (urgent || files.length === 0);
    setRefused([]);
    sendingGate.current = true;
    setSending(true);
    try {
      if (channel) {
        const media = files.filter((f): f is BlobItem => f.kind === 'blob').map((f) => new File([f.blob], f.name, { type: f.blob.type }));
        // Only a message started from a saved reply says so; every other send is as it always was.
        const send = (words: string, files: File[], first: boolean) => (first && cannedUsed.current ? channel.send(words, files, { canned: cannedUsed.current }) : channel.send(words, files));
        if (!media.length && !(await send(words, [], true))) return;
        for (let i = 0; i < media.length; i++) {
          if (!(await send(i === 0 ? words : '', [media[i]!], i === 0))) return;
          const key = files[i]!.key;
          setStaged((all) => all.filter((s) => s.key !== key));
          // A delivered caption must not be repeated when retrying a later failed file.
          if (i === 0) await clearSentDraft();
        }
        cannedUsed.current = null;
        await clearSentDraft(); onClearReply(); channel.onSent?.(); return;
      }
      if (wordsAlone && !(await sendWords(words, urgent))) return;
      if (!site && files.length) {
        queueMedia(roomId, files, { ...(wordsAlone ? {} : { ...(words ? { caption: words } : {}), ...(reply ? { replyTo: reply.id } : {}) }) }, originalQuality);
        setStaged((all) => all.filter((s) => !files.some((f) => f.key === s.key)));
        void clearSentDraft(); picked.current = []; setUrgent(false); onClearReply();
        return;
      }
      if (files.length) {
        const first: Extra = wordsAlone ? {} : { ...(words ? { caption: words } : {}), ...(reply ? { replyTo: reply.id } : {}) };
        const lead = files[0]!;
        const disk = files.filter((s): s is DiskItem => s.kind === 'disk');
        if (lead.kind === 'disk') {
          await sendDisk([lead], first);
          await sendDisk(disk.slice(1), {});
        } else {
          void sendBlob(lead, first);
          await sendDisk(disk, {});
        }
        for (const s of files.slice(1)) if (s.kind === 'blob') void sendBlob(s, null);
      }
      await clearSentDraft();
      picked.current = [];
      setUrgent(false);
      onClearReply();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      sendingGate.current = false;
      setSending(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const words = editing.text.trim();
    if (words === editing.original.trim()) return setEditing(null);
    setSending(true);
    try {
      const mentions = mentionsIn(words);
      await apiPost(`/api/chat/messages/${editing.id}/edit`, { message: words, ...(mentions.length ? { mentions } : {}) });
      setEditing(null);
      picked.current = [];
      refresh();
      focus();
    } catch (e) {
      toast('error', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const sendVoice = (blob: Blob, ms: number) => {
    setRecording(false);
    if (channel) { stageBlob(blob, `Voice message.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`); return; }
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    queueMedia(roomId, [{ key: crypto.randomUUID(), kind: 'blob', blob, name: `Voice message.${ext}`, state: 'ready', progress: 0, error: null, extra: null }], { voice: true, durationMs: Math.round(ms), ...(reply ? { replyTo: reply.id } : {}) }, true);
    onClearReply();
  };

  const attach = async (c: AttachChoice) => {
    setMenu(null);
    if (channel) {
      if (c === 'drive') return setModal('drive');
      if (c === 'voice' && channel.voice) return setRecording(true);
      if (c === 'camera') return setModal(c);
      fileInput.current?.click(); return;
    }
    if (c === 'camera') return setModal(c);
    // A visitor cannot play a voice message (RDC-02); a Drive file goes to them as a copy, never a link (RDC-05).
    if (c === 'voice' && !caps.voice) return;
    if (c === 'drive') return setModal(c);
    if (c === 'voice') return setRecording(true);
    if (c === 'paste') return void pasteScreenshot();
    try {
      const files = await call('files:pickFiles', { multiple: true, title: `Send to ${roomName}`, ...(c === 'any' || c === 'upload' ? {} : { only: c }) });
      stageDisk(files);
    } catch (e) {
      toast('error', errorMessage(e));
    }
  };

  /**
   * Drive files to a website visitor (RDC-05): the server copies each into the conversation — the visitor can never
   * open a Drive link — under the visitor allowlist and size limit, and says why one is refused.
   */
  const sendDriveCopies = async (files: Array<{ id: number; name: string }>) => {
    if (!site) return;
    setModal(null);
    setSending(true);
    try {
      for (const f of files) {
        try {
          await apiPost(`/api/chat/widget-admin/conversations/${site.conversationId}/attach-drive`, { file_id: f.id });
        } catch (e) {
          toast('error', `${f.name}: ${errorMessage(e)}`);
        }
      }
      void qc.invalidateQueries({ queryKey: ['website'] });
    } finally {
      setSending(false);
    }
  };

  /** A record from Share from WorkSuite goes as its address; each reader's app shows it as a card. */
  const shareRecord = async (path: string): Promise<boolean> => {
    const base = (origin ?? 'https://app.worksuite.lk').replace(/\/+$/, '');
    const ok = await sendWords(`${base}${path}`, false);
    if (ok) onClearReply();
    return ok;
  };
  const pickShare = (k: ShareKind) => {
    setMenu(null);
    if (k === 'drive') setModal('drive');
    else setSharing(k);
  };

  const retry = (s: Staged) => {
    if (s.kind === 'blob') return void sendBlob(s, s.extra);
    if (s.transfer) void call('transfers:retry', { id: s.transfer }).catch((e) => toast('error', errorMessage(e)));
  };
  const remove = (s: Staged) => {
    setStaged((list) => list.filter((x) => x.key !== s.key));
    if (s.kind === 'disk' && s.transfer) void call('transfers:cancel', { id: s.transfer }).catch(() => undefined);
  };

  // The "/" menu (worksuite-desktop#32): a website conversation's saved replies are the website chat's.
  const chatReplies = useChatSavedReplies(!site && !channel?.replies && slash !== null);
  // A website conversation's, or the channel's own (speaking first, C-07); Team Chat's otherwise.
  const ownReplies = note ? null : (site?.replies ?? channel?.replies ?? null);
  const replies: RepliesState = ownReplies ? { state: 'ready', replies: ownReplies } : chatReplies;
  const me = useStore(app, (s) => s.bootstrap?.user?.id ?? null);
  const myName = useStore(app, (s) => s.bootstrap?.user?.name ?? 'Me');
  /** The conversation as a suggestion reads it: what this composer's thread has loaded, oldest first. */
  const conversation = (): Turn[] => {
    if (channel) return channel.context();
    if (site) {
      const c = openConversationData(qc, String(site.conversationId));
      return (c?.messages ?? []).filter((m) => m.from === 'visitor' || m.from === 'agent').map((m) => ({ mine: m.from === 'agent', name: m.from === 'agent' ? (m.agent ?? myName) : (c?.visitor?.name ?? 'Visitor'), text: m.body ?? '' }));
    }
    const pages = qc.getQueryData<InfiniteData<{ messages: ChatMessage[] }>>(['chat', 'messages', roomId])?.pages ?? [];
    return [...pages].reverse().flatMap((p) => p.messages).filter((m) => !m.deleted).map((m) => ({ mine: String(m.sender_id) === String(me), name: m.sender_name, text: m.message ?? '' }));
  };
  /** What the menu picked takes the place of the "/word" typed for it, and stays in the box until sent. */
  const insertSlash = (body: string) => {
    // A website saved reply: counted as a use when the message is sent (RDC-03).
    if (ownReplies) cannedUsed.current = ownReplies.find((r) => r.body === body)?.id ?? cannedUsed.current;
    const start = slash ? slash.start : (input.current?.selectionStart ?? text.length);
    const end = slash ? slash.start + 1 + slash.word.length : start;
    setText(`${text.slice(0, start)}${body}${text.slice(end)}`);
    setSlash(null);
    slashTyped.current = false;
    focus(start + body.length);
  };
  const insertReply = (r: SavedReply) => insertSlash(r.body);

  const insert = (e: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    setText(`${text.slice(0, at)}${e}${text.slice(el?.selectionEnd ?? at)}`);
    setMenu(null);
    focus(at + e.length);
  };

  const cancelEdit = () => {
    setEditing(null);
    focus();
  };

  /** Where the "@" is drawn, from the composer's left edge, so the list opens above it. */
  const leftOf = (el: HTMLTextAreaElement, index: number) => {
    const base = root.current?.getBoundingClientRect().left ?? 0;
    const x = el.getBoundingClientRect().left + caretPoint(el, index).left - base;
    return Math.max(8, Math.min(x - 12, (root.current?.clientWidth ?? 400) - (compact ? 258 : 298)));
  };

  const line = typingLine(typing);
  const size = look === 'pill' ? 'h-8 w-8' : compact ? 'h-[30px] w-[30px]' : 'h-[34px] w-[34px]';
  const tool = cx('flex shrink-0 items-center justify-center text-ink-2 hover:bg-subtle hover:text-ink', look === 'pill' ? 'rounded-full' : 'rounded-[8px]', size);
  const hint = editing
    ? 'Enter to save · Esc to cancel'
    : note
      ? 'Enter to add the note · Shift + Enter for a new line · @ to mention a colleague'
      : site
      ? 'Enter to send · Shift + Enter for a new line · / for saved and suggested replies'
      : urgent
      ? 'Urgent: reaches people who only want priority notifications'
      : `Enter to send · Shift + Enter for a new line${group ? ' · @ to mention' : ''} · / for replies`;


  const attachBtn = caps.attach && !editing && !note ? (
                <span className="relative">
                  <button type="button" aria-label="Attach" title="Attach" aria-haspopup="menu" aria-expanded={menu === 'attach'} onClick={() => setMenu(menu === 'attach' ? null : 'attach')} className={cx(tool, menu === 'attach' && '!bg-selection !text-primary')}>
                    <Icon name="paperclip" size={compact ? 16 : 18} />
                  </button>
                  {menu === 'attach' ? <AttachMenu compact={compact} align={look === 'pill' ? 'right' : 'left'} only={channel ? channel.attachChoices ?? ['document', 'image', 'video', 'audio', 'camera', 'drive', ...(channel.voice ? ['voice' as const] : [])] : caps.attachChoices} copy={channel ? undefined : caps.attachCopy} onPick={(c) => void attach(c)} onClose={() => setMenu(null)} /> : null}
                </span>
              ) : null;
  const shareBtn = caps.shareRecords && !editing && !channel ? (
                <span className="relative">
                  <button type="button" aria-label="Share from WorkSuite" title="Share from WorkSuite" aria-haspopup="menu" aria-expanded={menu === 'share'} onClick={() => setMenu(menu === 'share' ? null : 'share')} className={cx(tool, menu === 'share' && '!bg-selection !text-primary')}>
                    <Icon name="plus" size={compact ? 16 : 18} />
                  </button>
                  {menu === 'share' ? <ShareMenu align={look === 'pill' ? 'right' : 'left'} onPick={pickShare} onUpload={() => void attach('any')} onClose={() => setMenu(null)} /> : null}
                </span>
              ) : null;
  const field = (
              <textarea
                ref={input}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (!editing) onTyped(e.timeStamp);
                  if (!editing && !note) setSlash(savedReplyQuery(e.target.value, e.target.selectionStart ?? e.target.value.length));
                  if ((group && caps.mentions) || note) {
                    const q = mentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    setAsking(q ? { ...q, left: leftOf(e.target, q.start) } : null);
                    setPick(0);
                  }
                }}
                onBlur={(e) => {
                  stopTyping();
                  setAsking(null);
                  // Into the "/" menu (its search, its suggestions): it stays open.
                  if (!inSlashMenu(e.relatedTarget)) setSlash(null);
                }}
                onKeyDown={(e) => {
                  if (slash && slashMenu.current?.onKey(e)) return;
                  if (asking && options.length) {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      setPick((pick + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                      return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      choose(options[pick]!);
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setAsking(null);
                      return;
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                    return;
                  }
                  if (e.key === 'Escape') {
                    if (editing) cancelEdit();
                    else if (reply) onClearReply();
                  }
                }}
                onPaste={(e) => {
                  // FR-XFR-05: a pasted screenshot or file joins the tray, on the user's paste only.
                  const files = Array.from(e.clipboardData.files);
                  if (files.length === 0 || editing) return;
                  e.preventDefault();
                  for (const img of files.filter((f) => f.type.startsWith('image/'))) {
                    stageBlob(img, img.name && img.name !== 'image.png' ? img.name : screenshotName());
                  }
                  const onDisk = files.filter((f) => f.size > 0 && f.name && !f.type.startsWith('image/'));
                  if (channel) { for (const f of onDisk) stageBlob(f, f.name); }
                  else if (onDisk.length) void registerDropped(onDisk).then(stageDisk, (err: unknown) => toast('error', errorMessage(err)));
                }}
                disabled={!!channel?.refusal && !channel.allowBlockedDraft}
                maxLength={limit ?? (site ? 4000 : undefined)}
                rows={1}
                placeholder={editing ? 'Edit your message' : note ? 'Write a note for your colleagues — @ to mention someone' : tray.length ? 'Add a caption…' : look === 'pill' ? 'Message' : site ? 'Type a message… / for saved replies' : 'Type a message…'}
                aria-label={note ? 'Internal note' : (channel?.inputLabel ?? 'Message')}
                className={cx('bare-focus field-sizing-content max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1 outline-none', compact ? 'min-h-[30px] py-[5px] text-[13px]' : 'min-h-[34px] py-[7px] text-[13.5px]')}
              />
  );
  const urgentBtn = canUrgent && !editing ? (
                <button
                  type="button"
                  aria-label="Urgent"
                  title={urgent ? 'Urgent is on: reaches people who only want priority notifications' : 'Mark as urgent'}
                  aria-pressed={urgent}
                  onClick={() => setUrgent(!urgent)}
                  className={cx(tool, urgent && '!bg-danger !text-white')}
                >
                  <Icon name="warning" size={compact ? 15 : 17} />
                </button>
              ) : null;
  // AI tools (worksuite-desktop#53): the draft rewritten, a reply suggested, the conversation summarised — shown first,
  // used only when the person chooses.
  const aiItems = [
    { label: 'Suggest a reply', icon: 'reply', run: () => setAi({ task: 'reply', title: 'Suggested reply' }) },
    { label: 'Summarise the conversation', icon: 'file-text', run: () => setAi({ task: 'summarize', title: site ? 'Summary of this chat' : `Summary of ${roomName}` }) },
    { sep: true as const },
    ...WRITING_TASKS.map((w) => ({ label: w.label, disabled: !text.trim(), run: () => setAi({ task: w.task, title: w.label }) })),
  ];
  const aiBtn = caps.assistant && !editing ? <AiMenuButton compact items={aiItems} ariaLabel={channel ? undefined : caps.assistantLabel} className={cx(tool, '!font-normal')} iconClassName={site ? 'text-[#0E7C86] dark:text-[#5CC6CF]' : undefined} /> : null;
  const aiEl = ai ? (
        <AiTextDialog
          title={ai.title}
          task={ai.task}
          input={() => (ai.task === 'reply' || ai.task === 'summarize' ? transcript(conversation(), ai.task === 'summarize' ? 60 : 20) : text)}
          actions={
            ai.task === 'summarize'
              ? [{ label: 'Copy', icon: 'copy', primary: true, run: (t) => void navigator.clipboard.writeText(t).then(() => toast('success', 'Summary copied.')) }]
              : [
                {
                  label: ai.task === 'reply' ? 'Put in the message box' : 'Replace my message',
                  primary: true,
                  run: (t) => {
                    setText(t);
                    focus(t.length);
                  },
                },
              ]
          }
          onClose={() => setAi(null)}
        />
      ) : null;
  /**
   * Saved replies (C-07, UX-VIS-04: attach, emoji, saved replies, writing assistant, Send): opens the "/" menu at the
   * caret, as typing "/" would; the "/" it puts there is replaced by what is picked, or taken out again on Esc.
   */
  const openReplies = () => {
    const at = input.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, at)}/${text.slice(at)}`);
    slashTyped.current = true;
    setSlash({ start: at, word: '' });
    focus(at + 1);
  };
  const closeReplies = () => {
    if (slashTyped.current && slash && !slash.word && text[slash.start] === '/') setText(text.slice(0, slash.start) + text.slice(slash.start + 1));
    slashTyped.current = false;
    setSlash(null);
    focus();
  };
  const savedBtn = caps.savedReplies && ownReplies && ownReplies.length && !editing ? (
              <button type="button" aria-label="Saved replies" title="Saved replies (/)" aria-pressed={slash !== null} onClick={() => (slash ? closeReplies() : openReplies())} className={cx(tool, slash && '!bg-selection !text-primary')}>
                <Icon name="bookmark" size={compact ? 15 : 17} />
              </button>
  ) : null;
  const emojiBtn = caps.emoji ? (
              <button type="button" aria-label="Emoji" title="Emoji" aria-pressed={menu === 'emoji'} onClick={() => setMenu(menu === 'emoji' ? null : 'emoji')} className={cx(tool, menu === 'emoji' && '!bg-selection !text-primary')}>
                <Icon name="smile" size={compact ? 16 : 18} />
              </button>
  ) : null;
  /** "@" (P-04, Team Chat's set): puts an @ at the caret and opens the list of who can be mentioned, as typing one does. */
  const mention = () => {
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    const before = at > 0 && !/\s/.test(text[at - 1]!) ? ' @' : '@';
    setText(`${text.slice(0, at)}${before}${text.slice(el?.selectionEnd ?? at)}`);
    const start = at + before.length - 1;
    setAsking({ start, word: '', left: el ? leftOf(el, start) : 8 });
    setPick(0);
    focus(start + 1);
  };
  const atBtn = caps.mentions && group && !editing && !channel ? (
              <button type="button" aria-label="Mention someone" title="Mention someone (@)" onClick={mention} className={tool}>
                <Icon name="at" size={compact ? 16 : 18} />
              </button>
  ) : null;
  // A voice message from the box itself (P-04, Team Chat's set); the paperclip still offers it too.
  const micBtn = caps.voice && !channel && !editing ? (
              <button type="button" aria-label="Record a voice message" title="Record a voice message" onClick={() => { setMenu(null); setRecording(true); }} className={tool}>
                <Icon name="mic" size={compact ? 16 : 18} />
              </button>
  ) : null;
  const sendBtn = channel?.refusal ? null : (
              <button
                type="button"
                aria-label={editing ? 'Save the change' : note ? 'Add note' : 'Send'}
                title={editing ? 'Save the change' : note ? 'Add the note (Enter)' : 'Send (Enter)'}
                disabled={!canSend || sending}
                onClick={() => void send()}
                className={cx(
                  'flex shrink-0 items-center justify-center rounded-[9px] text-white disabled:bg-subtle disabled:text-ink-3',
                  size,
                  editing ? 'bg-[#D97706] hover:bg-[#B45309]' : urgent ? 'bg-danger hover:opacity-90' : 'bg-primary hover:bg-primary-hover',
                )}
              >
                <Icon name={editing ? 'check' : 'send'} size={compact ? 14 : 16} />
              </button>
  );

  const lineEl = line ? (
        <div className="absolute bottom-full left-4 mb-1 flex items-center gap-1.5 rounded-full bg-surface/95 px-2 py-0.5 text-[11.5px] text-ink-3" aria-live="polite">
          <span className="flex gap-[3px]" aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} className="h-[5px] w-[5px] animate-bounce rounded-full bg-ink-3" style={{ animationDelay: `${i * 150}ms` }} />)}
          </span>
          {line}
        </div>
      ) : null;
  const barEl = editing ? (
        <div className="flex items-center gap-2 rounded-[8px] border-l-[3px] border-[#D97706] bg-[#FFF6E5] px-2.5 py-1.5 text-[12px] dark:bg-warning-bg">
          <Icon name="compose" size={13} className="shrink-0 text-[#9A4A06] dark:text-warning" />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-[#7A3B05] dark:text-warning">Editing message</b>
            <span className="truncate text-ink-2">{editing.original}</span>
          </span>
          <button type="button" onClick={cancelEdit} className="shrink-0 rounded-[6px] px-2 py-0.5 font-semibold text-[#7A3B05] hover:bg-[#FDEBC8] dark:text-warning dark:hover:bg-transparent">Cancel</button>
        </div>
      ) : reply && caps.replyQuote ? (
        // ReplyBar (P-04): "Replying to Visitor 4F2A · Can you send a quote…", on one line.
        <div data-reply-bar className="flex items-center gap-2 rounded-[8px] border-l-[3px] border-primary bg-selection px-2.5 py-1.5 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-ink-2">
            Replying to <b className="text-ink">{reply.sender_name}</b>
            {reply.snippet ? ` · ${reply.snippet}` : ''}
          </span>
          <button type="button" aria-label="Cancel the reply" title="Cancel the reply (Esc)" onClick={onClearReply} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-surface hover:text-ink">
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null;
  // A visitor's widget shows a WorkSuite link as a link, never as a card.
  const detected = caps.shareRecords && !editing && !channel ? recordsIn(text, origin) : [];
  const repliesEl = slash && !editing ? (
        <SlashMenu
          ref={slashMenu}
          word={slash.word}
          replies={replies}
          context={conversation}
          onInsert={insertSlash}
          onClose={closeReplies}
          compact={compact}
        />
      ) : null;
  // The first six saved replies as chips above the box (RDC-03); speaking first names them by shortcut, "/m365" (C-07).
  const chipsEl = ownReplies && ownReplies.length && !editing ? (
        <div className="flex flex-wrap items-center gap-[5px] text-[11.5px] font-semibold" aria-label="Saved replies">
          {ownReplies.slice(0, 6).map((r) => (
            <button key={r.id} type="button" title={r.body} onClick={() => insertReply(r)} className="rounded-[10px] border border-line px-2 py-0.5 text-ink hover:bg-subtle">
              {!site && r.shortcut ? `/${r.shortcut}` : r.title}
            </button>
          ))}
          {ownReplies.length > 6 ? <span className="px-1 font-normal text-ink-3">Type / for all {ownReplies.length}</span> : null}
        </div>
      ) : null;
  const detectedEl = detected.length ? (
        <div className="flex items-center gap-2 rounded-[8px] border-l-[3px] border-primary bg-selection px-2.5 py-1.5 text-[12px]" aria-live="polite" data-detected>
          <Icon name="link" size={13} className="shrink-0 text-primary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <b className="text-ink">{detected.length === 1 ? 'Link detected · will show as a card' : `${detected.length} links detected · each will show as a card`}</b>
            <span className="truncate text-ink-2">{detected.map((r) => KIND[r.kind as CardKind].label).join(' · ')}</span>
          </span>
        </div>
      ) : null;
  const mentionsEl = asking && options.length ? (
        <div
          role="listbox"
          aria-label="Mention someone"
          className={cx('absolute bottom-full z-40 mb-1 flex max-h-[320px] flex-col rounded-[12px] border border-line bg-surface shadow-[0_12px_32px_rgb(var(--ws-shadow-rgb)/.18)]', compact ? 'w-[250px]' : 'w-[290px]')}
          style={{ left: asking.left }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1 scroll-thin">
            {options.map((t, i) => {
              const heading =
                t.type === 'user' && options.findIndex((o) => o.type === 'user') === i ? (note ? 'COLLEAGUES' : 'PEOPLE IN THIS CHAT')
                  : t.type !== 'user' && t.type !== 'everyone' && options.findIndex((o) => o.type !== 'user' && o.type !== 'everyone') === i ? 'TEAMS AND DEPARTMENTS'
                    : null;
              const state = t.type === 'user' ? (presenceOf(t.id) ?? 'offline') : '';
              const sub = t.type === 'user'
                ? [t.detail, (PRESENCE[state]?.label ?? state).toLowerCase()].filter(Boolean).join(' · ')
                : (t.detail ?? (t.type === 'department' ? 'Department' : 'Team'));
              return (
                <div key={`${t.type}:${t.id}`}>
                  {heading ? <div className="px-2 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.6px] text-ink-3">{heading}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === pick}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setPick(i)}
                    onClick={() => choose(t)}
                    className={cx('flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left', i === pick ? 'bg-selection' : 'hover:bg-subtle')}
                  >
                    {t.type === 'user' ? (
                      <span className="relative shrink-0">
                        <UserAvatar userId={t.id} name={t.name} size={28} />
                        <span className={cx('absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface', PRESENCE[state]?.dot ?? 'bg-line')} />
                      </span>
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-subtle text-ink-2">
                        <Icon name={t.type === 'everyone' ? 'megaphone' : t.type === 'department' ? 'building' : 'users'} size={14} />
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col">
                      <b className="truncate text-[12.5px] text-ink">{t.type === 'everyone' ? '@everyone' : t.name}</b>
                      {sub ? <span className="truncate text-[11.5px] text-ink-3">{sub}</span> : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="border-t border-line px-2.5 py-1.5 text-[11px] text-ink-3">↑↓ to move · Enter to pick · Esc to close</div>
        </div>
      ) : null;
  const trayEl = tray.length && !editing && !recording ? (
          <div className="px-1 pt-1">
            {!site && !channel ? <label className="flex items-center gap-1 px-1 text-[11px] text-ink-2"><Checkbox checked={originalQuality} onChange={(e) => setOriginalQuality(e.target.checked)} />Original Quality</label> : null}
            <Tray items={tray} transfers={transfers} onRemove={remove} onRetry={retry} compact={compact} />
          </div>
        ) : null;
  const refusedEl = refused.length && !editing ? <RefusedNotes notes={refused} onDismiss={(key) => setRefused((list) => list.filter((n) => n.key !== key))} /> : null;
  const modalsEl = (
    <>
      {modal === 'drive' && site && caps.driveCopy ? (
        <DriveFilePicker title="Send a copy to the visitor" confirmLabel="Send a copy" busy={sending} onClose={() => setModal(null)} onChoose={(files) => void sendDriveCopies(files.map((f) => ({ id: Number(f.id), name: f.name })))} />
      ) : modal === 'drive' && channel ? <DriveFilePicker title="Attach from WorkSuite Files" confirmLabel="Attach" onClose={() => setModal(null)} onChoose={(files) => { void (async () => { try { for (const f of files) { const response = await fetch(apiUrl(`/api/files/${f.id}/download`)); if (!response.ok) throw new Error('This file could not be downloaded.'); stageBlob(await response.blob(), f.name); } setModal(null); } catch (e) { toast('error', errorMessage(e)); } })(); }} /> : modal === 'drive' ? <DrivePicker roomId={roomId} onClose={() => setModal(null)} onSent={refresh} /> : null}
      {modal === 'camera' ? <CameraCapture onTaken={stageBlob} onClose={() => setModal(null)} /> : null}
      {sharing ? <SharePicker kind={sharing} roomName={roomName} onClose={() => setSharing(null)} onDrive={() => (setSharing(null), setModal('drive'))} onShare={shareRecord} /> : null}
    </>
  );

  if (look === 'pill') {
    const empty = !canSend && !editing;
    return (
      <div ref={root} data-chat-composer className="relative flex shrink-0 flex-col gap-1.5 px-2.5 pt-1 pb-2.5">
        {extras}
        {lineEl}
        {barEl}
        {detectedEl}
        {mentionsEl}
        {repliesEl}
        {menu === 'emoji' ? <EmojiPicker className="absolute bottom-full left-2.5 mb-2" onPick={insert} onClose={() => setMenu(null)} /> : null}
        <div className="flex items-end gap-2">
          <div
            className={cx(
              'relative flex min-w-0 flex-1 flex-col rounded-[22px] bg-surface px-1.5 py-[5px] shadow-[0_1px_2px_rgb(var(--ws-shadow-rgb)/.12)] ring-1 transition-shadow',
              urgent && !editing ? 'ring-danger' : editing ? 'ring-[#D97706]' : 'ring-line focus-within:ring-primary/50',
            )}
          >
            {inside}
            {trayEl}
            <div className="flex items-end gap-0.5">
              {recording ? (
                <VoiceRecorder compact onDone={(b, ms) => void sendVoice(b, ms)} onCancel={() => setRecording(false)} />
              ) : (
                <>
                  {emojiBtn}
                  {aiBtn}
                  {field}
                  {urgentBtn}
                  {shareBtn}
                  {attachBtn}
                </>
              )}
            </div>
          </div>
          {recording ? null : empty ? (
            <button type="button" aria-label="Record a voice message" title="Record a voice message" onClick={() => setRecording(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-[0_4px_10px_rgba(35,52,158,.3)] hover:bg-primary-hover">
              <Icon name="mic" size={19} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={editing ? 'Save the change' : 'Send'}
              title={editing ? 'Save the change' : 'Send (Enter)'}
              disabled={!canSend || sending}
              onClick={() => void send()}
              className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-[0_4px_10px_rgba(35,52,158,.3)] disabled:opacity-60', editing ? 'bg-[#D97706] hover:bg-[#B45309]' : urgent ? 'bg-danger hover:opacity-90' : 'bg-primary hover:bg-primary-hover')}
            >
              <Icon name={editing ? 'check' : 'send'} size={18} />
            </button>
          )}
        </div>
        {modalsEl}
        {aiEl}
      </div>
    );
  }

  return (
    <div ref={root} data-chat-composer onDragOver={(e) => { if (channel && e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={(e) => { if (!channel) return; e.preventDefault(); for (const f of Array.from(e.dataTransfer.files)) stageBlob(f, f.name); }} className={cx('relative flex shrink-0 flex-col border-t border-line bg-surface', compact ? 'gap-1.5 px-2.5 pt-2 pb-2.5' : 'gap-2 px-4 pt-2.5 pb-3')}>
      {extras}
      {channel?.notice}
      {channel ? <input ref={fileInput} type="file" multiple hidden onChange={(e) => { for (const f of Array.from(e.target.files ?? [])) stageBlob(f, f.name); e.target.value = ''; }} /> : null}
      {lineEl}
      {barEl}
      {detectedEl}
      {mentionsEl}
      {repliesEl}
      {chipsEl}
      {note ? (
        <span className="flex items-center gap-1.5 px-1 text-[11px] font-bold text-[#7A4308] dark:text-warning">
          <Icon name="lock" size={12} /> Only staff see this · the visitor never does
        </span>
      ) : null}
      {menu === 'emoji' ? <EmojiPicker className="absolute left-3 bottom-full mb-2" onPick={insert} onClose={() => setMenu(null)} /> : null}
      <div
        className={cx(
          'relative flex flex-col gap-1.5 rounded-[12px] border transition-colors',
          compact ? 'px-1.5 py-1' : 'px-2 py-1.5',
          // The note's own look (C-08): the amber, dashed edge its bubble will have in the thread.
          note
            ? cx(NOTE_TONE, 'focus-within:ring-2 focus-within:ring-[#D9A441]/25')
            : urgent && !editing
            ? 'border-danger bg-danger-bg/40 focus-within:ring-2 focus-within:ring-danger/20'
            : editing
              ? 'border-[#D97706] focus-within:ring-2 focus-within:ring-[#D97706]/20'
              : 'border-line focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15',
        )}
      >
        {inside}
        {trayEl}
        {refusedEl}
        {channel && !channel.plain ? <div className="flex gap-1" aria-label="Message formatting">{[{ label: 'Bold', mark: '*' }, { label: 'Italic', mark: '_' }, { label: 'Strikethrough', mark: '~' }, { label: 'Monospace', mark: '```' }].map(({ label, mark }) => <button key={label} type="button" className="rounded px-2 text-[11px] text-ink-2 hover:bg-subtle" onClick={() => { const el = input.current; const start = el?.selectionStart ?? text.length; const end = el?.selectionEnd ?? start; setText(`${text.slice(0, start)}${mark}${text.slice(start, end)}${mark}${text.slice(end)}`); focus(start + mark.length); }}>{label}</button>)}</div> : null}
        <div className="flex items-end gap-1">
          {recording ? (
            <VoiceRecorder compact={compact} onDone={(b, ms) => void sendVoice(b, ms)} onCancel={() => setRecording(false)} />
          ) : (
            // P-04: attach, emoji, the box, then @, a voice message and urgent (Team Chat), or saved replies and the
            // writing assistant (website), and send.
            <>
              {shareBtn}
              {attachBtn}
              {emojiBtn}
              {field}
              {atBtn}
              {micBtn}
              {urgentBtn}
              {savedBtn}
              {aiBtn}
              {sendBtn}
            </>
          )}
        </div>
      </div>
      {!compact && !recording ? <div className={cx('px-1 text-[11px]', urgent && !editing ? 'font-semibold text-danger' : 'text-ink-3')}>{hint}</div> : null}
      {channel && !channel.plain ? <div className="text-right text-[11px] text-ink-3">{text.length}/{limit}</div> : null}
      {modalsEl}
      {aiEl}
    </div>
  );
}
