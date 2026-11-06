'use strict';

const { App } = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const lambda = require('aws-cdk-lib/aws-lambda');
const { renderTokens } = require('./helpers/cfnTokens');
const adminRoles = require('../lib/admin-identity-stack/admin-roles.json');

jest.mock('../lib/helpers/utils', () => ({
  ...jest.requireActual('../lib/helpers/utils'),
  getSyncSecretFromSM: async () => null,
}));

const { createAdminIdentityStack } = require('../lib/admin-identity-stack/admin-identity-stack');
const { createPublicIdentityStack } = require('../lib/public-identity-stack/public-identity-stack');

const OS_CLIENT_ID = 'opensearch-dashboards-client';

function fakeScope(config = {}) {
  const layer = (name) => (consumer) => lambda.LayerVersion.fromLayerVersionArn(consumer, name, `arn:aws:lambda:ca-central-1:111111111111:layer:${name}:1`);
  const groups = {};
  const roles = {};
  return {
    app: new App(),
    context: {},
    getAppName: () => 'ReserveRecApi',
    getDeploymentName: () => 'local',
    getSandboxName: () => null,
    isSandbox: () => false,
    isOffline: () => true,
    createScopedId: (id, suffix = 'Construct') => `${id}-${suffix}`,
    createStackId(stackKey) {
      return [this.getAppName(), this.getDeploymentName(), stackKey].map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
    },
    bindStackScope: () => {},
    // The methods below are bound to the stack by BaseStack.
    getConfigValue(key) { return key in config ? config[key] : this.config[key]; },
    setConfigValue(key, value) { this.config[key] = value; },
    getSecretValue() { return null; },
    getConstructId(key) { return this.getConstructByKey(key).id; },
    getConstructName(key) { return this.getConstructByKey(key)?.name; },
    resolveBaseLayer: layer('BaseLayer'),
    resolveAwsUtilsLayer: layer('AwsUtilsLayer'),
    addGroupWithRole(key, group, role) { groups[key] = group; roles[key] = role; },
    addRole(key, role) { roles[key] = role; },
    getGroupByKey: (key) => groups[key],
    getRoleByKey: (key) => roles[key],
  };
}

const logicalId = (template, type, prefix) => Object.keys(template.findResources(type)).find((id) => id.startsWith(prefix));

const resources = (template) => template.toJSON().Resources;

const attachment = (template) => Object.values(template.findResources('AWS::Cognito::IdentityPoolRoleAttachment'))[0].Properties;

const identityPool = (template) => Object.values(template.findResources('AWS::Cognito::IdentityPool'))[0].Properties;

// RoleMappings is a CfnJson custom resource because its keys hold tokens.
const adminRoleMappings = (template) => {
  const cfnJsonId = attachment(template).RoleMappings['Fn::GetAtt'][0];
  return JSON.parse(renderTokens(resources(template)[cfnJsonId].Properties.Value));
};

const stacks = {};
beforeAll(async () => {
  stacks.admin = Template.fromStack(await createAdminIdentityStack(fakeScope({ openSearchCognitoClientId: OS_CLIENT_ID }), 'adminIdentityStack'));
  stacks.adminWithoutDashboards = Template.fromStack(await createAdminIdentityStack(fakeScope(), 'adminIdentityStack'));
  stacks.public = Template.fromStack(await createPublicIdentityStack(fakeScope(), 'publicIdentityStack'));
});

describe.each([
  ['admin', 'ReserveRecApiLocalAdminIdentityStack'],
  ['public', 'ReserveRecApiLocalPublicIdentityStack'],
])('%s identity stack', (stack, idPrefix) => {
  it.each(['CognitoAuthRole', 'CognitoUnauthRole'])('default role %s grants nothing', (role) => {
    const template = stacks[stack];
    const roleId = logicalId(template, 'AWS::IAM::Role', `${idPrefix}${role}`);
    const props = resources(template)[roleId].Properties;
    expect(props.ManagedPolicyArns).toBeUndefined();
    expect(props.Policies).toBeUndefined();
    const attached = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) => p.Properties.Roles.some((r) => r.Ref === roleId));
    expect(attached).toEqual([]);
  });

  it('identity pool disables the basic flow', () => {
    expect(identityPool(stacks[stack]).AllowClassicFlow).toBe(false);
  });
});

describe('admin identity pool providers', () => {
  const provider = (template, clientId) => ({
    ClientId: clientId,
    ProviderName: { 'Fn::GetAtt': [logicalId(template, 'AWS::Cognito::UserPool', 'ReserveRecApiLocalAdminIdentityStackAdminUserPool'), 'ProviderName'] },
    ServerSideTokenCheck: true,
  });
  const appClient = (template) => ({ Ref: logicalId(template, 'AWS::Cognito::UserPoolClient', 'ReserveRecApiLocalAdminIdentityStackAdminUserPoolClient') });

  it('lists the admin app client and the Dashboards client, both checked server-side', () => {
    const template = stacks.admin;
    expect(identityPool(template).CognitoIdentityProviders).toEqual([provider(template, appClient(template)), provider(template, OS_CLIENT_ID)]);
  });

  it('lists only the admin app client when no Dashboards client is configured', () => {
    const template = stacks.adminWithoutDashboards;
    expect(identityPool(template).CognitoIdentityProviders).toEqual([provider(template, appClient(template))]);
  });
});

describe('public identity pool providers', () => {
  it('checks tokens server-side', () => {
    expect(identityPool(stacks.public).CognitoIdentityProviders).toEqual([expect.objectContaining({ ServerSideTokenCheck: true })]);
  });
});

describe('admin identity pool role mappings', () => {
  it('maps the Dashboards client: each admin group to its role', () => {
    const template = stacks.admin;
    const pool = logicalId(template, 'AWS::Cognito::UserPool', 'ReserveRecApiLocalAdminIdentityStackAdminUserPool');
    const osKey = `\${${pool}.ProviderName}:${OS_CLIENT_ID}`;
    const expected = Object.values(adminRoles).map(({ groupName, roleName }) => ({
      Claim: 'cognito:groups',
      MatchType: 'Contains',
      Value: `ReserveRecApi-Local-AdminIdentityStack-${groupName}`,
      RoleARN: `\${${logicalId(template, 'AWS::IAM::Role', `ReserveRecApiLocalAdminIdentityStack${roleName}`)}.Arn}`,
    }));
    expect(adminRoleMappings(template)[osKey].RulesConfiguration.Rules).toEqual(expected);
  });

  it('has no mapping for the admin app client', () => {
    const template = stacks.admin;
    const client = logicalId(template, 'AWS::Cognito::UserPoolClient', 'ReserveRecApiLocalAdminIdentityStackAdminUserPoolClient');
    const keys = Object.keys(adminRoleMappings(template));
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(`\${${client}}`);
  });

  it('has no RoleMappings when no Dashboards client is configured', () => {
    expect(attachment(stacks.adminWithoutDashboards)).not.toHaveProperty('RoleMappings');
  });
});

describe('public identity pool role mappings', () => {
  it('has no RoleMappings', () => {
    expect(attachment(stacks.public)).not.toHaveProperty('RoleMappings');
  });
});
