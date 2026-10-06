import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTab } from '../../../core/tab-context';
import { Button, Empty, IconButton, Modal } from '../../../components/ui';
import { deleteSegment, exportSegmentCsv, MK, useSegments, type Segment } from '../api';
import { ago, count, day } from '../lib/format';
import { ruleSentence, rulesSummary } from '../lib/segment';
import { useMarketingOrg } from '../org';
import { Loaded, Mono, PageBody, PageHeader, saveCsv, TD, TH, Table, useAction } from '../parts';

/**
 * Segments (MKT-SEG-01..05; WF-04 step 1): the company's saved rule sets. A segment stores rules, never members, and is
 * counted again wherever it is used — at preview, at scheduling and at send (MKT-SEG-02). Each row opens the builder
 * (DK04) and exports the contacts it matches now as CSV (MKT-IMP-05, audited by the server).
 */
export default function Segments() {
  const org = useMarketingOrg();
  const { go } = useTab();
  const qc = useQueryClient();
  const segments = useSegments();
  const [busy, run] = useAction();
  const [deleting, setDeleting] = useState<Segment | null>(null);
  const titleId = useId();
  const open = (id: number) => go(`/marketing/segments/${id}`);
  const create = () => go('/marketing/segments/new');

  const exportCsv = (s: Segment) => run(`export-${s.id}`, async () => saveCsv(`${s.name} contacts`, await exportSegmentCsv(s.id)));

  const remove = async (s: Segment) => {
    const ok = await run('delete', () => deleteSegment(s.id), `Deleted the segment “${s.name}”.`);
    if (!ok) return;
    setDeleting(null);
    qc.removeQueries({ queryKey: MK.segment(org, s.id) });
    void qc.invalidateQueries({ queryKey: MK.segments(org) });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumb="Marketing / Audience"
        title="Segments"
        sub="Saved rule sets, re-evaluated every time they are used"
        actions={
          <Button variant="primary" icon="plus" onClick={create}>
            New segment
          </Button>
        }
      />
      <PageBody>
        <Loaded q={segments} what="Segments">
          {(rows) =>
            rows.length === 0 ? (
              <Empty
                icon="filter"
                title="No segments yet"
                hint="A segment is a set of rules — tag, consent, last open, organisation — counted again every time a campaign or call list uses it."
                action={
                  <Button variant="primary" icon="plus" onClick={create} className="mt-1">
                    New segment
                  </Button>
                }
              />
            ) : (
              <Table
                label="Segments"
                head={
                  <tr>
                    <th className={TH}>Segment</th>
                    <th className={TH}>Rules</th>
                    <th className={`${TH} text-right`}>Contacts</th>
                    <th className={TH}>Last used</th>
                    <th className={TH}>Updated</th>
                    <th className={TH}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                }
              >
                {rows.map((s) => {
                  const rules = s.rules ?? [];
                  const sentences = rules.map((r) => ruleSentence(r));
                  return (
                    <tr key={s.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => open(s.id)}>
                      <td className={`${TD} max-w-[420px]`}>
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-semibold text-ink hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            open(s.id);
                          }}
                        >
                          {s.name}
                        </button>
                        {sentences.length ? (
                          <div className="truncate text-[11.5px] text-ink-3" title={sentences.join('\n')}>
                            {sentences.slice(0, 2).join(' · ')}
                            {sentences.length > 2 ? ` · +${sentences.length - 2}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <Mono>{rulesSummary(rules, s.match)}</Mono>
                      </td>
                      <td className={`${TD} text-right`}>
                        <Mono>{count(s.count)}</Mono>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-ink-2`}>{s.last_used_at ? ago(s.last_used_at) || '—' : 'Not yet'}</td>
                      <td className={`${TD} whitespace-nowrap text-ink-2`}>{day(s.updated_at)}</td>
                      <td className={`${TD} whitespace-nowrap text-right`}>
                        <span className="inline-flex items-center gap-0.5">
                          <IconButton
                            icon="download"
                            label={`Export “${s.name}” as CSV`}
                            disabled={busy === `export-${s.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void exportCsv(s);
                            }}
                          />
                          <IconButton
                            icon="trash"
                            label={`Delete “${s.name}”`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleting(s);
                            }}
                          />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )
          }
        </Loaded>
      </PageBody>
      {deleting ? (
        <Modal
          title="Delete segment"
          labelledBy={titleId}
          width={440}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="danger" icon="trash" loading={busy === 'delete'} onClick={() => void remove(deleting)}>
                Delete segment
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">
            Delete <b className="text-ink">“{deleting.name}”</b> and its rules? No contact changes, and lists saved from it are kept.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
