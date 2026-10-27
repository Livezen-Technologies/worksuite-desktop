import { ModuleSettingsForm } from '../../../components/ModuleSettingsForm';
import { PageHead } from '../../../components/PageKit';
import { useEl } from '../parts';

/**
 * eLearning's settings (§11), per company, in WorkSuite's standard settings
 * for the module (`/api/module-settings/elearning`): language and levels,
 * review before publishing, self-enrolment and withdrawal, due dates, the
 * fastest credited playback and the idle gap, offline copies, pass marks and
 * attempts, submitted files and late work, reminders. Drawn from the server's
 * field list, so a setting added there appears here without a desktop release.
 */
export default function Settings() {
  const el = useEl();
  const company = el.options.companies.find((c) => String(c.id) === el.org)?.name ?? 'this company';
  return (
    <div className="flex flex-col gap-3 px-6 py-5">
      <PageHead title="Settings" sub={`For ${company}. Each company keeps its own.`} />
      <ModuleSettingsForm key={el.org} slug="elearning" section="general" org={el.org} queryKey={['elearning', 'module-settings', el.org]} note={`Changes apply to ${company}.`} readOnly="You can read these settings; changing them needs elearning.settings.manage." />
    </div>
  );
}
