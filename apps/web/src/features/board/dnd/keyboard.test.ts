import { describe, expect, it } from 'vitest';
import { neighbourColumnTarget } from './keyboard';

// Three 280px columns with 12px gaps; a 260px card lifted in the middle column.
const col = (left: number, height = 600) => ({ left, top: 100, width: 280, height });
const columns = [col(12), col(304), col(596, 200)];
const card = { left: 314, top: 260, width: 260, height: 90 };

describe('neighbourColumnTarget (keyboard drag between columns)', () => {
  it('ArrowRight goes to the next column, centred, at the same height', () => {
    expect(neighbourColumnTarget(columns, card, 'right')).toEqual({ x: 606, y: 210 }); // clamped: short column
  });

  it('ArrowLeft goes to the previous column', () => {
    expect(neighbourColumnTarget(columns, card, 'left')).toEqual({ x: 22, y: 260 });
  });

  it('no column that way → null (the card stays put)', () => {
    const first = { ...card, left: 22 };
    expect(neighbourColumnTarget(columns, first, 'left')).toBeNull();
    const last = { ...card, left: 606 };
    expect(neighbourColumnTarget(columns, last, 'right')).toBeNull();
  });

  it('works whatever order the columns are registered in', () => {
    expect(neighbourColumnTarget([columns[2]!, columns[0]!, columns[1]!], card, 'right')).toEqual({
      x: 606,
      y: 210,
    });
  });

  it('a card above a column top lands at its top', () => {
    expect(neighbourColumnTarget(columns, { ...card, top: 20 }, 'right')!.y).toBe(100);
  });
});
