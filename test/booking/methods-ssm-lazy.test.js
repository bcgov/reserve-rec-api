'use strict';

// methods.js is bundled into many Lambdas; only the hold switch read may load /opt/ssm.
jest.mock('/opt/base', () => ({
  Exception: jest.fn(),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('/opt/dynamodb', () => ({ marshall: jest.fn((x) => x) }));
jest.mock('/opt/sns', () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
jest.mock('../../lib/handlers/emailDispatch/utils', () => ({}));
jest.mock('../../src/handlers/users/methods', () => ({}));
jest.mock('../../src/handlers/activities/methods', () => ({}));
jest.mock('../../src/handlers/productDates/methods', () => ({}));
jest.mock('../../src/common/data-utils', () => ({}));
jest.mock('@aws-sdk/util-dynamodb', () => ({ unmarshall: jest.fn((x) => x) }));
jest.mock('/opt/ssm', () => {
  global.mockSsmLoaded = true;
  return { getParameter: jest.fn().mockResolvedValue('true') };
});

afterEach(() => {
  delete process.env.HOLD_LIMITS_ENABLED_PARAMETER;
  delete global.mockSsmLoaded;
});

it('requiring methods.js does not load /opt/ssm', async () => {
  require('../../src/handlers/bookings/methods');
  expect(global.mockSsmLoaded).toBeUndefined();

  process.env.HOLD_LIMITS_ENABLED_PARAMETER = '/reserveRecApi/test/holdLimits/enabled';
  await require('../../src/handlers/bookings/hold-limits').holdLimitsSwitchOn();
  expect(global.mockSsmLoaded).toBe(true);
});
