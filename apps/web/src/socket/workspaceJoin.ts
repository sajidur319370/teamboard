// The server only accepts board:join AFTER workspace:join succeeded, and React runs a child's
// effects (BoardPage) before its parent's (WorkspaceLayout). So boards wait for the workspace
// ACK, not for `connect`: otherwise reconnects race and the server answers JOIN_WORKSPACE_FIRST.
type Listener = () => void;

let joinedWorkspaceId: string | null = null;
const listeners = new Set<Listener>();

/** Called with an id after a successful workspace:join ack, and with null on disconnect/leave. */
export function markWorkspaceJoined(id: string | null) {
  joinedWorkspaceId = id;
  if (id) for (const l of [...listeners]) l();
}

/** Runs cb now if the workspace room is already joined, and again after every (re)join. */
export function whenWorkspaceJoined(cb: Listener): () => void {
  listeners.add(cb);
  if (joinedWorkspaceId) cb();
  return () => {
    listeners.delete(cb);
  };
}
