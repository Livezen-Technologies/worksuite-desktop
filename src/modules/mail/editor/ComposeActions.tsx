import { text } from '../../../core/i18n';
import type { MenuSection } from '../../../components/Menu';
import type { Signature, Template } from '../types';
import { ToolbarRow, type ToolGroup } from './Toolbar';

/**
 * The composer's actions (worksuite-desktop#188), one row above the
 * addresses and apart from the formatting tools: Attach ▾ (this computer,
 * WorkSuite Files, a cloud link), Template ▾ (insert, save, Quick Parts),
 * Signature ▾, Suggest times, Mail merge and ⋯ Options. What does not fit
 * goes into More, as in the formatting row.
 */

export type QuickPart = { id: number; name: string; html: string; org: boolean };

/** Why Quick Parts cannot be used now, or null when they can. */
export function quickPartsReason(parts: QuickPart[] | undefined, loading: boolean, failed: boolean): string | null {
  if (loading) return text('Loading Quick Parts…');
  if (failed) return text('Quick Parts could not be loaded. Try again in a moment.');
  if (!parts?.length) return text('No Quick Parts yet — create them in Settings › Mail › Quick Steps, under Quick Parts.');
  return null;
}

export interface ComposeActionsProps {
  offline: boolean;
  templates: Template[];
  onTemplate: (t: Template) => void;
  onSaveTemplate: () => void;
  quickParts: QuickPart[];
  quickPartsReason: string | null;
  onQuickPart: (p: QuickPart) => void;
  signatures: Signature[];
  currentSignature: string;
  onSignature: (s: Signature | null) => void;
  onAttachComputer: () => void;
  onAttachFiles: () => void;
  onCloudLink: () => void;
  mailMerge: boolean;
  onMailMerge: () => void;
  suggestTimes: boolean;
  onSuggestTimes: () => void;
  options: () => MenuSection[];
  important: boolean;
}

export function ComposeActions(p: ComposeActionsProps) {
  const needs = (what: string) => (p.offline ? text('{what} needs WorkSuite.', { what }) : undefined);
  const attach = (): MenuSection[] => [
    {
      id: 'attach',
      items: [
        { id: 'a-computer', label: text('From this computer'), icon: 'laptop', disabled: p.offline, reason: needs(text('Attaching')), onSelect: p.onAttachComputer },
        { id: 'a-files', label: text('From WorkSuite Files'), icon: 'folder', description: text('A copy of the file goes with the message'), disabled: p.offline, reason: needs(text('Attaching')), onSelect: p.onAttachFiles },
        { id: 'a-link', label: text('Cloud link'), icon: 'link', description: text('A link to a file in Files instead of a copy'), disabled: p.offline, reason: needs(text('Sharing a link')), onSelect: p.onCloudLink },
      ],
    },
  ];
  const template = (): MenuSection[] => [
    {
      id: 'templates',
      items: [
        {
          id: 'tpl-insert',
          label: text('Insert template'),
          icon: 'file-text',
          disabled: !p.templates.length,
          reason: text('No templates yet. Save this message as one, or make them in WorkSuite Mail on the web.'),
          submenu: [{ id: 'list', items: p.templates.map((t) => ({ id: `tpl-${t.id}`, label: t.name, description: t.mine ? undefined : text('Shared with you'), onSelect: () => p.onTemplate(t) })) }],
        },
        { id: 'tpl-save', label: text('Save as template…'), icon: 'bookmark', disabled: p.offline, reason: needs(text('Saving a template')), onSelect: p.onSaveTemplate },
      ],
    },
    {
      id: 'parts',
      items: [
        {
          id: 'quick-parts',
          label: text('Quick Parts'),
          icon: 'zap',
          disabled: !!p.quickPartsReason,
          reason: p.quickPartsReason ?? undefined,
          ...(p.quickPartsReason ? {} : { submenu: [{ id: 'qp', items: p.quickParts.map((q) => ({ id: `qp-${q.id}`, label: q.name, description: q.org ? text('Organisation') : undefined, onSelect: () => p.onQuickPart(q) })) }] }),
        },
      ],
    },
  ];
  const signature = (): MenuSection[] => [
    {
      id: 'sigs',
      items: [
        ...p.signatures.map((s) => ({ id: `sig-${s.id}`, label: s.name, radio: true, checked: p.currentSignature === String(s.id), onSelect: () => p.onSignature(s) })),
        { id: 'sig-none', label: text('No signature'), radio: true, checked: p.currentSignature === '', onSelect: () => p.onSignature(null) },
      ],
    },
  ];
  const groups: ToolGroup[] = [
    {
      id: 'add',
      label: text('Add'),
      items: [
        { id: 'attach', label: text('Attach'), icon: 'paperclip', caption: text('Attach'), menu: attach },
        { id: 'template', label: text('Template'), icon: 'file-text', caption: text('Template'), menu: template },
        { id: 'signature', label: text('Signature'), icon: 'signature', caption: text('Signature'), menu: signature },
      ],
    },
    {
      id: 'more',
      label: text('More'),
      items: [
        ...(p.suggestTimes ? [{ id: 'suggest', label: text('Suggest times'), icon: 'calendar', caption: text('Suggest times'), disabled: p.offline, reason: text('Suggesting times needs WorkSuite.'), run: p.onSuggestTimes }] : []),
        ...(p.mailMerge ? [{ id: 'merge', label: text('Mail merge'), icon: 'users', caption: text('Mail merge'), disabled: p.offline, reason: text('Mail merge needs WorkSuite.'), run: p.onMailMerge }] : []),
        { id: 'options', label: text('Options'), icon: 'sliders', caption: text('Options'), menu: p.options, badge: p.important ? <span className="font-bold text-danger">!</span> : undefined },
      ],
    },
  ];
  return (
    <div className="flex shrink-0 items-center border-b border-line px-3 py-1">
      <ToolbarRow groups={groups} label={text('Message actions')} size="sm" className="min-w-0 flex-1" />
    </div>
  );
}
