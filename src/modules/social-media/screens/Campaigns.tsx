import { NotOffered, PageBody, PageHeader } from '../parts';

export default function Campaigns({ campaignId }: { campaignId: number | null }) {
  void campaignId;
  return (
    <>
      <PageHeader crumb="Campaigns" title="Campaigns" />
      <PageBody>
        <NotOffered what="Campaigns" />
      </PageBody>
    </>
  );
}
