import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, ErrorNote, Spinner, cx } from '../../components/ui';
import { toast } from '../../core/toasts';
import { input, Section } from '../../components/FormKit';
import { PageHead } from '../../components/PageKit';
import { errorText, K, newKey, pGet, pPost, type GuestHit, type GuestProfile } from './api';
import GuestPick from './GuestPick';
import { NoAccess, usePms, VipPill } from './parts';

/**
 * Guest lookup at the desk (§7): the company's guests and the CRM contacts
 * who have never stayed, by name, email or phone. A guest opens their
 * profile; a CRM contact gets a hospitality profile when someone who may edit
 * guests asks. A new guest is checked for duplicates first (AC-05).
 */
export default function Guests() {
  const pms = usePms();
  const org = pms.property.org_id;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const hits = useQuery({ queryKey: K.guests(org, q), queryFn: ({ signal }) => pGet<{ items: GuestHit[] }>('/guests', { q, org, limit: 40 }, signal), enabled: q.length >= 2 });

  if (!pms.may('pms.guest.view')) return <NoAccess what="Guests are shown to people who may see them (“See guests”)." />;
  const profile = async (h: GuestHit) => {
    try {
      const r = await pPost<{ id: number; guest: GuestProfile }>('/guests', { org_id: org, property_id: pms.property.id, client_id: h.client_id }, newKey('guest'));
      pms.open({ kind: 'guest', id: r.data.id ?? r.data.guest.id });
    } catch (e) {
      toast('error', errorText(e, 'The profile was not made.'));
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <PageHead title="Guests" sub="Guests and CRM contacts of the company">
        <input className={cx(input, 'w-72')} autoFocus placeholder="Name, email or phone" aria-label="Find a guest" value={text} onChange={(e) => setText(e.target.value)} />
        {pms.may('pms.guest.edit') ? (
          <Button icon="user-plus" disabled={!pms.online} onClick={() => setAdding(!adding)}>
            New guest
          </Button>
        ) : null}
      </PageHead>
      {adding ? (
        <Section title="New guest">
          <GuestPick picked={null} startAdding onPick={(g) => g && pms.open({ kind: 'guest', id: g.id })} />
        </Section>
      ) : null}
      {q.length < 2 ? (
        <p className="text-[13px] text-ink-3">Type two letters or more.</p>
      ) : hits.isLoading ? (
        <Spinner />
      ) : hits.error ? (
        <ErrorNote error={hits.error} />
      ) : (hits.data?.items ?? []).length === 0 ? (
        <p className="text-[13px] text-ink-3">Nobody found.</p>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <table className="w-full text-left text-[13px]">
            <tbody>
              {hits.data!.items.map((h) => (
                <tr key={h.client_id} className="border-t border-line first:border-t-0">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <b>{h.name}</b> <VipPill level={h.vip_level} />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{[h.email, h.phone].filter(Boolean).join(' · ')}</td>
                  <td className="px-3 py-2 text-right">
                    {h.guest_id ? (
                      <Button size="sm" onClick={() => pms.open({ kind: 'guest', id: h.guest_id! })}>
                        Profile
                      </Button>
                    ) : pms.may('pms.guest.edit') ? (
                      <Button size="sm" variant="ghost" disabled={!pms.online} onClick={() => void profile(h)}>
                        Make a guest profile
                      </Button>
                    ) : (
                      <span className="text-[12px] text-ink-3">CRM contact</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
