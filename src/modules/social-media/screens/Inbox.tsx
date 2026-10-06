import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Inbox({ threadId }: { threadId: number | null }) {
  void threadId;
  return (
    <>
      <PageHeader crumb="Inbox" title="Inbox" />
      <PageBody>
        <NotOffered what="Inbox" />
      </PageBody>
    </>
  );
}
