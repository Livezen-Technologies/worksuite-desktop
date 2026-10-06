import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Approvals({ postId }: { postId: number | null }) {
  void postId;
  return (
    <>
      <PageHeader crumb="Approvals" title="Approvals" />
      <PageBody>
        <NotOffered what="Approvals" />
      </PageBody>
    </>
  );
}
