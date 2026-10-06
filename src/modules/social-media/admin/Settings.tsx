import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Settings({ section }: { section: string | null }) {
  void section;
  return (
    <>
      <PageHeader crumb="Module settings" title="Module settings" />
      <PageBody>
        <NotOffered what="Module settings" />
      </PageBody>
    </>
  );
}
