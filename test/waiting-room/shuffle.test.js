'use strict';

const { shuffleWithIpSpread } = require('../../src/handlers/waiting-room/utils/shuffle');

describe('shuffleWithIpSpread', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({ userId: `user-${i}`, clientIp: `10.0.0.${i}` }));

  it('returns every entry exactly once without modifying the input', () => {
    const snapshot = entries.map(e => e.userId);
    const result = shuffleWithIpSpread(entries);

    expect(result).not.toBe(entries);
    expect(entries.map(e => e.userId)).toEqual(snapshot);
    expect(result.map(e => e.userId).sort()).toEqual([...snapshot].sort());
  });

  it('reorders entries', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = shuffleWithIpSpread(entries);
      expect(result.map(e => e.userId)).not.toEqual(entries.map(e => e.userId));
    } finally {
      random.mockRestore();
    }
  });

  it('handles an empty list', () => {
    expect(shuffleWithIpSpread([])).toEqual([]);
  });
});
