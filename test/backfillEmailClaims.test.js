const { planClaims } = require('../src/scripts/tools/cognito/backfillEmailClaims');

const user = (Username, email, created, extra = []) => ({
  Username,
  UserCreateDate: new Date(created),
  Attributes: [{ Name: 'email', Value: email }, ...extra],
});

describe('backfill planClaims', () => {
  it('claims the oldest native account per mailbox and reports the rest', () => {
    const { claims, collisions } = planClaims([
      user('u2', 'me+2@example.test', '2026-03-01'),
      user('u1', 'Me@Example.test', '2026-01-01'),
      user('u3', 'other@example.test', '2026-02-01'),
      user('bcsc_abc', 'me+bcsc@example.test', '2025-01-01'),
      user('u4', 'me+fed@example.test', '2025-01-01', [{ Name: 'identities', Value: '[{}]' }]),
    ]);
    expect(claims).toEqual([
      { pk: 'me@example.test', email: 'me@example.test' },
      { pk: 'other@example.test', email: 'other@example.test' },
    ]);
    expect(collisions).toEqual([
      { pk: 'me@example.test', kept: 'me@example.test', others: ['me+2@example.test'] },
    ]);
  });
});
