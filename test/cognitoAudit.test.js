jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require('/opt/base');
const { handler } = require('../lib/handlers/cognitoTriggers/cognitoAudit');

const POOL = 'ca-central-1_PublicPool';
const OTHER_POOL = 'ca-central-1_AdminPool';
const SUB = '11111111-2222-3333-4444-555555555555';
const SELF = 'ReserveRecApi-Dev-PublicIdentityStack-PreTokenGeneration';
const REDACTED = 'HIDDEN_DUE_TO_SECURITY_REASONS';

/** A CloudTrail record as EventBridge delivers it. */
function trail(eventName, requestParameters, extra = {}) {
  return {
    source: 'aws.cognito-idp',
    'detail-type': 'AWS API Call via CloudTrail',
    detail: {
      eventSource: 'cognito-idp.amazonaws.com',
      eventName,
      requestParameters,
      ...extra,
    },
  };
}

const userCall = (eventName, requestParameters, pool = POOL) =>
  trail(eventName, requestParameters, {
    userIdentity: { type: 'Unknown' },
    additionalEventData: { sub: SUB, userPoolId: pool },
  });

const adminCall = (eventName, requestParameters, arn = 'arn:aws:sts::123456789012:assumed-role/OpsRole/operator') =>
  trail(eventName, { userPoolId: POOL, username: SUB, ...requestParameters }, {
    userIdentity: { type: 'AssumedRole', arn, principalId: `AROAEXAMPLE:${arn.split('/').pop()}` },
  });

const events = () => logger.info.mock.calls.map(([msg]) => msg);

describe('cognitoAudit handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_USER_POOL_ID = POOL;
    process.env.SELF_ROLE_NAME_FRAGMENT = SELF;
  });

  describe('UpdateUserAttributes', () => {
    it('logs a redacted request', async () => {
      await handler(userCall('UpdateUserAttributes', {
        accessToken: REDACTED,
        userAttributes: [{ name: 'email', value: REDACTED }],
      }));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=email_change_requested', {
        sub: SUB, eventName: 'UpdateUserAttributes', valueRedacted: true,
      });
    });

    it('flags a value shown in clear without logging it', async () => {
      await handler(userCall('UpdateUserAttributes', {
        userAttributes: [{ name: 'email', value: 'person@example.com' }],
      }));
      expect(logger.info).toHaveBeenCalledWith('event=email_change_requested', {
        sub: SUB, eventName: 'UpdateUserAttributes', valueRedacted: false,
      });
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('person@example.com');
    });

    it('treats an absent value as redacted', async () => {
      await handler(userCall('UpdateUserAttributes', { userAttributes: [{ name: 'email' }] }));
      expect(logger.info).toHaveBeenCalledWith('event=email_change_requested', expect.objectContaining({ valueRedacted: true }));
    });

    it('ignores an update that does not touch email', async () => {
      await handler(userCall('UpdateUserAttributes', {
        userAttributes: [{ name: 'custom:postalCode', value: REDACTED }],
      }));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('VerifyUserAttribute', () => {
    it('logs verification of email', async () => {
      await handler(userCall('VerifyUserAttribute', { attributeName: 'email', code: REDACTED }));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=email_change_verified', { sub: SUB });
    });

    it('ignores verification of another attribute', async () => {
      await handler(userCall('VerifyUserAttribute', { attributeName: 'phone_number' }));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('AdminUpdateUserAttributes', () => {
    it('logs an admin email change with the principal', async () => {
      await handler(adminCall('AdminUpdateUserAttributes', {
        userAttributes: [{ name: 'email', value: 'person@example.com' }],
      }));
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=email_change_admin', {
        sub: SUB,
        principalArn: 'arn:aws:sts::123456789012:assumed-role/OpsRole/operator',
        emailVerifiedForced: false,
      });
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('person@example.com');
    });

    it('flags a forced email_verified alongside the change', async () => {
      await handler(adminCall('AdminUpdateUserAttributes', {
        userAttributes: [
          { name: 'email', value: 'person@example.com' },
          { name: 'email_verified', value: 'true' },
        ],
      }));
      expect(logger.info).toHaveBeenCalledWith('event=email_change_admin', expect.objectContaining({ emailVerifiedForced: true }));
    });

    it('logs email_verified set on its own', async () => {
      await handler(adminCall('AdminUpdateUserAttributes', {
        userAttributes: [{ name: 'email_verified', value: 'true' }],
      }));
      expect(logger.info).toHaveBeenCalledWith('event=email_change_admin', expect.objectContaining({ emailVerifiedForced: true }));
    });

    it("skips PreTokenGeneration's own email_verified repair", async () => {
      await handler(adminCall('AdminUpdateUserAttributes', {
        userAttributes: [{ name: 'email_verified', value: 'true' }],
      }, `arn:aws:sts::123456789012:assumed-role/ReserveRecApi-Dev-PublicIde-ReserveRecApiDevPublicIden-ABC123/${SELF}`));
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('does not accept an alias username as the sub', async () => {
      const call = adminCall('AdminUpdateUserAttributes', {
        userAttributes: [{ name: 'email', value: 'new@example.com' }],
      });
      call.detail.requestParameters.username = 'person@example.com';
      await handler(call);
      expect(logger.info).toHaveBeenCalledWith('event=email_change_admin', expect.objectContaining({ sub: null }));
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('@example.com');
    });
  });

  describe('delete calls', () => {
    it.each(['DeleteUserAttributes', 'AdminDeleteUserAttributes'])('logs %s touching email', async (eventName) => {
      const call = eventName.startsWith('Admin')
        ? adminCall(eventName, { userAttributeNames: ['email'] })
        : userCall(eventName, { userAttributeNames: ['email'], accessToken: REDACTED });
      await handler(call);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('event=email_attributes_deleted', { sub: SUB, eventName });
    });

    it('ignores a delete that does not touch email', async () => {
      await handler(userCall('DeleteUserAttributes', { userAttributeNames: ['custom:licensePlate'] }));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('filtering', () => {
    it('ignores another pool on a user call', async () => {
      await handler(userCall('VerifyUserAttribute', { attributeName: 'email' }, OTHER_POOL));
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('ignores another pool on an admin call', async () => {
      await handler(adminCall('AdminUpdateUserAttributes', {
        userPoolId: OTHER_POOL,
        userAttributes: [{ name: 'email', value: 'x@example.com' }],
      }));
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

    it('ignores other event sources and malformed events', async () => {
      await handler({ detail: { eventSource: 'iam.amazonaws.com', eventName: 'UpdateUserAttributes' } });
      await handler({});
      await handler(undefined);
      await handler(userCall('AdminGetUser', {}));
      expect(logger.info).not.toHaveBeenCalled();
    });
  });
});
