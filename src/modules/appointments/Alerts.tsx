import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTab } from '../../core/tab-context';
import { toast } from '../../core/toasts';
import { Button, cx } from '../../components/ui';
import { act, fetchCentre, type Notice } from '../notifications/api';
import { errText, Head, Section } from './parts';

/**
 * D22 · Notifications: the person's WorkSuite notifications about appointments (new online bookings, deposits due,
 * arrivals, failed messages), from the notification centre, newest first. Open goes where the notice points — an
 * appointment opens in its panel here. The system toast and the tray are the desktop's own notification service.
 */
const ours = (n: Notice) => (n.event ?? '').startsWith('appointment') || (n.category ?? '') === 'appointments' || (n.link ?? '').startsWith('/appointments');

export default function Alerts() {
  const { openLink } = useTab();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['appointments', 'alerts'], queryFn: ({ signal }) => fetchCentre({ view: 'inbox', perPage: 100 }, signal), refetchInterval: 60_000 });
  const list = (q.data?.notifications ?? []).filter(ours);
  const unread = list.filter((n) => !n.read);
  const read = async (ids: number[]) => {
    try {
      for (const id of ids) await act(id, 'read');
      void qc.invalidateQueries({ queryKey: ['appointments', 'alerts'] });
    } catch (e) {
      toast('error', errText(e));
    }
  };
  return (
    <div className="max-w-[860px]">
      <Head title="Notifications" sub="About appointments, newest first.">
        <Button variant="secondary" disabled={!unread.length} onClick={() => void read(unread.map((n) => n.id))}>Mark all read</Button>
      </Head>
      <Section>
        <ul className="m-0 list-none p-0">
          {list.map((n) => (
            <li key={n.id} className={cx('flex items-start gap-3 border-b border-line/70 px-4 py-3', !n.read && 'bg-[#F6F8FE] dark:bg-selection/40')}>
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-ink">{n.title}</div>
                {n.body ? <div className="text-[12.5px] text-ink-2">{n.body}</div> : null}
                <div className="mt-0.5 text-[11.5px] text-ink-3">{new Date(n.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              {n.link ? <Button size="sm" variant="secondary" onClick={() => (void read([n.id]), openLink(n.link))}>Open</Button> : null}
            </li>
          ))}
          {!list.length ? <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">{q.isPending ? 'Reading…' : q.isError ? errText(q.error) : 'Nothing about appointments.'}</li> : null}
        </ul>
      </Section>
    </div>
  );
}
