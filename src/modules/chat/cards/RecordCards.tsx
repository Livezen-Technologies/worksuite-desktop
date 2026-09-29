import { canOpenWebPath } from '@shared/access';
import { useVisibleIds } from '../../../core/access';
import { useStore } from '../../../core/store';
import { app } from '../../../core/app-state';
import { openWebLink } from '../../../core/tab-context';
import { CardFrame, type CardKind } from './CardFrame';
import { MeetShareCard } from './DriveMeetCards';
import { ModuleCard } from './ModuleCards';
import { pathOf, recordsIn, type RecordRef } from './recordLinks';

/**
 * The cards a message's text calls for: every WorkSuite record it names,
 * each read for whoever is looking, with their own access — so a record
 * they cannot open says so, and one deleted since says that.
 */
export function RecordCards({ text }: { text: string | null | undefined }) {
  const origin = useStore(app, (s) => s.auth?.server?.origin);
  const refs = recordsIn(text, origin);
  if (!refs.length) return null;
  return (
    <div className="flex w-full flex-col gap-2 pt-1.5">
      {refs.map((r) => (
        <RecordCard key={'uuid' in r ? r.uuid : `${r.kind}-${r.id}`} r={r} />
      ))}
    </div>
  );
}

export function RecordCard({ r }: { r: RecordRef }) {
  const visible = useVisibleIds();
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
