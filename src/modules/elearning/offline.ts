import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { OfflineCourse } from '@shared/elearning-offline';
import { call, hasDesktop, on } from '../../core/bridge';
import { K } from './api';

/**
 * The courses kept on this computer for offline learning (the main process's
 * elearning-offline.ts), current as downloads move and copies are removed.
 */
export function useOfflineCourses(): { list: OfflineCourse[]; loading: boolean; refetch: () => void } {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: K.offline, queryFn: () => (hasDesktop() ? call('elearning:offlineList') : Promise.resolve([] as OfflineCourse[])), staleTime: 5_000 });
  useEffect(() => {
    const again = () => void qc.invalidateQueries({ queryKey: K.offline });
    const offs = [on('elearning:offlineChanged', again), on('transfers:changed', again)];
    return () => offs.forEach((off) => off());
  }, [qc]);
  return { list: q.data ?? [], loading: q.isLoading, refetch: () => void q.refetch() };
}

export function keptFile(list: OfflineCourse[], courseId: number, lessonId: number) {
  const c = list.find((x) => x.courseId === courseId);
  const f = c?.files.find((x) => x.lessonId === lessonId && x.state === 'done');
  return c && f ? { course: c, file: f } : null;
}
