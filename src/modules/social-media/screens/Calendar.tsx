import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Calendar() {
  return (
    <>
      <PageHeader crumb="Calendar" title="Calendar" />
      <PageBody>
        <NotOffered what="Calendar" />
      </PageBody>
    </>
  );
}
