jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('/opt/base');
const { handler } = require('../lib/handlers/cognitoTriggers/cognitoAudit');

const POOL = 'ca-central-1_PublicPool';
const OTHER_POOL = 'ca-central-1_AdminPool';
const SUB = '11111111-2222-3333-4444-555555555555';
const SELF = 'ReserveRecApi-Dev-PublicIdentityStack-PreTokenGeneration';
const HIDDEN = 'HIDDEN_DUE_TO_SECURITY_REASONS';
const OPS_ARN = 'arn:aws:sts::123456789012:assumed-role/OpsRole/operator';

/** A CloudTrail record as EventBridge delivers it. */
function trail(eventName, requestParameters, extra = {}) {
  return {
    source: 'aws.cognito-idp',
    'detail-type': 'AWS API Call via CloudTrail',
    detail: {
      eventSource: 'cognito-idp.amazonaws.com',
      eventName,
      requestParameters,
      responseElements: null,
      ...extra,
    },
  };
}

// Shapes as CloudTrail records them in ca-central-1: the request body is
// hidden wholesale on user calls, and username too on admin calls.
const userCall = (eventName, requestParameters, extra = {}, pool = POOL) =>
  trail(eventName, { accessToken: HIDDEN, ...requestParameters }, {
    userIdentity: { type: 'Unknown' },
    additionalEventData: { sub: SUB, userPoolId: pool },
    ...extra,
  });

const adminCall = (eventName, requestParameters, arn = OPS_ARN, pool = POOL) =>
  trail(eventName, { userPoolId: pool, username: HIDDEN, ...requestParameters }, {
    userIdentity: { type: 'AssumedRole', arn, principalId: `AROAEXAMPLE:${arn.split('/').pop()}` },
    additionalEventData: { sub: SUB },
  });

const updateWithDelivery = (attributeName, destination = 't***@e***') =>
  userCall('UpdateUserAttributes', { userAttributes: HIDDEN }, {
    responseElements: { codeDeliveryDetailsList: [{ destination, deliveryMedium: 'EMAIL', attributeName }] },
  });

const logged = () => JSON.stringify(logger.info.mock.calls);

describe('cognitoAudit handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_USER_POOL_ID = POOL;
    process.env.SELF_ROLE_NAME_FRAGMENT = SELF;
  });

  describe('UpdateUserAttributes', () => {
    it('logs an email change from the code delivery in the response', async () => {
      await handler(updateWithDelivery('email'));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=email_change_requested', {
        sub: SUB, eventName: 'UpdateUserAttributes', deliveryMasked: 't***@e***',
      });
    });

    it('logs only the masked destination, never a value', async () => {
      await handler(updateWithDelivery('email'));
      expect(logged()).not.toContain(HIDDEN);
      expect(logged()).not.toMatch(/[a-z0-9]+@[a-z0-9]+\.[a-z]+/i);
    });

    it('records a null destination when the response omits it', async () => {
      await handler(updateWithDelivery('email', null));
      expect(logger.info).toHaveBeenCalledWith('event=email_change_requested', expect.objectContaining({ deliveryMasked: null }));
    });

    it('ignores an update whose delivery is for another attribute', async () => {
      await handler(updateWithDelivery('phone_number', '+*******12'));
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('ignores an update with no code delivery', async () => {
      await handler(userCall('UpdateUserAttributes', { userAttributes: HIDDEN }, { responseElements: null }));
      await handler(userCall('UpdateUserAttributes', { userAttributes: HIDDEN }, { responseElements: {} }));
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('logs a failed request with its error code', async () => {
      await handler(userCall('UpdateUserAttributes', { userAttributes: HIDDEN }, {
        errorCode: 'AliasExistsException',
        errorMessage: 'An account with the email already exists.',
        responseElements: null,
      }));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=email_change_request_failed', { sub: SUB, errorCode: 'AliasExistsException' });
      expect(logged()).not.toContain('already exists');
    });
  });

  describe('VerifyUserAttribute', () => {
    it('logs verification of email when the attribute name is visible', async () => {
      await handler(userCall('VerifyUserAttribute', { attributeName: 'email', code: HIDDEN }));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=email_change_verified', { sub: SUB });
    });

    it('says the attribute is unknown when the name is redacted', async () => {
      await handler(userCall('VerifyUserAttribute', { attributeName: HIDDEN, code: HIDDEN }));
      expect(logger.info).toHaveBeenCalledWith('event=attribute_verified', { sub: SUB, attributeKnown: false });

      logger.info.mockClear();
      await handler(userCall('VerifyUserAttribute', { code: HIDDEN }));
      expect(logger.info).toHaveBeenCalledWith('event=attribute_verified', { sub: SUB, attributeKnown: false });
    });

    it('ignores verification of another visible attribute', async () => {
      await handler(userCall('VerifyUserAttribute', { attributeName: 'phone_number' }));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('AdminUpdateUserAttributes', () => {
    it('logs every admin update on the pool with the attributes marked unknown', async () => {
      await handler(adminCall('AdminUpdateUserAttributes', { userAttributes: HIDDEN }));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=admin_attributes_updated', {
        sub: SUB, principalArn: OPS_ARN, attributesKnown: false,
      });
      expect(logged()).not.toContain(HIDDEN);
    });

    it("skips PreTokenGeneration's own email_verified repair", async () => {
      await handler(adminCall('AdminUpdateUserAttributes', { userAttributes: HIDDEN },
        `arn:aws:sts::123456789012:assumed-role/ReserveRecApi-Dev-PublicIde-ReserveRecApiDevPublicIden-ABC123/${SELF}`));
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('does not take the hidden username as the sub', async () => {
      const call = adminCall('AdminUpdateUserAttributes', { userAttributes: HIDDEN });
      delete call.detail.additionalEventData;
      await handler(call);
      expect(logger.info).toHaveBeenCalledWith('event=admin_attributes_updated', expect.objectContaining({ sub: null }));
    });

    it('does not take an alias username as the sub', async () => {
      const call = adminCall('AdminUpdateUserAttributes', { userAttributes: HIDDEN, username: 'person@example.com' });
      delete call.detail.additionalEventData;
      await handler(call);
      expect(logger.info).toHaveBeenCalledWith('event=admin_attributes_updated', expect.objectContaining({ sub: null }));
      expect(logged()).not.toContain('@example.com');
    });

    it('takes a UUID username as the sub when the event carries none', async () => {
      const call = adminCall('AdminUpdateUserAttributes', { userAttributes: HIDDEN, username: SUB });
      delete call.detail.additionalEventData;
      await handler(call);
      expect(logger.info).toHaveBeenCalledWith('event=admin_attributes_updated', expect.objectContaining({ sub: SUB }));
    });
  });

  describe('delete calls', () => {
    it.each(['DeleteUserAttributes', 'AdminDeleteUserAttributes'])('logs %s with a visible list including email', async (eventName) => {
      const call = eventName.startsWith('Admin')
        ? adminCall(eventName, { userAttributeNames: ['email', 'custom:licensePlate'] })
        : userCall(eventName, { userAttributeNames: ['email', 'custom:licensePlate'] });
      await handler(call);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=attributes_deleted', {
        sub: SUB, eventName, attributesKnown: true, emailIncluded: true,
      });
    });

    it('logs a visible list that does not include email', async () => {
      await handler(userCall('DeleteUserAttributes', { userAttributeNames: ['custom:licensePlate'] }));
      expect(logger.info).toHaveBeenCalledWith('event=attributes_deleted', {
        sub: SUB, eventName: 'DeleteUserAttributes', attributesKnown: true, emailIncluded: false,
      });
    });

    it('says the attributes are unknown when the list is redacted', async () => {
      await handler(adminCall('AdminDeleteUserAttributes', { userAttributeNames: HIDDEN }));
      expect(logger.info).toHaveBeenCalledWith('event=attributes_deleted', {
        sub: SUB, eventName: 'AdminDeleteUserAttributes', attributesKnown: false,
      });
      expect(logged()).not.toContain('emailIncluded');
    });
  });

  describe('filtering', () => {
    it('ignores another pool on a user call', async () => {
      await handler(userCall('VerifyUserAttribute', { attributeName: 'email' }, {}, OTHER_POOL));
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('ignores another pool on an admin call', async () => {
      await handler(adminCall('AdminUpdateUserAttributes', { userAttributes: HIDDEN }, OPS_ARN, OTHER_POOL));
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('keeps a record that carries no pool id', async () => {
      await handler(trail('VerifyUserAttribute', { attributeName: 'email' }, { additionalEventData: { sub: SUB } }));
      expect(logger.info).toHaveBeenCalledWith('event=email_change_verified', { sub: SUB });
    });

    it('falls back to a null sub', async () => {
      await handler(trail('VerifyUserAttribute', { attributeName: 'email' }));
      expect(logger.info).toHaveBeenCalledWith('event=email_change_verified', { sub: null });
    });

    it('ignores other event sources, other event names and malformed events', async () => {
      await handler({ detail: { eventSource: 'iam.amazonaws.com', eventName: 'UpdateUserAttributes' } });
      await handler({});
      await handler(undefined);
      await handler(userCall('AdminGetUser', {}));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
