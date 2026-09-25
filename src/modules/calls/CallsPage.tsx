import type { ModuleProps } from '../registry';
import { useTab } from '../../core/tab-context';
import { Empty } from '../../components/ui';
import { CallScreen } from './CallScreen';
import { RingScreen } from './RingScreen';

/** Calls live in their own windows: the ring (`/calls/ring`) and the call itself (`/calls/call`). */
export default function CallsPage(_props: ModuleProps) {
  const { path } = useTab();
  if (path[1] === 'ring') return <RingScreen />;
  if (path[1] === 'call') return <CallScreen />;
  return <Empty icon="phone" title="Calls open in their own window" hint="Start one from a conversation in Chat." />;
}
