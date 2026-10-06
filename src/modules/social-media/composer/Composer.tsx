import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Composer({ postId }: { postId: number | null }) {
  void postId;
  return (
    <>
      <PageHeader crumb="Create post" title="Create post" />
      <PageBody>
        <NotOffered what="Create post" />
      </PageBody>
    </>
  );
}
