import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { Icon } from '../../../components/Icon';
import { Button, cx, Empty, Modal } from '../../../components/ui';
import { deleteTemplate, MK, saveTemplate, useTemplates, type Block, type Template } from '../api';
import { useMarketingOrg } from '../org';
import { Field, Input, Loaded, Notice, PageBody, PageHeader, Status, useAction } from '../parts';
import { asBlocks, htmlToText, markTags, sanitize, STARTERS, type Starter } from '../lib/blocks';
import { day, plural } from '../lib/format';
import { Confirm } from './Campaigns';

/**
 * Templates (MKT-EDT-02/03): the three starter layouts and the layouts the team saved from the editor, each with a
 * small preview; use one for a new campaign, rename it, or delete a saved one. Also the block renderer every email
 * preview shares — the editor's canvas (DK07), the starter cards of a new campaign, these cards.
 */

/* ------------------------------------------------------------------------ *
 * Rendering blocks
 * ------------------------------------------------------------------------ */

/** Typography for a block's sanitised HTML; size and colour come from the block. */
const PROSE =
  '[&_a]:text-primary [&_a]:underline [&_h1]:mb-2 [&_h1]:text-[22px] [&_h1]:leading-tight [&_h1]:font-bold [&_h2]:mb-1.5 [&_h2]:text-[18px] [&_h2]:leading-snug [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:text-[15px] [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0';

function Html({ html, known, pad, className, empty }: { html: string; known: ReadonlySet<string> | null; pad: string; className: string; empty?: string }) {
  // Only ever sanitised HTML goes into the page; the marks are the sanitiser's own spans.
  const [safe, blank] = useMemo(() => {
    const clean = sanitize(html);
    return [known ? markTags(clean, known) : clean, htmlToText(clean) === ''] as const;
  }, [html, known]);
  if (blank) return empty ? <div className={cx(pad, 'text-[12.5px] text-ink-3 italic')}>{empty}</div> : null;
  return <div className={cx(PROSE, pad, className)} dangerouslySetInnerHTML={{ __html: safe }} />;
}

function Picture({ src, alt, width }: { src: string; alt: string; width: 'full' | 'half' | 'auto' }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src)
    return (
      <div className="flex h-[90px] items-center justify-center gap-2 border border-dashed border-line bg-subtle px-3 text-center text-[12px] text-ink-3">
        <Icon name="image-off" size={16} className="shrink-0" />
        <span className="truncate">{alt || 'The picture could not be loaded here.'}</span>
      </div>
    );
  return <img src={src} alt={alt} draggable={false} onError={() => setFailed(src)} className={cx('block h-auto max-w-full rounded-[4px]', width === 'full' ? 'w-full' : width === 'half' ? 'mx-auto w-1/2' : 'mx-auto')} />;
}

/**
 * One block as the email shows it. `known` marks the merge tags (the editor); without it they show as written.
 * `placeholders` names an empty block (the editor) instead of leaving a gap (a thumbnail).
 */
export function BlockView({ block: b, mobile = false, known = null, placeholders = true }: { block: Block; mobile?: boolean; known?: ReadonlySet<string> | null; placeholders?: boolean }) {
  switch (b.type) {
    case 'text':
      return <Html html={b.html} known={known} pad="px-6 py-3" className="text-[14px] leading-[1.55] text-ink [&_p]:my-2" empty={placeholders ? 'Empty text block: write it in the block’s properties.' : undefined} />;
    case 'footer':
      return <Html html={b.html} known={known} pad="bg-subtle px-6 py-4" className="text-[11.5px] leading-[1.5] text-ink-3 [&_p]:my-1" empty={placeholders ? 'Empty footer' : undefined} />;
    case 'columns':
      return (
        <div className={cx('grid gap-5 px-6 py-3', mobile ? 'grid-cols-1' : 'grid-cols-2')}>
          <Html html={b.left} known={known} pad="min-w-0" className="text-[13.5px] leading-[1.5] text-ink [&_p]:my-1.5" empty={placeholders ? 'Left column' : undefined} />
          <Html html={b.right} known={known} pad="min-w-0" className="text-[13.5px] leading-[1.5] text-ink [&_p]:my-1.5" empty={placeholders ? 'Right column' : undefined} />
        </div>
      );
    case 'image':
      return b.src ? (
        <div className={cx(b.width === 'full' ? 'px-0 py-0' : 'px-6 py-3')}>
          <Picture src={b.src} alt={b.alt} width={b.width} />
        </div>
      ) : (
        <div className="flex h-[150px] items-center justify-center gap-2 border-y border-dashed border-primary/30 bg-selection px-4 text-center text-[12px] font-medium text-primary">
          <Icon name="image" size={16} className="shrink-0" />
          [IMAGE · public images library]
        </div>
      );
    case 'button':
      return (
        <div className={cx('px-6 py-3', b.align === 'center' && 'text-center')}>
          <span className="inline-block max-w-full truncate rounded-[6px] bg-primary px-4 py-2 text-[13px] font-semibold text-white">{b.label || 'Button'}</span>
        </div>
      );
    case 'divider':
      return (
        <div className="px-6 py-3">
          <hr className="border-0 border-t border-line" />
        </div>
      );
  }
}

/** A thumbnail of an email's first blocks, scaled down; not interactive. */
export function EmailPreview({ blocks, height = 150, scale = 0.4, max = 4 }: { blocks: readonly Block[]; height?: number; scale?: number; max?: number }) {
  return (
    <div aria-hidden inert className="pointer-events-none mx-auto overflow-hidden rounded-[8px] border border-line bg-surface select-none" style={{ height, width: Math.round(600 * scale) }}>
      <div style={{ width: 600, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {blocks.slice(0, max).map((b) => (
          <BlockView key={b.id} block={b} placeholders={false} />
        ))}
      </div>
    </div>
  );
}

/** One way to start a campaign: a starter layout, or a template from the server (saved, or its own starter). */
export interface StartOption {
  key: string;
  /** Other keys that mean this one: `starter:newsletter` for the server's own "Newsletter". */
  aliases: string[];
  kind: 'starter' | 'template';
  starter: Starter | null;
  template: Template | null;
  label: string;
  blocks: Block[];
}

const nameKey = (s: string) => s.trim().toLowerCase();

/** The three starters — a starter the server lists under the same name stands in for ours — then the saved templates. */
export function startOptions(templates: readonly Template[] | undefined): StartOption[] {
  const rows = templates ?? [];
  const serverStarters = new Set(rows.filter((t) => t.kind === 'starter').map((t) => nameKey(t.name)));
  const local: StartOption[] = STARTERS.filter((s) => !serverStarters.has(nameKey(s.label))).map((s) => ({ key: `starter:${s.id}`, aliases: [], kind: 'starter', starter: s, template: null, label: s.label, blocks: s.blocks }));
  const remote: StartOption[] = rows.map((t) => ({
    key: `template:${t.id}`,
    aliases: t.kind === 'starter' ? STARTERS.filter((s) => nameKey(s.label) === nameKey(t.name)).map((s) => `starter:${s.id}`) : [],
    kind: 'template',
    starter: null,
    template: t,
    label: t.name,
    blocks: asBlocks(t.blocks),
  }));
  return [...local, ...remote.filter((o) => o.template?.kind === 'starter'), ...remote.filter((o) => o.template?.kind !== 'starter')];
}

/* ------------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------------ */

export default function Templates() {
  const org = useMarketingOrg();
  const qc = useQueryClient();
  const { go } = useTab();
  const templates = useTemplates();
  const [busy, run] = useAction();
  const [renaming, setRenaming] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: MK.templates(org) });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Email"
        title="Templates"
        sub="Starter layouts, and the layouts your team saved to use again"
        actions={
          <Button variant="primary" icon="plus" onClick={() => go('/marketing/campaigns/new')}>
            New campaign
          </Button>
        }
      />
      <PageBody className="flex flex-col gap-5">
        <Notice>
          Templates are saved from the campaign editor: open a campaign’s content and choose <b>Save as template</b>. A new campaign starts from a copy, so changing a template never changes a campaign already made from it.
        </Notice>
        <Loaded q={templates} what="Templates">
          {(rows) => {
            const options = startOptions(rows);
            const starters = options.filter((o) => o.kind === 'starter' || o.template?.kind === 'starter');
            const saved = options.filter((o) => o.template?.kind === 'saved');
            const card = (o: StartOption) => (
              <TemplateCard
                key={o.key}
                option={o}
                busy={busy !== null}
                onUse={() => go(o.template ? `/marketing/campaigns/new?template=${o.template.id}` : `/marketing/campaigns/new?starter=${o.starter?.id ?? ''}`)}
                onRename={o.template ? () => setRenaming(o.template) : undefined}
                onDelete={o.template?.kind === 'saved' ? () => setDeleting(o.template) : undefined}
              />
            );
            return (
              <>
                <section aria-labelledby="tpl-starters" className="flex flex-col gap-2.5">
                  <h2 id="tpl-starters" className="text-[14px] font-bold text-ink">
                    Starter layouts
                  </h2>
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">{starters.map(card)}</div>
                </section>
                <section aria-labelledby="tpl-saved" className="flex flex-col gap-2.5">
                  <h2 id="tpl-saved" className="text-[14px] font-bold text-ink">
                    Saved templates
                  </h2>
                  {saved.length ? (
                    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">{saved.map(card)}</div>
                  ) : (
                    <div className="rounded-[12px] border border-line bg-surface">
                      <Empty icon="panel-top" title="No saved templates yet" hint="Open a campaign in the editor and choose Save as template to keep its layout for the next one." />
                    </div>
                  )}
                </section>
              </>
            );
          }}
        </Loaded>
      </PageBody>
      {renaming ? (
        <RenameModal
          template={renaming}
          busy={busy === 'rename'}
          onClose={() => setRenaming(null)}
          onSave={(name) =>
            void run(
              'rename',
              async () => {
                await saveTemplate(org, renaming.id, { name, blocks: renaming.blocks });
                refresh();
                setRenaming(null);
              },
              'Template renamed.',
            )
          }
        />
      ) : null}
      {deleting ? (
        <Confirm
          title="Delete this template?"
          action="Delete template"
          danger
          busy={busy === 'delete'}
          onClose={() => setDeleting(null)}
          onYes={() =>
            void run(
              'delete',
              async () => {
                await deleteTemplate(deleting.id);
                refresh();
                setDeleting(null);
              },
              'Template deleted.',
            )
          }
        >
          <b className="text-ink">{deleting.name}</b> is deleted. Campaigns already made from it keep their content.
        </Confirm>
      ) : null}
    </div>
  );
}

function TemplateCard({ option: o, busy, onUse, onRename, onDelete }: { option: StartOption; busy: boolean; onUse: () => void; onRename?: () => void; onDelete?: () => void }) {
  const t = o.template;
  return (
    <article aria-label={o.label} className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-line bg-surface p-3">
      <EmailPreview blocks={o.blocks} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-ink">{o.label}</h3>
          {t?.kind === 'saved' ? <Status tone="success">Saved</Status> : <Status tone="muted">Starter</Status>}
        </div>
        <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
          {o.starter ? o.starter.description : `${plural(o.blocks.length, 'block')}${t?.updated_at ? ` · updated ${day(t.updated_at)}` : ''}`}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" icon="plus" onClick={onUse}>
          Use in a new campaign
        </Button>
        {onRename ? (
          <Button size="sm" variant="ghost" icon="pen" disabled={busy} onClick={onRename}>
            Rename
          </Button>
        ) : null}
        {onDelete ? (
          <button type="button" disabled={busy} onClick={onDelete} className="inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold text-danger hover:bg-danger-bg disabled:opacity-50">
            <Icon name="trash" size={15} />
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}

function RenameModal({ template, busy, onSave, onClose }: { template: Template; busy: boolean; onSave: (name: string) => void; onClose: () => void }) {
  const id = useId();
  const [name, setName] = useState(template.name);
  const ok = name.trim() !== '' && name.trim() !== template.name;
  return (
    <Modal
      title="Rename template"
      labelledBy={id}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={() => onSave(name.trim())}>
            Rename
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(name.trim());
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} />
        </Field>
      </form>
    </Modal>
  );
}
