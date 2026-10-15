import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { app } from '../../core/app-state';
import { ApiError, apiDelete, apiGet, apiPut } from '../../core/api';
import { errorMessage } from '../../core/bridge';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Button, Modal } from '../../components/ui';
import { Select } from '../../components/Select';
import { createTask, patchTask } from './actions';
import { PRIORITIES, STATUSES, type TaskDetail as Detail, type TaskList } from './api';
import { TaskReminders } from './Reminders';
import { PeoplePanel, ReviewPanel, usePeople } from './People';
import { Assignee, Attachments, Checklist, Conversation, Description, Organisation, Progress, Row, TaskEditorFrame, Tags, Title, When, aside, inputsOf, useSaving } from './editor';

/**
 * A task (TaskDetail): everything about it on the left, its settings and
 * people on the right. Each change saves as it is made, and only what this
 * person may change is offered (the server's `can_edit`).
 */
export function TaskDetail({ id, lists, onClose, onOpen }: { id: number; lists: TaskList[]; onClose: () => void; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const me = Number(useStore(app, (s) => s.auth?.user?.id) ?? 0);
  const origin = useStore(app, (s) => s.auth?.server?.origin ?? '');
  const detail = useQuery({ queryKey: ['tasks', 'detail', id], queryFn: ({ signal }) => apiGet<Detail>(`/api/tasks/${id}`, undefined, signal), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const people = usePeople(id);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const t = detail.data;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const saver = useSaving(refresh);
  const save = async (field: string, value: unknown, label: string) => {
    if (!t) return;
    await saver.run(() => patchTask(t, field, value, label));
  };

  const canEdit = (f: keyof Detail['can_edit']) => !!t?.can_edit?.[f];
  const worker = !!t && (t.owner_id === me || t.assignee_id === me);
  const list = t?.list_id ? lists.find((l) => l.id === t.list_id) : undefined;

  return (
    <TaskEditorFrame
      crumb={
        <>
          <span className="truncate text-ink-3">{list ? `${list.name} ›` : 'Tasks ›'}</span>
          <span className="shrink-0 font-mono text-[12px] text-ink-3">{t?.task_key ?? `TASK-${id}`}</span>
        </>
      }
      saving={t ? saver.saving : null}
      saved={saver.saved}
      loading={detail.isLoading}
      error={detail.error}
      onRetry={() => void detail.refetch()}
      onClose={onClose}
      actions={
        <>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(`${origin}/tasks?task=${id}`).then(() => toast('success', 'Link copied.'))}>Copy link</Button>
          {t && worker ? (
            <span className="relative">
              <Button size="sm" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</Button>
              {menu ? (
                <div role="menu" className="absolute top-9 right-0 z-30 w-44 rounded-[10px] border border-line bg-surface py-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-subtle" onClick={() => {
                    setMenu(false);
                    void createTask({ title: `${t.title} (copy)`, description: t.description ?? '', status: t.status === 'done' ? 'todo' : t.status, priority: t.priority, assignee_id: t.assignee_id, list_id: t.list_id, org_id: t.org_id, tags: t.tags, ...(t.due_at ? { due_date: t.due_at } : t.due_date ? { due_date: t.due_date } : {}) }).then((r) => {
                      toast('success', 'Duplicated.');
                      refresh();
                      if (r.id) onOpen(r.id);
                    }, (e) => toast('error', errorMessage(e)));
                  }}>Duplicate</button>
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-subtle" onClick={() => {
                    setMenu(false);
                    void apiPut(`/api/tasks/${id}`, { archived: true }).then(() => (toast('success', 'Archived.'), refresh(), onClose()), (e) => toast('error', errorMessage(e)));
                  }}>Archive</button>
                  <button type="button" role="menuitem" className="block w-full px-3 py-1.5 text-left text-danger hover:bg-subtle" onClick={() => (setMenu(false), setDeleting(true))}>Delete…</button>
                </div>
              ) : null}
            </span>
          ) : null}
          {t && canEdit('status') ? (
            t.status === 'done' ? (
              <Button size="sm" onClick={() => void save('status', 'todo', `Reopen “${t.title}”`).then(() => (!t.checklist.length && t.progress === 100 ? save('progress', 0, `Progress of “${t.title}”`) : undefined))}>Reopen</Button>
            ) : (
              <button type="button" onClick={() => void save('status', 'done', `Complete “${t.title}”`)} className="h-8 rounded-[7px] bg-success px-3 font-bold text-white hover:opacity-90">Complete</button>
            )
          ) : null}
        </>
      }
      main={
        t ? (
          <>
            <Title key={`t${t.id}`} value={t.title} editable={canEdit('title')} onSave={(v) => void save('title', v, `Rename to “${v}”`)} />
            <Description key={`d${t.id}${t.updated_at}`} task={t} editable={canEdit('description')} onSave={(html) => void save('description', html, `Describe “${t.title}”`)} />
            <Checklist task={t} editable={canEdit('checklist')} onChanged={refresh} />
            <Attachments task={t} editable={worker || canEdit('description')} />
            <Conversation task={t} me={me} people={people.data} emoji={emoji} setEmoji={setEmoji} onChanged={refresh} />
          </>
        ) : null
      }
      side={
        t ? (
          <>
            <Row label="Status">
              <Select aria-label="Status" disabled={!canEdit('status')} value={t.status} onChange={(e) => void save('status', e.target.value, `Status of “${t.title}”`)} className={aside}>
                {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Row>
            <Row label="Priority">
              <Select aria-label="Priority" disabled={!canEdit('priority')} value={t.priority} onChange={(e) => void save('priority', e.target.value, `Priority of “${t.title}”`)} className={aside}>
                {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Row>
            <Row label="Assignee">
              <Assignee value={t.assignee_id} name={t.assignee_name} me={me} disabled={!canEdit('assignee_id')} onChange={(v) => void save('assignee_id', v, `Assign “${t.title}”`)} />
            </Row>
            <Row label="Start date">
              <When key={`s${t.start_at}${t.start_date}`} value={inputsOf(t.start_date, t.start_at)} disabled={!canEdit('start_date')} label="Start" onChange={(v) => void save('start_date', v, `Start of “${t.title}”`)} />
            </Row>
            <Row label="Due date">
              <When key={`u${t.due_at}${t.due_date}`} value={inputsOf(t.due_date, t.due_at)} disabled={!canEdit('due_date')} label="Due" onChange={(v) => void save('due_date', v, `Due date of “${t.title}”`)} />
            </Row>
            <TaskReminders task={t} />
            <Row label="List">
              <Select aria-label="List" disabled={!canEdit('list_id')} value={t.list_id ?? ''} onChange={(e) => void save('list_id', e.target.value ? Number(e.target.value) : '', `List of “${t.title}”`)} className={aside}>
                <option value="">No list</option>
                {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                {t.list_id && !list ? <option value={t.list_id}>Someone else's list</option> : null}
              </Select>
            </Row>
            <Row label="Organisation">
              <Organisation value={t.org_id} name={t.org_name} disabled={!canEdit('org_id')} onChange={(v) => void save('org_id', v, `Company of “${t.title}”`)} />
            </Row>
            <Row label="Tags">
              <Tags key={`g${t.tags.join()}`} value={t.tags} disabled={!canEdit('tags')} onChange={(v) => void save('tags', v, `Tags of “${t.title}”`)} />
            </Row>
            <Progress task={t} editable={canEdit('progress')} onSave={(v) => void save('progress', v, `Progress of “${t.title}”`)} />
            <PeoplePanel task={t} me={me} people={people.data} refresh={() => (void people.refetch(), refresh())} />
            <ReviewPanel task={t} me={me} people={people.data} refresh={() => (void people.refetch(), refresh())} />
          </>
        ) : null
      }
    >
      {deleting && t ? (
        <Modal
          title={`Delete “${t.title}”?`}
          onClose={() => setDeleting(false)}
          width={420}
          footer={
            <>
              <Button onClick={() => setDeleting(false)}>Keep it</Button>
              <Button variant="danger" onClick={() => void apiDelete(`/api/tasks/${id}`).then(() => (toast('success', 'Task deleted.'), refresh(), onClose()), (e) => toast('error', errorMessage(e)))}>Delete</Button>
            </>
          }
        >
          <p className="text-[13px] text-ink-2">It goes for everybody on it, with its checklist and comments.</p>
        </Modal>
      ) : null}
    </TaskEditorFrame>
  );
}
