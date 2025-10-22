const { BaseStack } = require('../base-stack');
const { logger, StackPrimer } = require("../utils");
const cognito = require('aws-cdk-lib/aws-cognito');
const cdk = require('aws-cdk-lib');

const defaults = {
  config: {
    openSearchCognitoClientId: '',
  },
  constructs: {},
  secrets: {}
};

class RoleAggregatorStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Role Aggregator Stack: ${this.stackId}`);

    const groups = scope.getGroups();
    const roles = scope.getRoles();
    const adminUserPoolId = scope.resolveAdminUserPoolId(this);
    const adminProvider = scope.resolveAdminUserPoolProviderName(this);
    const adminClientId = scope.resolveAdminUserPoolClientId(this);
    const adminIdentityPoolId = scope.resolveAdminIdentityPoolId(this);
    const adminAuthCognitoRoleArn = scope.resolveAuthenticatedCognitoRoleArn(this);
    const adminUnauthCognitoRoleArn = scope.resolveUnauthenticatedCognitoRoleArn(this);

    // Admin role mappings
    this.adminRoleMappings = {};
    const adminProviderString = `${adminProvider}:${adminClientId}`;
    logger.debug('Admin Provider String:', adminProviderString);

    for (const [groupKey, group] of Object.entries(groups)) {
      logger.debug(`Processing group for role mapping: ${groupKey}`);
      let allRules = [];
      if (group.userPoolId === adminUserPoolId && group.role) {
        allRules.push({
          Claim: 'cognito:groups',
          MatchType: 'Contains',
          Value: group.groupName,
          RoleARN: roles[group.role].roleArn,
        });
      }
      if (allRules.length === 0) {
        continue; // Skip if no rules for this group
      }
      this.adminRoleMappings[adminProviderString] = {
        Type: 'Rules',
        AmbiguousRoleResolution: 'AuthenticatedRole',
        RulesConfiguration: {
          Rules: allRules
        }
      };
    }

    // Manually add the OpenSearch Dashboards Cognito mapping (because OpenSearch automatically generates a different client ID)

    const openSearchCognitoClientId = this.getConfigValue('openSearchCognitoClientId');
    const openSearchProviderString = `${adminProvider}:${openSearchCognitoClientId}`;
    logger.debug('OpenSearch Provider String:', openSearchProviderString);

    this.adminRoleMappings[openSearchProviderString] = {
      Type: 'Rules',
      AmbiguousRoleResolution: 'AuthenticatedRole',
      RulesConfiguration: {
        Rules: [
          {
            Claim: 'cognito:groups',
            MatchType: 'Contains',
            Value: 'ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup',
            RoleARN: 'arn:aws:iam::623829546818:role/ReserveRecApi-Dev-AdminIdentityStack-SuperAdminRole',
          }
        ]
      }
    };

    this.adminRoleMappingJson = new cdk.CfnJson(this, 'AdminRoleMappingJson', {
      value: this.adminRoleMappings
    });

    // Create role mappings for admin identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'AdminIdentityPoolRoleAttachment', {
      identityPoolId: adminIdentityPoolId,
      roles: {
        authenticated: adminAuthCognitoRoleArn,
        unauthenticated: adminUnauthCognitoRoleArn
      },
      roleMappings: this.adminRoleMappingJson
    });

  }
}

async function createRoleAggregatorStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new RoleAggregatorStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Role Aggregator Stack: ${error}`);
  }
}

module.exports = {
  createRoleAggregatorStack,
};