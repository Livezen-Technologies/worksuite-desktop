import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../../core/api';

/** People and departments the admin screens pick from (the same directory every module uses). */
export interface Person {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
}

export function usePeople(enabled = true) {
  return useQuery({
    queryKey: ['phone', 'people'],
    queryFn: ({ signal }) => apiGet<Person[]>('/api/contacts/directory', undefined, signal).then((r) => (Array.isArray(r) ? r : [])),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDepartments(enabled = true) {
  return useQuery({
    queryKey: ['phone', 'departments'],
    queryFn: ({ signal }) => apiGet<Array<{ id: number; name: string }>>('/api/directory/departments', undefined, signal).then((r) => (Array.isArray(r) ? r : [])),
    enabled,
    staleTime: 5 * 60_000,
  });
}
