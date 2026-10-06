import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Accounts() {
  return (
    <>
      <PageHeader crumb="Accounts" title="Accounts" />
      <PageBody>
        <NotOffered what="Accounts" />
      </PageBody>
    </>
  );
}
