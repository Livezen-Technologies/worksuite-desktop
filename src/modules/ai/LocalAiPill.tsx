import { localReady, useLocalModels } from '../../core/local-ai';
import { navigate } from '../../core/tabs';
import { Icon } from '../../components/Icon';
import { cx } from '../../components/ui';

/**
 * "Local AI ready" in the sidebar's footer (WS-SRS-LAI, boards D01–D06): the
 * one place outside Settings that says a model is on this computer, which
 * model it is, and that it therefore answers without a connection.
 *
 * IT SHOWS NOTHING UNLESS LOCAL AI CAN ACTUALLY ANSWER. Readiness here means
 * what `localReady` means — installed, chosen, and not failing or still in its
 * readiness check — so the strip cannot promise offline answers on a computer
 * that would fall back online the moment somebody asked. There is deliberately
 * no "not ready" state either: a person who has never set Local AI up is
 * offered it by the assistant when they first open it, and a permanent strip
 * advertising an absence would be noise in a sidebar that has to stay
 * readable. The same reason it is hidden when the sidebar is collapsed: at
 * icon width there is no room for the model's name, and a bare dot would say
 * something nobody could read.
 */
export function LocalAiPill({ collapsed }: { collapsed: boolean }) {
  const models = useLocalModels(!collapsed);
  const ready = localReady(models.data);
  if (collapsed || !ready) return null;
  return (
    <button
      type="button"
      onClick={() => navigate('/settings/local-ai')}
      className={cx('mb-1 flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left hover:bg-white/8')}
    >
      <Icon name="sparkles" size={16} className="shrink-0 text-success" />
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold text-white">Local AI ready</span>
        <span className="block truncate text-[11.5px] text-navy-ink/70">{ready.model.name} · works offline</span>
      </span>
    </button>
  );
}
