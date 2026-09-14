const { buildUpdate } = require('../lib/handlers/cognitoTriggers/attachTriggers');

// A pool shaped like the real one, with the fields that were actually lost.
function pool(overrides = {}) {
  return {
    Id: 'ca-central-1_example',
    AutoVerifiedAttributes: ['email'],
    MfaConfiguration: 'OFF',
    AccountRecoverySetting: { RecoveryMechanisms: [{ Priority: 1, Name: 'verified_email' }] },
    VerificationMessageTemplate: { DefaultEmailOption: 'CONFIRM_WITH_CODE' },
    Policies: { PasswordPolicy: { MinimumLength: 8 }, SignInPolicy: { AllowedFirstAuthFactors: ['PASSWORD'] } },
    LambdaConfig: { PreTokenGeneration: 'arn:existing:ptg' },
    ...overrides,
  };
}

describe('buildUpdate', () => {
  it('passes back the fields UpdateUserPool would otherwise reset', () => {
    const req = buildUpdate(pool(), { PreSignUp: 'arn:new:psu' });
    // The one that was actually cleared on dev and test.
    expect(req.AutoVerifiedAttributes).toEqual(['email']);
    expect(req.MfaConfiguration).toBe('OFF');
    expect(req.AccountRecoverySetting).toBeDefined();
    expect(req.VerificationMessageTemplate).toBeDefined();
    expect(req.Policies.PasswordPolicy).toEqual({ MinimumLength: 8 });
  });

  it('merges triggers instead of replacing the whole LambdaConfig', () => {
    const req = buildUpdate(pool(), { PreSignUp: 'arn:new:psu' });
    expect(req.LambdaConfig).toEqual({
      PreTokenGeneration: 'arn:existing:ptg',   // survives — this is the bug
      PreSignUp: 'arn:new:psu',
    });
  });

  it('overwrites a trigger that is already set', () => {
    const req = buildUpdate(pool(), { PreTokenGeneration: 'arn:updated:ptg' });
    expect(req.LambdaConfig.PreTokenGeneration).toBe('arn:updated:ptg');
  });

  it('removes a trigger when its arn is null', () => {
    const req = buildUpdate(pool(), { PreTokenGeneration: null });
    expect(req.LambdaConfig).toBeUndefined();
  });

  it('drops SignInPolicy, which describe returns but update rejects', () => {
    const req = buildUpdate(pool(), { PreSignUp: 'arn:new:psu' });
    expect(req.Policies.SignInPolicy).toBeUndefined();
  });

  it('omits fields that are absent rather than sending empties', () => {
    const req = buildUpdate(
      pool({ AutoVerifiedAttributes: [], SmsConfiguration: {}, EmailVerificationMessage: '' }),
      { PreSignUp: 'arn:new:psu' }
    );
    expect('AutoVerifiedAttributes' in req).toBe(false);
    expect('SmsConfiguration' in req).toBe(false);
    expect('EmailVerificationMessage' in req).toBe(false);
  });

  it('always carries the pool id', () => {
    expect(buildUpdate(pool(), {}).UserPoolId).toBe('ca-central-1_example');
  });

  it('leaves a pool with no triggers alone apart from the ones asked for', () => {
    const req = buildUpdate(pool({ LambdaConfig: {} }), { PreSignUp: 'arn:new:psu' });
    expect(req.LambdaConfig).toEqual({ PreSignUp: 'arn:new:psu' });
  });
});
