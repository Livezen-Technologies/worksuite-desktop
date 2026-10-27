import { ModuleSettingsForm } from '../../components/ModuleSettingsForm';
import { Button } from '../../components/ui';
import { PageHead } from '../../components/PageKit';
import { useGarage } from './parts';

/**
 * Garage settings (§25, FR-SET-01): the company's own, in WorkSuite's standard
 * settings for the module (`/api/module-settings/garage`, per company) —
 * numbering, units, what a check-in must record and how many photos, the
 * areas, the diagnosis sign-off, discounts and approval links, QC, road
 * tests, warranty, notifications — drawn from the server's field list, so a
 * setting added there appears here without a desktop release. Branches,
 * bays, technicians, rates and service types are records, kept in Workshop.
 */
export default function Settings() {
  const g = useGarage();
  const company = g.options.companies.find((c) => String(c.id) === g.org)?.name ?? 'this company';
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Settings" sub={`For ${company}. Each company keeps its own.`}>
        <Button icon="wrench" onClick={() => g.go('workshop')}>
          Bays, technicians and rates
        </Button>
      </PageHead>
      <ModuleSettingsForm key={g.org} slug="garage" section="general" org={g.org} queryKey={['garage', 'module-settings', g.org]} note={`Changes apply to ${company}.`} readOnly="You can read these settings; changing them needs garage.settings.manage." />
    </div>
  );
}
