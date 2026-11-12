import { createContext, useContext } from 'react';
import type { BoardMemberDto, BoardResponse, LabelDto, PaletteColor } from '@teamboard/shared';

export type Person = { userId: string; name: string; avatarColor: PaletteColor; former?: boolean };

export interface BoardCtx {
  board: BoardResponse;
  slug: string;
  projectKey: string;
  /** Members AND former members still assigned to something, by id. */
  people: Map<string, Person>;
  /** Members who may be assigned (BR-10: not viewers). */
  assignable: BoardMemberDto[];
  labels: Map<string, LabelDto>;
  tz: string;
  readOnly: boolean; // archived project or no task:update permission
  /** Path to this board with the current search params, e.g. for closing the drawer. */
  boardPath: string;
  taskPath: (number: number) => string;
}

const Ctx = createContext<BoardCtx | null>(null);
export const BoardProvider = Ctx.Provider;

export function useBoardCtx(): BoardCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useBoardCtx must be used inside BoardPage');
  return v;
}
