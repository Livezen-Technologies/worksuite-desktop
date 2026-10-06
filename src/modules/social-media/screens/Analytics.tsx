import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Analytics() {
  return (
    <>
      <PageHeader crumb="Analytics" title="Analytics" />
      <PageBody>
        <NotOffered what="Analytics" />
      </PageBody>
    </>
  );
}
