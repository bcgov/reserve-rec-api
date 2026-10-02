'use strict';

const { App, Stack } = require('aws-cdk-lib');
const { Template, Match } = require('aws-cdk-lib/assertions');
const lambda = require('aws-cdk-lib/aws-lambda');
const { addHoldLimits } = require('../lib/public-api-stack/public-bookings-nested-stack/public-bookings-nested-stack');

function holdFunction(stack) {
  return new lambda.Function(stack, 'Hold', {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {};'),
  });
}

function synth(holdLimits) {
  const stack = new Stack(new App(), 'Test', { env: { account: '111111111111', region: 'ca-central-1' } });
  addHoldLimits(holdFunction(stack), holdLimits, 'test');
  return Template.fromStack(stack);
}

describe('addHoldLimits', () => {
  it('passes the limits and the switch parameter to the function', () => {
    synth({ removalsBeforeWait: 3, holdsPerHour: '5', holdsPerDay: 9 }).hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          HOLD_REMOVALS_BEFORE_WAIT: '3',
          HOLD_LIMIT_PER_HOUR: '5',
          HOLD_LIMIT_PER_DAY: '9',
          HOLD_LIMITS_ENABLED_PARAMETER: '/reserveRecApi/test/holdLimits/enabled',
        },
      },
    });
  });

  it('grants GetParameter on the switch parameter only', () => {
    synth({ removalsBeforeWait: 3 }).hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([{
          Action: 'ssm:GetParameter',
          Effect: 'Allow',
          Resource: {
            'Fn::Join': ['', Match.arrayWith([':ssm:ca-central-1:111111111111:parameter/reserveRecApi/test/holdLimits/enabled'])],
          },
        }]),
      },
    });
  });

  it.each([
    [{ removalsBeforeWait: 0 }, /positive integer/],
    [{ holdsPerHour: 'many' }, /positive integer/],
    [{ holdsPerWeek: 4 }, /unknown holdLimits key/],
  ])('rejects %j', (holdLimits, message) => {
    expect(() => synth(holdLimits)).toThrow(message);
  });
});
