import { useMemo } from 'react';
import { accountTags, type AccountTagInfo, type AccountTagMode } from './accountTags';
import { useMailboxes, useMailPrefs } from './api';

/** Every account's tag and how tags are drawn, for the places beside the list that show them (#227). */
export function useAccountTags(): { tags: Map<number, AccountTagInfo>; mode: AccountTagMode } {
  const boxes = useMailboxes().data?.mailboxes;
  const { prefs } = useMailPrefs();
  const own = prefs.accountTags;
  const tags = useMemo(() => accountTags(boxes ?? [], { accountTags: own }), [boxes, own]);
  return { tags, mode: prefs.accountTag ?? 'name' };
}
