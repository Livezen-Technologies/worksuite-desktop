import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Queue() {
  return (
    <>
      <PageHeader crumb="Queue & posting slots" title="Queue & posting slots" />
      <PageBody>
        <NotOffered what="Queue & posting slots" />
      </PageBody>
    </>
  );
}
