import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../../core/api';

/**
 * People and departments to choose from when assigning learners or naming a
 * course's staff. The eLearning API has no lookup of its own (the server
 * resolves ids, e-mails and employee numbers and says who it could not):
 * people come from Chat's directory, as elsewhere in the app, and departments
 * from the Directory where the person may read it.
 */
export function usePeople(enabled = true) {
  return useQuery({
    queryKey: ['chat', 'directory'],
    queryFn: ({ signal }) => apiGet<{ users: Array<{ id: number; name: string; email?: string | null }> }>('/api/chat/directory', undefined, signal),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useDepartments(enabled = true) {
  return useQuery({
    queryKey: ['directory', 'departments'],
    queryFn: ({ signal }) => apiGet<Array<{ id: number; name: string }>>('/api/directory/departments', undefined, signal),
    staleTime: 5 * 60_000,
    retry: false,
    enabled,
  });
}
