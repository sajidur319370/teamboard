import { useSyncExternalStore } from 'react';
import { WifiOffIcon } from 'lucide-react';
import { getSocket } from './client';

export type ConnectionState = 'connecting' | 'online' | 'offline';

let everConnected = false;

function subscribe(onChange: () => void) {
  const s = getSocket();
  const onConnect = () => {
    everConnected = true;
    onChange();
  };
  s.on('connect', onConnect);
  s.on('disconnect', onChange);
  return () => {
    s.off('connect', onConnect);
    s.off('disconnect', onChange);
  };
}

const snapshot = (): ConnectionState => {
  if (getSocket().connected) return 'online';
  return everConnected ? 'offline' : 'connecting'; // "offline" = we HAD a connection and lost it
};

/** The socket's state, kept in sync with React without effects (useSyncExternalStore). */
export const useConnectionState = () =>
  useSyncExternalStore(subscribe, snapshot, () => 'connecting');

/** FR-RT-13: a small pill while the live connection is down. REST edits keep working. */
export function ConnectionPill() {
  const state = useConnectionState();
  if (state !== 'offline') return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-100 px-4 py-1.5 text-sm text-amber-900 shadow-md"
    >
      <WifiOffIcon className="size-4" /> Reconnecting… your changes still save.
    </div>
  );
}
