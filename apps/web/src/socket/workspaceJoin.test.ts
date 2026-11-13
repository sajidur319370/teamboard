import { describe, expect, it, vi } from 'vitest';
import { markWorkspaceJoined, whenWorkspaceJoined } from './workspaceJoin';

describe('whenWorkspaceJoined (board joins wait for the workspace ack)', () => {
  it('waits until the workspace is joined, then runs again after every re-join', () => {
    markWorkspaceJoined(null);
    const join = vi.fn();
    const stop = whenWorkspaceJoined(join);
    expect(join).not.toHaveBeenCalled(); // not joined yet: don't send board:join

    markWorkspaceJoined('ws1');
    expect(join).toHaveBeenCalledTimes(1);

    markWorkspaceJoined(null); // disconnect
    markWorkspaceJoined('ws1'); // reconnect + re-join
    expect(join).toHaveBeenCalledTimes(2);

    stop();
    markWorkspaceJoined('ws1');
    expect(join).toHaveBeenCalledTimes(2); // unsubscribed
  });

  it('runs immediately if the workspace was already joined', () => {
    markWorkspaceJoined('ws1');
    const join = vi.fn();
    const stop = whenWorkspaceJoined(join);
    expect(join).toHaveBeenCalledTimes(1);
    stop();
    markWorkspaceJoined(null);
  });
});
