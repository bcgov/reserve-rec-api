const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { TOPICS, canSubscribe } = require('../../src/handlers/admin-realtime/topics');
const { STREAM_SOURCES } = require('../../lib/admin-realtime-stack/admin-realtime-stack');

const { customers } = TOPICS;

describe('TOPICS registry', () => {
  afterEach(() => { delete process.env.REALTIME_STAFF_ADDED_ENABLED; });

  it.each(Object.entries(TOPICS))('%s has a valid shape for its source', (name, topic) => {
    expect(typeof topic.audience).toBe('function');
    for (const flag of ['true', 'false']) {
      process.env.REALTIME_STAFF_ADDED_ENABLED = flag;
      expect(['limited', 'staff', 'superadmin']).toContain(topic.minTier);
    }
    if (topic.source === null) {
      expect(topic.filters).toBeUndefined();
    } else {
      expect(Object.keys(STREAM_SOURCES)).toContain(topic.source);
      expect(typeof topic.filters).toBe('function');
      expect(typeof topic.resolve).toBe('function');
    }
  });
});

// Event-source filter semantics Lambda uses (EventBridge patterns): every key must match;
// an array matches a leaf if any entry does; { exists } tests presence of the leaf.
function matches(pattern, value) {
  if (Array.isArray(pattern)) {
    return pattern.some((p) => {
      if (p && typeof p === 'object' && 'exists' in p) return p.exists === (value !== undefined);
      return value === p;
    });
  }
  return Object.entries(pattern).every(([key, sub]) => matches(sub, value?.[key]));
}
const matchesAny = (record, staffAddedEnabled = true) => customers.filters({ staffAddedEnabled }).some((f) => matches(f, record));

const record = (eventName, newItem, oldItem) => ({
  eventName,
  eventID: 'e1',
  dynamodb: {
    Keys: marshall({ pk: (newItem ?? oldItem).pk, sk: (newItem ?? oldItem).sk }),
    ...(newItem && { NewImage: marshall(newItem, { removeUndefinedValues: true }) }),
    ...(oldItem && { OldImage: marshall(oldItem, { removeUndefinedValues: true }) }),
    SequenceNumber: '100',
  },
});

const user = {
  pk: 'user', sk: 'sub-1', schema: 'user', givenName: 'Ada', familyName: 'L', email: 'ada@example.com',
  createdAt: '2026-10-01T00:00:00.000-07:00', lastLogin: '2026-10-01T00:00:00.000-07:00', mobilePhone: '+1250',
};
const held = {
  pk: 'booking::bcparks_1::dayuse::1::1', sk: '2026-10-10::b1', schema: 'booking', bookingId: 'b1',
  userId: 'sub-1', collectionId: 'bcparks_1', status: 'in progress',
};
const completed = { ...held, status: 'confirmed', bookingCompletionTime: 1760000000000 };

describe('customers.filters', () => {
  it('passes a new user row', () => {
    expect(matchesAny(record('INSERT', user))).toBe(true);
  });

  it('drops a login (user MODIFY) and a booking INSERT', () => {
    expect(matchesAny(record('MODIFY', { ...user, lastLogin: 'later' }, user))).toBe(false);
    expect(matchesAny(record('INSERT', held))).toBe(false);
  });

  it('passes a booking becoming completed', () => {
    expect(matchesAny(record('MODIFY', completed, held))).toBe(true);
  });

  it('drops a booking that is still a hold', () => {
    expect(matchesAny(record('MODIFY', { ...held, sessionExpiry: 1 }, held))).toBe(false);
  });

  it('passes a change to an already completed booking, which resolve then drops', () => {
    expect(matchesAny(record('MODIFY', { ...completed, status: 'cancelled' }, completed))).toBe(true);
  });

  it('only uses the N type for bookingCompletionTime', () => {
    expect(JSON.stringify(customers.filters({ staffAddedEnabled: true }))).toContain('"bookingCompletionTime":{"N"');
  });

  it('passes only new user rows while staff added events are off', () => {
    expect(customers.filters({ staffAddedEnabled: false })).toHaveLength(1);
    expect(matchesAny(record('INSERT', user), false)).toBe(true);
    expect(matchesAny(record('MODIFY', completed, held), false)).toBe(false);
  });
});

const withStaffAdded = () => {
  beforeEach(() => { process.env.REALTIME_STAFF_ADDED_ENABLED = 'true'; });
  afterEach(() => { delete process.env.REALTIME_STAFF_ADDED_ENABLED; });
};

describe('customers.resolve', () => {
  withStaffAdded();
  const deps = () => ({
    unmarshall,
    runQuery: jest.fn().mockResolvedValue({ items: [] }),
    getOne: jest.fn().mockResolvedValue(user),
    TRANSACTIONAL_DATA_TABLE_NAME: 'TxTable',
    USERID_INDEX_NAME: 'userId-index',
    USERID_PROPERTY_NAME: 'userId',
  });

  it('turns a user INSERT into created with only the list fields', async () => {
    await expect(customers.resolve(record('INSERT', user), deps())).resolves.toEqual({
      type: 'created',
      id: 'sub-1',
      data: { givenName: 'Ada', familyName: 'L', email: 'ada@example.com', mobilePhone: '+1250', createdAt: user.createdAt },
    });
  });

  it('ignores a user MODIFY', async () => {
    await expect(customers.resolve(record('MODIFY', user, user), deps())).resolves.toBeNull();
  });

  it('turns a first completed booking in a park into added, read from the user row', async () => {
    const d = deps();
    await expect(customers.resolve(record('MODIFY', completed, held), d)).resolves.toEqual({
      type: 'added',
      id: 'sub-1',
      collectionId: 'bcparks_1',
      data: { givenName: 'Ada', familyName: 'L', email: 'ada@example.com', mobilePhone: '+1250', createdAt: user.createdAt },
    });
    expect(d.getOne).toHaveBeenCalledWith('user', 'sub-1', 'TxTable');
    const [query, , , paginated] = d.runQuery.mock.calls[0];
    expect(paginated).toBe(false);
    expect(query).toMatchObject({
      TableName: 'TxTable',
      IndexName: 'userId-index',
      ExpressionAttributeValues: {
        ':userId': { S: 'sub-1' },
        ':collectionId': { S: 'bcparks_1' },
        ':completed': { N: '1760000000000' },
        ':bookingId': { S: 'b1' },
      },
    });
  });

  it('returns null when an earlier completed booking exists in that park', async () => {
    const d = deps();
    d.runQuery.mockResolvedValue({ items: [{ bookingId: 'b0' }] });
    await expect(customers.resolve(record('MODIFY', completed, held), d)).resolves.toBeNull();
    expect(d.getOne).not.toHaveBeenCalled();
  });

  it('returns null for a booking already completed before the change', async () => {
    const d = deps();
    await expect(customers.resolve(record('MODIFY', { ...completed, status: 'cancelled' }, completed), d)).resolves.toBeNull();
    expect(d.runQuery).not.toHaveBeenCalled();
  });

  it('returns null for a booking without a bookingId', async () => {
    const d = deps();
    const { bookingId, ...noId } = completed;
    await expect(customers.resolve(record('MODIFY', noId, held), d)).resolves.toBeNull();
    expect(d.runQuery).not.toHaveBeenCalled();
  });

  it('leaves mobilePhone out when the user row has none', async () => {
    const { mobilePhone, ...noPhone } = user;
    const event = await customers.resolve(record('INSERT', noPhone), deps());
    expect(JSON.parse(JSON.stringify(event.data))).toEqual({
      givenName: 'Ada', familyName: 'L', email: 'ada@example.com', createdAt: user.createdAt,
    });
  });

  it('returns null when the user row is missing', async () => {
    const d = deps();
    d.getOne.mockResolvedValue(null);
    await expect(customers.resolve(record('MODIFY', completed, held), d)).resolves.toBeNull();
  });
});

describe('customers.audience', () => {
  withStaffAdded();
  const superadmin = { superadmin: 'superadmin' };
  const created = { type: 'created', id: 'sub-1' };
  const added = { type: 'added', id: 'sub-1', collectionId: 'bcparks_1' };

  it('sends created to superadmins only', () => {
    expect(customers.audience(created, superadmin)).toBe(true);
    expect(customers.audience(created, { bcparks_1: 'staff' })).toBe(false);
  });

  it('sends added to staff of that park only', () => {
    expect(customers.audience(added, { bcparks_1: 'staff' })).toBe(true);
    expect(customers.audience(added, { bcparks_1: 'limited' })).toBe(false);
    expect(customers.audience(added, { bcparks_2: 'staff' })).toBe(false);
    expect(customers.audience(added, superadmin)).toBe(false);
  });
});

describe('staff added switched off (REALTIME_STAFF_ADDED_ENABLED not "true")', () => {
  afterEach(() => { delete process.env.REALTIME_STAFF_ADDED_ENABLED; });

  it.each([undefined, 'false', 'TRUE', '1'])('resolves a completed booking to null without reads (%s)', async (value) => {
    if (value !== undefined) process.env.REALTIME_STAFF_ADDED_ENABLED = value;
    const d = { unmarshall, runQuery: jest.fn(), getOne: jest.fn() };
    await expect(customers.resolve(record('MODIFY', completed, held), d)).resolves.toBeNull();
    expect(d.runQuery).not.toHaveBeenCalled();
    expect(d.getOne).not.toHaveBeenCalled();
  });

  it('still resolves a new user to created', async () => {
    await expect(customers.resolve(record('INSERT', user), { unmarshall })).resolves.toMatchObject({ type: 'created' });
  });

  it('never picks an audience for added', () => {
    const added = { type: 'added', id: 'sub-1', collectionId: 'bcparks_1' };
    expect(customers.audience(added, { bcparks_1: 'staff' })).toBe(false);
    expect(customers.audience(added, { superadmin: 'superadmin' })).toBe(false);
  });
});

describe('canSubscribe', () => {
  afterEach(() => { delete process.env.REALTIME_STAFF_ADDED_ENABLED; });

  it('allows superadmins and staff of any park while staff added events are on', () => {
    process.env.REALTIME_STAFF_ADDED_ENABLED = 'true';
    expect(canSubscribe('customers', { superadmin: 'superadmin' })).toBe(true);
    expect(canSubscribe('customers', { bcparks_1: 'limited', bcparks_2: 'staff' })).toBe(true);
  });

  it.each([undefined, 'false'])('allows only superadmins while staff added events are off (%s)', (value) => {
    if (value !== undefined) process.env.REALTIME_STAFF_ADDED_ENABLED = value;
    expect(canSubscribe('customers', { superadmin: 'superadmin' })).toBe(true);
    expect(canSubscribe('customers', { bcparks_2: 'staff' })).toBe(false);
  });

  it('applies the staff flag to customers only, not to other topics', () => {
    let added;
    jest.isolateModules(() => {
      const topics = require('../../src/handlers/admin-realtime/topics');
      topics.TOPICS.passes = { source: null, minTier: 'limited', audience: () => true };
      added = topics;
    });
    expect(added.canSubscribe('passes', { bcparks_1: 'limited' })).toBe(true);
    expect(added.canSubscribe('customers', { bcparks_1: 'staff' })).toBe(false);
  });

  it('refuses limited-only, empty permissions and unknown topics', () => {
    expect(canSubscribe('customers', { bcparks_1: 'limited' })).toBe(false);
    expect(canSubscribe('customers', {})).toBe(false);
    expect(canSubscribe('customers', undefined)).toBe(false);
    expect(canSubscribe('bookings', { superadmin: 'superadmin' })).toBe(false);
    expect(canSubscribe('constructor', { superadmin: 'superadmin' })).toBe(false);
  });
});
