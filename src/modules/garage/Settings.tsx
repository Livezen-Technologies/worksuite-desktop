import { useState } from 'react';
import { ModuleSettingsForm } from '../../components/ModuleSettingsForm';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { btn, PageHead } from '../hr/parts';
import { companiesWhere, type Options } from './api';

/**
 * Garage settings (SRS §25): the company's own facts in WorkSuite's standard
 * settings (group `garage`, per company) — job numbering, the distance unit,
 * what a check-in must record and how many photos, the areas it covers, the
 * diagnosis sign-off, media sizes — drawn from the server's field list, so a
 * setting added there appears here without a desktop release. Branches,
 * workshops, bays, technicians, labour rates and service types are records,
 * kept in Set-up.
 */
export default function Settings({ org, options, onSetup }: { org: string; options: Options; onSetup: () => void }) {
  const companies = companiesWhere(options, 'settings', org);
  const [picked, setPicked] = useState<string>('');
  const company = companies.find((c) => String(c.id) === picked) ?? companies[0];
  if (!company) return <p className="m-6 text-[13px] text-ink-2">Settings are for those who may set Garage up.</p>;
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Settings" sub={`For ${company.name}. Each company keeps its own.`}>
        {companies.length > 1 ? <Select label="Company" value={String(company.id)} onValueChange={setPicked} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /> : null}
        <button type="button" className={btn} onClick={onSetup}>
          <Icon name="list-todo" size={15} /> Branches, bays and rates
        </button>
      </PageHead>
      <ModuleSettingsForm key={company.id} slug="garage" section="general" org={String(company.id)} queryKey={['garage', 'module-settings', company.id]} note={`Changes apply to ${company.name}.`} readOnly="You can read these settings; changing them needs garage.settings.manage." />
    </div>
  );
}
