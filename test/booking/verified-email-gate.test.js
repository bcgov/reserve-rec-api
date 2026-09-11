'use strict';

/**
 * A pass may not be held or secured by an account with an unverified email.
 * Reproduced on dev 2026-09-04: the UI hides the booking control for these
 * accounts, but a direct API call held and confirmed a pass regardless.
 */
jest.mock('/opt/base', () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({ unmarshall: jest.fn((x) => x) }));

jest.mock('/opt/dynamodb', () => ({
  batchTransactData: jest.fn(),
  marshall: jest.fn((x) => x),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  getOneByGlobalId: jest.fn(),
  REFERENCE_DATA_TABLE_NAME: 'RefTable',
  TRANSACTIONAL_DATA_TABLE_NAME: 'TxTable',
  SPARSE_GSI1_NAME: 'sparse-gsi-1',
  USERID_INDEX_NAME: 'userId-index',
  USERID_PROPERTY_NAME: 'userId',
}));

jest.mock('/opt/sns', () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
jest.mock('../../lib/handlers/emailDispatch/utils', () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));
jest.mock('../../src/handlers/activities/methods', () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));
jest.mock('../../src/common/data-utils', () => ({
  getAndAttachNestedProperties: jest.fn(),
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));
jest.mock('../../src/handlers/productDates/methods', () => ({ fetchProductDates: jest.fn() }));
jest.mock('../../src/handlers/productDates/configs', () => ({ PUBLIC_PRODUCTDATE_PROJECTIONS: {} }));
jest.mock('../../src/handlers/users/methods', () => ({
  getUserInfoByUserName: jest.fn(),
  getUserInfoBySub: jest.fn(),
}));
jest.mock('../../src/handlers/bookings/configs', () => ({
  BOOKING_PUT_CONFIG: {},
  BOOKINGDATES_PUT_CONFIG: {},
  BOOKING_UPDATE_CONFIG: {},
}));

const { getUserInfoBySub } = require('../../src/handlers/users/methods');
const { batchTransactData } = require('/opt/dynamodb');
const {
  requireVerifiedEmail,
  releaseHoldOnRefusal,
  resolveAuthenticatedOccupantIdentity,
} = require('../../src/handlers/bookings/methods');

function attrs(emailVerified) {
  return {
    Attributes: [
      { Name: 'given_name', Value: 'Mark' },
      { Name: 'family_name', Value: 'Lise' },
      { Name: 'email', Value: 'someone@example.com' },
      { Name: 'email_verified', Value: emailVerified },
    ],
  };
}

beforeEach(() => jest.clearAllMocks());

describe('requireVerifiedEmail', () => {
  it('refuses an unverified account', () => {
    let thrown = null;
    try {
      requireVerifiedEmail({ emailVerified: false });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeTruthy();
    expect(thrown.code).toBe(403);
    expect(thrown.message).toMatch(/verify your email address/i);
  });

  it('tells the person how to fix it', () => {
    try {
      requireVerifiedEmail({ emailVerified: false });
    } catch (e) {
      expect(e.message).toMatch(/verification code/i);
    }
  });

  it('allows a verified account', () => {
    expect(() => requireVerifiedEmail({ emailVerified: true })).not.toThrow();
  });

  // Only an explicit false blocks. A missing flag means the lookup gave us
  // nothing to judge, and failing every booking on that would be worse than
  // the gap it closes.
  it('does not block when verification state is unknown', () => {
    expect(() => requireVerifiedEmail({})).not.toThrow();
    expect(() => requireVerifiedEmail(null)).not.toThrow();
  });
});

describe('resolveAuthenticatedOccupantIdentity', () => {
  it('reports a verified address', async () => {
    getUserInfoBySub.mockResolvedValue(attrs('true'));

    expect((await resolveAuthenticatedOccupantIdentity('sub-1')).emailVerified).toBe(true);
  });

  it('reports an unverified address', async () => {
    getUserInfoBySub.mockResolvedValue(attrs('false'));

    expect((await resolveAuthenticatedOccupantIdentity('sub-1')).emailVerified).toBe(false);
  });

  // CONFIRMED and email_verified are independent: changing the address after
  // signup leaves an account signed in with the flag false.
  it('treats a missing attribute as unverified', async () => {
    getUserInfoBySub.mockResolvedValue({ Attributes: [{ Name: 'email', Value: 'a@b.c' }] });

    expect((await resolveAuthenticatedOccupantIdentity('sub-1')).emailVerified).toBe(false);
  });
});

describe('releaseHoldOnRefusal', () => {
  const hold = { bookingId: 'b-1', status: 'in progress', pk: 'pk', sk: 'sk' };

  it('lets a passing check through without touching the hold', async () => {
    await releaseHoldOnRefusal(hold, () => {}, 1, 'sub-1');

    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('releases the hold and still raises the refusal', async () => {
    const refuse = () => { throw new Error('refused'); };

    await expect(releaseHoldOnRefusal(hold, refuse, 1, 'sub-1')).rejects.toThrow('refused');
    expect(batchTransactData).toHaveBeenCalled();
  });

  // A completed or already-cancelled booking is not a hold to release.
  it('only releases a booking that is still holding inventory', async () => {
    const refuse = () => { throw new Error('refused'); };

    await expect(
      releaseHoldOnRefusal({ ...hold, status: 'confirmed' }, refuse, 1, 'sub-1')
    ).rejects.toThrow('refused');
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  // Losing the hold-release must never swallow the reason the caller was refused.
  it('still raises the refusal when the release itself fails', async () => {
    batchTransactData.mockRejectedValueOnce(new Error('dynamo down'));
    const refuse = () => { throw new Error('refused'); };

    await expect(releaseHoldOnRefusal(hold, refuse, 1, 'sub-1')).rejects.toThrow('refused');
  });
});
