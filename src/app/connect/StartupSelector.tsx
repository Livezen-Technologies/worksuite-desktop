import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AccountsState } from '@shared/accounts';
import type { CloudPlan } from '@shared/cloud';
import { app, cancelAdding, startAdding, updatePrefs } from '../../core/app-state';
import { call, errorMessage, on } from '../../core/bridge';
import { LANGUAGES, useLanguage } from '../../core/i18n';
import { backToGuest, enterGuestMode } from '../../core/session';
import { useStore } from '../../core/store';
import { toast } from '../../core/toasts';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { Button, cx } from '../../components/ui';
import { GuestJoinForm } from '../../modules/meet/GuestJoinForm';
import { storageLabel } from '../accounts/labels';
import { ConnectCard, ConnectFrame } from './ConnectFrame';

export interface StartupSelectorProps {
  accounts: AccountsState | null;
}

/** What the Personal card says Cloud's free plan holds when Cloud cannot be asked (offline, or no answer yet). */
export const DEFAULT_FREE_BYTES = 2 * 1024 ** 3;

type Choice = 'personal' | 'enterprise';

/** The free plan's storage from Cloud (`cloud:plans`): the plan named free, else the one without a price, else the smallest. */
export function freePlanBytes(plans: CloudPlan[] | null | undefined): number | null {
  if (!plans?.length) return null;
  const free = plans.find((p) => /free/i.test(p.id) || /free/i.test(p.name)) ?? plans.find((p) => !p.price) ?? [...plans].sort((a, b) => a.storage_bytes - b.storage_bytes)[0];
  return free && Number.isFinite(free.storage_bytes) && free.storage_bytes > 0 ? free.storage_bytes : null;
}

/**
 * Screen 1 — the startup selector: Personal (WorkSuite Cloud) or Enterprise. ← → choose a card, Enter continues with
 * it. The storage figure is Cloud's own (its free plan) when this computer is online. The footer: the language, use
 * WorkSuite without an account (guest mode) and Join a meeting. Add Account from inside the app shows it with Cancel.
 */
export function StartupSelector({ accounts }: StartupSelectorProps) {
  const language = useLanguage();
  const adding = useStore(app, (s) => s.session.adding ?? null);
  const fromGuest = useStore(app, (s) => s.session.mode === 'guest' && s.session.signingIn);
  const online = useStore(app, (s) => (s.status?.network ?? 'ONLINE') !== 'OFFLINE');
  const signedIn = useStore(app, (s) => s.auth?.stage === 'ready');
  const allowPersonal = accounts?.allowPersonal ?? true;
  const allowEnterprise = accounts?.allowAddEnterprise ?? true;
  const [choice, setChoice] = useState<Choice>(allowPersonal || !allowEnterprise ? 'personal' : 'enterprise');
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [joining, setJoining] = useState<{ input?: string; server?: string } | null>(null);
  const cards = useRef<Record<Choice, HTMLDivElement | null>>({ personal: null, enterprise: null });

  // Cloud's free plan, when online: the figure on the Personal card.
  useEffect(() => {
    if (!online || !allowPersonal) return;
    let live = true;
    call('cloud:plans').then(
      (plans) => live && setFreeBytes(freePlanBytes(plans)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [online, allowPersonal]);

  // A meeting link opened while nobody is signed in: Join a meeting, filled in (the same as Onboarding did).
  useEffect(() => {
    let mounted = true;
    const receive = (next: { input: string; server?: string } | null) => {
      if (mounted && next) setJoining(next);
    };
    void call('guest:pending').then(receive, () => undefined);
    const off = on('guest:destination', receive);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  useEffect(() => {
    cards.current[choice]?.focus();
    // Focus the chosen card once, on arrival: the keyboard starts here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allowed = (c: Choice) => (c === 'personal' ? allowPersonal : allowEnterprise);
  const go = (c: Choice) => {
    if (!allowed(c)) return;
    startAdding(c, adding?.prefill);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next: Choice = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 'personal' : 'enterprise';
      if (!allowed(next)) return;
      setChoice(next);
      cards.current[next]?.focus();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).getAttribute('role') === 'radio') {
      e.preventDefault();
      go(choice);
    }
  };

  const storage = storageLabel(freeBytes ?? DEFAULT_FREE_BYTES);
  const guestOk = (accounts?.guestAvailable ?? true) && !fromGuest;
  const footer = (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
      <Select label="Language" aria-label="Choose your language" value={language} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} onValueChange={(value) => void updatePrefs({ language: value }).catch((e) => toast('error', errorMessage(e)))} />
      {fromGuest ? (
        <button type="button" className="font-semibold text-primary hover:underline" onClick={backToGuest}>
          Back to your Local Profile
        </button>
      ) : null}
      {guestOk && !signedIn ? (
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void enterGuestMode().catch((e) => toast('error', errorMessage(e)))}>
          Use without an account
        </button>
      ) : null}
      {!signedIn ? (
        <button type="button" className="font-semibold text-primary hover:underline" onClick={() => setJoining({})}>
          Join a meeting
        </button>
      ) : null}
      {adding && signedIn ? (
        <button type="button" className="font-semibold text-primary hover:underline" onClick={cancelAdding}>
          Cancel
        </button>
      ) : null}
    </div>
  );

  if (joining)
    return (
      <ConnectFrame title="WorkSuite" footer={footer}>
        <ConnectCard width={480}>
          <GuestJoinForm key={joining.input} initialInput={joining.input} server={joining.server} onBack={() => setJoining(null)} />
        </ConnectCard>
      </ConnectFrame>
    );

  return (
    <ConnectFrame title="WorkSuite" footer={footer}>
      <div className="flex max-w-full flex-col items-center gap-9">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-brand text-white" aria-hidden>
            <Icon name="grid" size={28} />
          </span>
          <h1 id="startup-title" className="m-0 text-[32px] font-extrabold tracking-[-0.5px] text-ink">
            How would you like to use WorkSuite?
          </h1>
          <p className="m-0 text-[15px] text-ink-3">You can add more accounts later — this choice is never locked.</p>
        </div>
        <div role="radiogroup" aria-labelledby="startup-title" aria-describedby="startup-keys" className="flex flex-wrap justify-center gap-6" onKeyDown={onKey}>
          <ChoiceCard
            id="personal"
            refSet={(el) => (cards.current.personal = el)}
            selected={choice === 'personal'}
            disabled={!allowPersonal}
            disabledNote="Turned off by your organization on this computer."
            onSelect={() => setChoice('personal')}
            icon="cloud"
            title="Personal"
            subtitle={
              <>
                Use WorkSuite Cloud · <span className="font-mono">worksuitecloud.com</span>
              </>
            }
            points={['Free account', `${storage} cloud storage`, 'Cloud sync', 'Access from any device']}
            action="Continue with Personal"
            onContinue={() => go('personal')}
          />
          <ChoiceCard
            id="enterprise"
            refSet={(el) => (cards.current.enterprise = el)}
            selected={choice === 'enterprise'}
            disabled={!allowEnterprise}
            disabledNote="Your organization manages the server for this computer."
            onSelect={() => setChoice('enterprise')}
            icon="building"
            title="Enterprise"
            subtitle="Connect to your company's WorkSuite server"
            points={['Private infrastructure', 'Company-managed storage', 'Custom domain / server', 'Enterprise policies']}
            action="Connect to Enterprise"
            onContinue={() => go('enterprise')}
          />
        </div>
        <p id="startup-keys" className="m-0 text-[12px] text-ink-3">
          ← → to choose, Enter to continue
        </p>
      </div>
    </ConnectFrame>
  );
}

function ChoiceCard({
  id,
  refSet,
  selected,
  disabled,
  disabledNote,
  onSelect,
  icon,
  title,
  subtitle,
  points,
  action,
  onContinue,
}: {
  id: Choice;
  refSet: (el: HTMLDivElement | null) => void;
  selected: boolean;
  disabled: boolean;
  disabledNote: string;
  onSelect: () => void;
  icon: string;
  title: string;
  subtitle: ReactNode;
  points: string[];
  action: string;
  onContinue: () => void;
}) {
  return (
    <div
      ref={refSet}
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      aria-labelledby={`startup-${id}`}
      tabIndex={selected && !disabled ? 0 : -1}
      data-testid={`startup-${id}`}
      onClick={() => !disabled && onSelect()}
      className={cx(
        'flex w-[400px] max-w-full cursor-pointer flex-col gap-4 rounded-[16px] bg-surface p-7 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ws-focus)]',
        selected && !disabled ? 'border-2 border-primary shadow-[0_8px_24px_color-mix(in_srgb,var(--color-primary)_14%,transparent)]' : 'border border-line',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="flex items-center gap-3">
        <span className={cx('flex h-11 w-11 items-center justify-center rounded-[12px]', selected ? 'bg-selection text-primary' : 'bg-subtle text-ink-2')} aria-hidden>
          <Icon name={icon} size={22} />
        </span>
        <div>
          <div id={`startup-${id}`} className="text-[20px] font-bold text-ink">
            {title}
          </div>
          <div className="text-[13px] text-ink-3">{subtitle}</div>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-[9px] p-0 text-[14px] text-ink">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-2.5">
            <Icon name="check" size={16} className="text-success" />
            {p}
          </li>
        ))}
      </ul>
      {disabled ? <p className="m-0 text-[12.5px] text-warning">{disabledNote}</p> : null}
      <Button
        variant={selected ? 'primary' : 'secondary'}
        size="lg"
        tabIndex={-1}
        disabled={disabled}
        className={cx('mt-2 h-[46px] rounded-[10px] text-[15px]', !selected && 'border-primary text-primary')}
        onClick={(e) => {
          e.stopPropagation();
          onContinue();
        }}
      >
        {action}
      </Button>
    </div>
  );
}
