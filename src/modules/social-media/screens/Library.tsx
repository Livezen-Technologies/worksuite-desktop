import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Library() {
  return (
    <>
      <PageHeader crumb="Content library" title="Content library" />
      <PageBody>
        <NotOffered what="Content library" />
      </PageBody>
    </>
  );
}
