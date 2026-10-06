import { canOpenWebPath } from '@shared/access';
import { useVisibleIds } from '../../../core/access';
import { useStore } from '../../../core/store';
import { app } from '../../../core/app-state';
import { openWebLink } from '../../../core/tab-context';
import { CardFrame, type CardKind } from './CardFrame';
import { MeetShareCard } from './DriveMeetCards';
import { ModuleCard } from './ModuleCards';
import { PageCard, type CardSource } from './PageCard';
import { pageTitleLine, pathOf, recordsIn, type RecordRef } from './recordLinks';

/**
 * The cards a message's text calls for: every WorkSuite record it names,
 * each read for whoever is looking, with their own access — so a record
 * they cannot open says so, and one deleted since says that. `from` is the
 * message they came in, for a page's Request access.
 */
export function RecordCards({ text, from }: { text: string | null | undefined; from?: CardSource }) {
  const origin = useStore(app, (s) => s.auth?.server?.origin);
  const refs = recordsIn(text, origin);
  if (!refs.length) return null;
  return (
    <div className="flex w-full flex-col gap-1.5">
      {refs.map((r) => (
        <RecordCard key={r.kind === 'page' ? `page-${r.app}-${r.page}` : 'uuid' in r ? r.uuid : `${r.kind}-${r.id}`} r={r} title={r.kind === 'page' ? pageTitleLine(text, r) : null} from={from} />
      ))}
    </div>
  );
}

export function RecordCard({ r, title, from }: { r: RecordRef; title?: string | null; from?: CardSource }) {
  const visible = useVisibleIds();
  // A page says itself whether the reader has its app, and offers to ask for it (worksuite-desktop#266).
  if (r.kind === 'page') return <PageCard r={r} title={title} from={from} />;
  // A record in an app this person was not given is not read, named or offered:
  // a plain "no access" frame stands where its card would be.
  if (!canOpenWebPath(pathOf(r), visible)) return <CardFrame kind="link" state="noaccess" gone={{ title: 'You don’t have access', sub: 'This link is not one you can open.' }} />;
  if (r.kind === 'meet') return <MeetShareCard uuid={r.uuid} />;
  return <ModuleCard r={r} />;
}

export function openRecord(r: RecordRef): void {
  openWebLink(pathOf(r));
}

/** A record whose content cannot be read here: the frame, and the way to it. */
export function PlainRecordCard({ r, title }: { r: RecordRef; title?: string }) {
  return (
    <CardFrame kind={r.kind as CardKind} actions={[{ label: 'Open', tone: 'primary', onClick: () => openRecord(r) }]}>
      <div className="px-3.5 py-3.5">
        <b className="block text-[14px]">{title ?? 'Open to see it'}</b>
      </div>
    </CardFrame>
  );
}
