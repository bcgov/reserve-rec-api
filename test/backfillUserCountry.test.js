const { planCountries } = require('../src/scripts/tools/cognito/backfillUserCountry');

const user = (sub, attrs = {}) => ({
  Username: sub,
  Attributes: [{ Name: 'sub', Value: sub }, ...Object.entries(attrs).map(([Name, Value]) => ({ Name, Value }))],
});

describe('backfill planCountries', () => {
  it('takes custom:country, falling back to the BCSC address, and skips users with neither', () => {
    expect(planCountries([
      user('native', { 'custom:country': ' United States of America ' }),
      user('bcsc', { address: JSON.stringify({ region: 'BC', country: 'CA' }) }),
      user('both', { 'custom:country': 'Canada', address: JSON.stringify({ country: 'CA' }) }),
      user('none'),
      user('bad-address', { address: '{not json' }),
    ])).toEqual([
      { sub: 'native', country: 'United States of America' },
      { sub: 'bcsc', country: 'Canada' },
      { sub: 'both', country: 'Canada' },
    ]);
  });
});
