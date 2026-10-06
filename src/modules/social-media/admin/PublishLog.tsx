import { NotOffered, PageBody, PageHeader } from '../parts';

export default function PublishLog() {
  return (
    <>
      <PageHeader crumb="Publishing log" title="Publishing log" />
      <PageBody>
        <NotOffered what="Publishing log" />
      </PageBody>
    </>
  );
}
