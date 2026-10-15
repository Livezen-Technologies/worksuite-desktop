import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGet } from '../../core/api';
import { call } from '../../core/bridge';
import { Icon } from '../../components/Icon';
import { ModuleSettingsForm, type ModuleSettings } from '../../components/ModuleSettingsForm';
import { Select } from '../../components/Select';
import { cx } from '../../components/ui';
import { input, PageHead } from '../hr/parts';
import { warehouses } from './api';
import Channels from './Channels';
import Printers from './Printers';
import { KM } from './manage';

/**
 * Orders settings (OmsSettings, OmsChannelSheet): the general defaults a new
 * order starts with — drawn from the server's field list, so a new setting
 * appears here without a desktop release — the advanced ones for those who
 * may see them, and the sales channels. Who may do what, screens,
 * notifications and the history are the installation's settings shell,
 * which opens in the browser (marked). Printers are this computer's: which
 * printer takes labels and which delivery notes (FR-DSK-06, FR-LBL-06).
 */
type Section = 'general' | 'advanced' | 'channels' | 'printers' | 'access' | 'screens' | 'organization' | 'notifications' | 'history' | 'changelog';

const NAV: Array<{ id: Section; label: string; native?: boolean }> = [
  { id: 'general', label: 'General', native: true },
  { id: 'access', label: 'User Access' },
  { id: 'screens', label: 'Screens & components' },
  { id: 'organization', label: 'Organization' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'advanced', label: 'Advanced', native: true },
  { id: 'channels', label: 'Sales Channels', native: true },
  { id: 'printers', label: 'Printers', native: true },
  { id: 'history', label: 'History' },
  { id: 'changelog', label: 'Change log' },
];

export default function Settings({ org, section: asked }: { org: string; section?: string | null }) {
  const [section, setSection] = useState<Section>(asked === 'channels' || asked === 'advanced' || asked === 'printers' ? asked : 'general');
  const spec = useQuery({ queryKey: KM.settings, queryFn: ({ signal }) => apiGet<ModuleSettings>('/api/module-settings/oms', undefined, signal) });
  const advanced = (spec.data?.spec.advanced ?? []).length > 0;
  const houses = useQuery({ queryKey: ['sales', 'warehouses'], queryFn: ({ signal }) => warehouses(signal), staleTime: 300_000 });
  const nav = NAV.filter((n) => n.id !== 'advanced' || advanced);

  return (
    <div className="flex flex-col gap-3.5 px-6 py-5">
      <PageHead title="Settings" sub="Orders" />
      <div className="flex items-start gap-3.5">
        <nav aria-label="Settings sections" className="flex w-[200px] shrink-0 flex-col gap-0.5">
          {nav.map((n) => {
            const on = n.native && section === n.id;
            return (
              <button
                key={n.id}
                type="button"
                aria-current={on ? 'page' : undefined}
                title={n.native ? n.label : `${n.label} — opens in your browser`}
                onClick={() => (n.native ? setSection(n.id) : void call('app:openInBrowser', { path: '/oms' }))}
                className={cx('flex h-8 items-center gap-2 rounded-[8px] px-2.5 text-left text-[13px]', on ? 'bg-[#EAEDFB] font-bold text-[#1B2A85] dark:bg-selection dark:text-primary' : 'font-medium text-ink hover:bg-subtle')}
              >
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
                {n.native ? null : <Icon name="external" size={12} className="shrink-0 text-ink-3" />}
              </button>
            );
          })}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {section === 'general' || section === 'advanced' ? (
            <ModuleSettingsForm
              slug="oms"
              section={section}
              queryKey={KM.settings}
              note="A new order starts with these. Orders from a shop or an API bring their own."
              readOnly="You can read these settings; changing them needs Orders settings."
              custom={{
                // Stored as a warehouse's id; chosen from the warehouses by name.
                oms_default_warehouse: ({ value, onChange, disabled, label }) => (
                  <Select<string>
                    aria-label={label}
                    searchable
                    disabled={disabled}
                    value={value}
                    onValueChange={onChange}
                    options={[{ value: '', label: 'None — each order names its own' }, ...(houses.data ?? []).map((h) => ({ value: String(h.id), label: h.name, hint: h.code ?? undefined }))]}
                    className={input}
                  />
                ),
              }}
            />
          ) : null}
          {section === 'channels' ? <Channels org={org} /> : null}
          {section === 'printers' ? <Printers /> : null}
        </div>
      </div>
    </div>
  );
}
