import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Button, cx } from '../../components/ui';
import { SLUG_MAX, linkLabel, why, type PersonalRoomView } from '@shared/personal-room';
import { openMeeting } from './api';

/**
 * Your own room, on Meet home (WS-MEET-ENH-01 D01).
 *
 * One address you give out once and keep: `…/meet/hasarinda` rather than a
 * fresh link per meeting. The server mints it on the first ask — from the
 * person's own name, numbered if somebody got there first — so this card does
 * not decide what anybody is called.
 *
 * **Renaming says what it costs before it happens.** A vanity address is a
 * thing other people have written down, so the old link stops working the
 * moment a new name is taken, and the name somebody gives up becomes free for
 * the next person. Both are stated on screen rather than discovered.
 *
 * A deployment whose database has not taken the columns yet answers 503, and
 * the card then draws nothing at all: an empty card offering a link that
 * cannot exist would be worse than no card.
 */
export function PersonalRoomCard({ copy }: { copy: (value: string, what: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['meet', 'personal'],
    queryFn: ({ signal }) => apiGet<PersonalRoomView>('/api/meet/personal', undefined, signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [renaming, setRenaming] = useState(false);
  const [wanted, setWanted] = useState('');
  const room = q.data;
  const local = renaming ? why(wanted) : '';
  const rename = useMutation({
    mutationFn: (slug: string) => apiPut<{ slug: string }>('/api/meet/personal', { slug }),
    onSuccess: async () => {
      toast('success', 'Your room has a new name. The old link stops working.');
      setRenaming(false);
      await qc.invalidateQueries({ queryKey: ['meet', 'personal'] });
    },
    // The server has the last word on a name, including one taken a moment ago.
    onError: (e) => toast('error', errorMessage(e)),
  });

  /*
   * Nothing at all until the room is known: no skeleton, no spinner.
   *
   * A server mid-upgrade answers 503 and a card that had already drawn itself
   * would appear and then vanish — a flash of a feature this deployment does
   * not have. The card is small and the answer is fast; arriving a moment late
   * is better than arriving wrong.
   *
   * A room is only a room once it has the two things the card is made of. An
   * older server, or a proxy that answers 200 with something else, hands back
   * an object with neither — and a card built from that would draw a Copy
   * button for an empty link.
   */
  if (!room?.uuid || !room.url) return null;

  return (
    <section aria-label="Your personal room" className="flex min-w-0 flex-col gap-2 rounded-[14px] border border-line bg-surface px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-selection text-primary">
          <Icon name="user" size={16} />
        </span>
        <h2 className="flex-1 text-[15.5px] font-bold text-ink">Your personal room</h2>
        {!renaming ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setWanted(room.slug);
              setRenaming(true);
            }}
          >
            {room.slug ? 'Rename' : 'Choose a name'}
          </Button>
        ) : null}
      </div>

      {!renaming ? (
        <>
          <p className="text-[12.5px] text-ink-2">Always the same address. Give it out once; it works whenever you are in it.</p>
          <div className="flex min-w-0 items-center gap-2 rounded-[10px] border border-line bg-ground px-3 py-2">
            <Icon name="link" size={14} className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink select-all">{linkLabel(room.url)}</span>
          </div>
          {!room.slug ? (
            <p className="text-[12px] text-ink-3">Every name close to yours was taken, so this is the room&rsquo;s ID. Choose a name to make it readable.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="video" onClick={() => void openMeeting(room.uuid, room.title)}>
              Start
            </Button>
            <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(room.url, 'Your room link')}>
              Copy link
            </Button>
            {room.locked ? (
              <span className="flex items-center gap-1.5 self-center text-[12px] text-warning">
                <Icon name="lock" size={13} /> Locked — nobody new can join
              </span>
            ) : null}
          </div>
        </>
      ) : null}

      {renaming ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!local && wanted.trim()) rename.mutate(wanted.trim().toLowerCase());
          }}
        >
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-ink">
            The name in your link
            <span className="flex min-w-0 items-center gap-1 rounded-[10px] border border-line bg-ground px-2.5 py-2 font-mono text-[12.5px] focus-within:border-primary">
              <span className="shrink-0 truncate text-ink-3">{linkLabel(room.url).replace(/\/[^/]*$/, '/')}</span>
              <input
                autoFocus
                value={wanted}
                onChange={(e) => setWanted(e.target.value.toLowerCase())}
                maxLength={SLUG_MAX}
                aria-label="The name in your link"
                aria-invalid={!!local}
                className="min-w-0 flex-1 bg-transparent text-ink outline-none"
              />
            </span>
          </label>
          {local ? (
            <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
              <Icon name="alert" size={13} className="mt-0.5" /> {local}
            </p>
          ) : (
            <p className="text-[12px] text-ink-3">
              Anybody who has your old link will not reach you after this, and the name you give up becomes free for somebody else.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!!local || !wanted.trim() || wanted.trim().toLowerCase() === room.slug} loading={rename.isPending}>
              Use this name
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

/**
 * Rejoin the meeting you were last in (D07), when there is one.
 *
 * Only a meeting nobody has ended, and only from the last day: this is for the
 * laptop that slept and the window closed by accident, not for yesterday's
 * call, and a button that cannot work would be worse than no button.
 */
export function RejoinCard({ meeting, onRejoin }: { meeting: { uuid: string; title: string | null } | null; onRejoin?: () => void }) {
  if (!meeting) return null;

  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-primary/40 bg-selection px-4 py-3')}>
      <Icon name="video" size={16} className="text-primary" />
      <span className="flex min-w-0 flex-col">
        <b className="truncate text-[13.5px] text-ink">{meeting.title || 'Your last meeting'}</b>
        <span className="text-[12px] text-ink-2">Still open — you can go straight back in.</span>
      </span>
      <span className="flex-1" />
      <Button
        size="sm"
        icon="arrow-right"
        onClick={() => {
          void openMeeting(meeting.uuid, meeting.title);
          onRejoin?.();
        }}
      >
        Rejoin
      </Button>
    </div>
  );
}
