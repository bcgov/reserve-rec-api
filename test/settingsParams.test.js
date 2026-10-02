'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SETTINGS, settingParam } = require('../lib/helpers/settings-params');

const ROOT = path.join(__dirname, '..');
const SSM_STRING = 'AWS::SSM::Parameter::Value<String>';

describe('settingParam', () => {
  it('names the parameter under the environment', () => {
    expect(settingParam('dev', 'holdLimits')).toBe('/reserveRecApi/dev/settings/holdLimits');
  });

  it('refuses an unknown setting', () => {
    expect(() => settingParam('dev', 'holdLimitsPerWeek')).toThrow(/Unknown setting/);
  });
});

// An offline dev synth of the whole app, without bundling or AWS credentials.
describe('settings in the synthesized dev templates', () => {
  let outdir;
  let templates;

  beforeAll(() => {
    outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-synth-'));
    const env = {
      ...process.env,
      CDK_OUTDIR: outdir,
      CDK_CONTEXT_JSON: JSON.stringify({
        '@context': 'dev',
        dev: { DEPLOYMENT_NAME: 'dev', AWS_REGION: 'ca-central-1', IS_OFFLINE: 'true', FAIL_FAST: 'true' },
        'aws:cdk:bundling-stacks': [],
      }),
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
      AWS_SESSION_TOKEN: '',
      AWS_CONFIG_FILE: os.devNull,
      AWS_SHARED_CREDENTIALS_FILE: os.devNull,
      AWS_EC2_METADATA_DISABLED: 'true',
    };
    delete env.AWS_PROFILE;
    execFileSync(process.execPath, ['bin/app.js'], { cwd: ROOT, env, stdio: 'ignore' });
    templates = Object.fromEntries(fs.readdirSync(outdir)
      .filter((f) => f.endsWith('.template.json'))
      .map((f) => [f, JSON.parse(fs.readFileSync(path.join(outdir, f), 'utf8'))]));
  }, 120000);

  afterAll(() => fs.rmSync(outdir, { recursive: true, force: true }));

  const template = (pattern) => {
    const names = Object.keys(templates).filter((f) => pattern.test(f));
    expect(names).toHaveLength(1);
    return templates[names[0]];
  };

  const functionEnv = (tmpl, nameSuffix) => {
    const fns = Object.values(tmpl.Resources).filter((r) => r.Type === 'AWS::Lambda::Function'
      && typeof r.Properties.FunctionName === 'string' && r.Properties.FunctionName.endsWith(nameSuffix));
    expect(fns).toHaveLength(1);
    return fns[0].Properties.Environment.Variables;
  };

  // The SSM parameter a `{ Ref }` resolves to, following a nested stack parameter to its parent.
  const ssmSource = (value, tmpl, parent) => {
    expect(Object.keys(value)).toEqual(['Ref']);
    const param = tmpl.Parameters[value.Ref];
    if (parent && param.Type === 'String') {
      const stackResource = Object.values(parent.Resources).find((r) => r.Type === 'AWS::CloudFormation::Stack'
        && r.Properties.Parameters?.[value.Ref]);
      return ssmSource(stackResource.Properties.Parameters[value.Ref], parent);
    }
    expect(param.Type).toBe(SSM_STRING);
    return param.Default;
  };

  it('sources DUPLICATE_EMAIL_REFUSE on PreSignUp from its parameter', () => {
    const identity = template(/^ReserveRecApi-Dev-PublicIdentityStack\.template\.json$/);
    const env = functionEnv(identity, '-PreSignUp');
    expect(ssmSource(env.DUPLICATE_EMAIL_REFUSE, identity)).toBe('/reserveRecApi/dev/settings/duplicateEmailRefuse');
  });

  describe('public bookings functions', () => {
    let parent;
    let nested;
    beforeAll(() => {
      parent = template(/^ReserveRecApi-Dev-PublicApiStack\.template\.json$/);
      nested = template(/PublicBookingsNestedStack.*\.nested\.template\.json$/);
    });

    it('sources CANCELLATION_EMAIL_ENABLED on the cancel POST from its parameter', () => {
      const env = functionEnv(nested, '-BookingsCancelPOST');
      expect(ssmSource(env.CANCELLATION_EMAIL_ENABLED, nested, parent))
        .toBe('/reserveRecApi/dev/settings/cancellationEmailEnabled');
    });

    it('sources HOLD_LIMITS_ENABLED and HOLD_LIMITS on the hold POST from their parameters', () => {
      const env = functionEnv(nested, '-BookingsPOST');
      expect(ssmSource(env.HOLD_LIMITS_ENABLED, nested, parent)).toBe('/reserveRecApi/dev/settings/holdLimitsEnabled');
      expect(ssmSource(env.HOLD_LIMITS, nested, parent)).toBe('/reserveRecApi/dev/settings/holdLimits');
    });

    it('alarms on the first invalid hold limits config', () => {
      const alarms = Object.values(nested.Resources).filter((r) => r.Type === 'AWS::CloudWatch::Alarm'
        && r.Properties.MetricName === 'hold_limits_config_invalid');
      expect(alarms).toHaveLength(1);
      expect(alarms[0].Properties).toMatchObject({ Threshold: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold' });
    });
  });

  it('creates no settings parameters and keeps no old switch', () => {
    const all = JSON.stringify(Object.values(templates));
    for (const tmpl of Object.values(templates)) {
      const created = Object.values(tmpl.Resources || {})
        .filter((r) => r.Type === 'AWS::SSM::Parameter')
        .map((r) => JSON.stringify(r.Properties.Name));
      expect(created.filter((name) => name.includes('/settings/'))).toEqual([]);
    }
    expect(all).not.toMatch(/HOLD_LIMITS_ENABLED_PARAMETER|holdLimits\/enabled|distributionStack\/cancellationEmailEnabled/);
    expect(all).not.toMatch(/HOLD_REMOVALS_BEFORE_WAIT|HOLD_LIMIT_PER_(HOUR|DAY)/);
  });

  it('wires each setting to one function', () => {
    const all = JSON.stringify(Object.values(templates));
    for (const envName of Object.values(SETTINGS)) {
      expect(all.match(new RegExp(`"${envName}":`, 'g'))).toHaveLength(1);
    }
  });
});
