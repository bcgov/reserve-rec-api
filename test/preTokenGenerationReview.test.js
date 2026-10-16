jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getNow: () => ({ toISO: () => '2026-06-01T00:00:00.000Z' }),
}));
jest.mock('/opt/dynamodb', () => ({
  TRANSACTIONAL_DATA_TABLE_NAME: 'table',
  putItem: jest.fn(),
  updateItem: jest.fn(),
  getOne: jest.fn(),
  runQuery: jest.fn(),
}));
jest.mock('/opt/emailBlocklist', () => {
  const real = jest.requireActual('/opt/emailBlocklist');
  return {
    canonicalizeEmail: real.canonicalizeEmail,
    refusalReason: real.refusalReason,
    loadBlocklist: jest.fn().mockResolvedValue({ addresses: new Set(), domains: [], patterns: [] }),
  };
});
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: jest.fn() })),
  AdminUpdateUserAttributesCommand: jest.fn(),
}));

const { logger } = require('/opt/base');
const { getOne, putItem, updateItem, runQuery } = require('/opt/dynamodb');
const { handler } = require('../lib/handlers/cognitoTriggers/postConfirmation');

const SUB = '11111111-2222-3333-4444-555555555555';
const PHONE_PK = 'link#phone#+12505550100';
const ADDRESS_PK = 'link#address#1 example st|v0v0v0';
const RECENT = '2026-05-20T00:00:00.000Z';

function event({ bcsc = false } = {}) {
  const userAttributes = {
    sub: SUB,
    email: 'person@example.test',
    email_verified: 'true',
    'custom:mobilePhone': '+1 250 555 0100',
    'custom:streetAddress': '1 Example St',
    'custom:postalCode': 'V0V 0V0',
  };
  if (bcsc) userAttributes.identities = JSON.stringify([{ providerName: 'BCSC' }]);
  return { userPoolId: 'pool', userName: SUB, request: { userAttributes } };
}

function links(byPk) {
  runQuery.mockImplementation(async (query) => ({ items: byPk[query.ExpressionAttributeValues[':pk'].S] || [] }));
}

const created = () => putItem.mock.calls[0]?.[0];

describe('PreTokenGeneration linked review', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REFUSAL_TABLE_NAME = 'refusals';
    getOne.mockResolvedValue(null);
    links({});
  });

  it('puts a new native account matching a refusal phone into review', async () => {
    links({ [PHONE_PK]: [{ sk: `${RECENT}#r-1`, source: 'refusal', ref: 'r-1' }] });
    await handler(event());

    expect(created().review).toEqual({
      state: 'pending', source: 'refusal', matchedOn: 'phone', linkedTo: 'r-1', at: '2026-06-01T00:00:00.000Z',
    });
    expect(logger.info).toHaveBeenCalledWith('event=account_flagged', { sub: SUB, source: 'refusal', matchedOn: 'phone' });
  });

  it('matches on the secondary number too', async () => {
    const secondary = event();
    secondary.request.userAttributes['custom:secondaryNumber'] = '250-555-0109';
    links({ 'link#phone#+12505550109': [{ sk: `${RECENT}#r-2`, source: 'refusal', ref: 'r-2' }] });
    await handler(secondary);

    expect(created().review).toMatchObject({ state: 'pending', matchedOn: 'phone', linkedTo: 'r-2' });
    expect(runQuery.mock.calls.map(([q]) => q.ExpressionAttributeValues[':pk'].S))
      .toEqual([PHONE_PK, 'link#phone#+12505550109', ADDRESS_PK]);
  });

  it('leaves review unset on an address match alone', async () => {
    links({ [ADDRESS_PK]: [{ sk: '2020-01-01T00:00:00.000Z#sub-9', source: 'banned', ref: 'sub-9' }] });
    await handler(event());

    expect(created()).toMatchObject({ pk: 'user', sk: SUB });
    expect(created()).not.toHaveProperty('review');
    expect(logger.info).not.toHaveBeenCalledWith('event=account_flagged', expect.anything());
  });

  it('records an address that also matches a phone match', async () => {
    links({
      [PHONE_PK]: [{ sk: `${RECENT}#r-1`, source: 'refusal', ref: 'r-1' }],
      [ADDRESS_PK]: [{ sk: '2020-01-01T00:00:00.000Z#sub-9', source: 'banned', ref: 'sub-9' }],
    });
    await handler(event());

    expect(created().review).toEqual({
      state: 'pending', source: 'refusal', matchedOn: 'phone+address', linkedTo: 'r-1', at: '2026-06-01T00:00:00.000Z',
    });
  });

  it('queries the refusal table', async () => {
    await handler(event());
    expect(runQuery.mock.calls.map(([q]) => q.TableName)).toEqual(['refusals', 'refusals']);
  });

  it('leaves an unmatched account without a review', async () => {
    await handler(event());
    expect(created()).not.toHaveProperty('review');
  });

  it('does not check an existing account', async () => {
    getOne.mockResolvedValue({ pk: 'user', sk: SUB, email: 'person@example.test', createdAt: RECENT });
    links({ [PHONE_PK]: [{ sk: `${RECENT}#r-1`, source: 'refusal', ref: 'r-1' }] });
    await handler(event());

    expect(runQuery).not.toHaveBeenCalled();
    expect(updateItem.mock.calls[0][0]).not.toHaveProperty('review');
  });

  it('does not write review on a later login', async () => {
    const review = { state: 'rejected', source: 'refusal', matchedOn: 'phone', at: RECENT };
    getOne.mockResolvedValue({ pk: 'user', sk: SUB, email: 'person@example.test', createdAt: RECENT, review });
    await handler(event());

    expect(updateItem.mock.calls[0][0]).not.toHaveProperty('review');
  });

  it('does not check a BCSC account', async () => {
    links({ [PHONE_PK]: [{ sk: `${RECENT}#r-1`, source: 'refusal', ref: 'r-1' }] });
    await handler(event({ bcsc: true }));

    expect(runQuery).not.toHaveBeenCalled();
    expect(created()).not.toHaveProperty('review');
  });

  it('fails open and still creates the account when the lookup fails', async () => {
    runQuery.mockRejectedValue(new Error('DynamoDB unavailable'));
    await expect(handler(event())).resolves.toBeDefined();

    expect(created()).toMatchObject({ pk: 'user', sk: SUB });
    expect(created()).not.toHaveProperty('review');
    expect(logger.error).toHaveBeenCalledWith('PreTokenGeneration link check failed open', { error: 'DynamoDB unavailable' });
  });
});
