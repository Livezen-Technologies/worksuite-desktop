import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Overview() {
  return (
    <>
      <PageHeader crumb="Overview" title="Overview" />
      <PageBody>
        <NotOffered what="Overview" />
      </PageBody>
    </>
  );
}
