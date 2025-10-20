#!/usr/bin/env node
/**
 * Display Cognito Identity Pool role mappings.
 *
 * Usage:
 *   node identity-pool-role-mappings.js --region ca-central-1
 *   node identity-pool-role-mappings.js --region ca-central-1 --pool-id ca-central-1:xxxx-xxxx-xxxx
 *   node identity-pool-role-mappings.js --region ca-central-1 --json
 */

const { CognitoIdentityClient, ListIdentityPoolsCommand, DescribeIdentityPoolCommand, GetIdentityPoolRolesCommand } = require("@aws-sdk/client-cognito-identity");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
  .option("region", { type: "string", demandOption: true, describe: "AWS region (e.g., ca-central-1)" })
  .option("pool-id", { type: "string", describe: "Identity Pool ID to filter (e.g., ca-central-1:uuid)" })
  .option("max", { type: "number", default: 60, describe: "Max pools to list" })
  .option("json", { type: "boolean", default: false, describe: "Output raw JSON instead of pretty text" })
  .help()
  .argv;

function fmtHeader(title) {
  console.log(`\n\x1b[32m=== ${title} ===\x1b[0m`);
}

function fmtKV(label, value) {
  const v = value === undefined || value === null || value === "" ? "-" : value;
  console.log(`- \x1b[34m${label}\x1b[0m: ${v}`);
}

function printRoleMappingsDetailed(rolesResp) {
  const { Roles, RoleMappings } = rolesResp || {};
  fmtHeader("Pool roles");
  fmtKV("Authenticated role ARN", Roles?.authenticated);
  fmtKV("Unauthenticated role ARN", Roles?.unauthenticated);

  fmtHeader("Provider role mappings");
  if (!RoleMappings || Object.keys(RoleMappings).length === 0) {
    console.log("- None");
    return;
  }

  for (const [provider, mapping] of Object.entries(RoleMappings)) {
    console.log(`\n\x1b[35mProvider: ${provider}\x1b[0m`);
    fmtKV("Type", mapping.Type); // Token | Rules
    fmtKV("AmbiguousRoleResolution", mapping.AmbiguousRoleResolution); // AuthenticatedRole | Deny

    if (mapping.Type === "Rules") {
      const rules = mapping.RulesConfiguration?.Rules || [];
      if (rules.length === 0) {
        console.log("- Rules: (none)");
      } else {
        console.log("- Rules:");
        for (const r of rules) {
          console.log(`  • Claim=${r.Claim}, MatchType=${r.MatchType}, Value=${r.Value}, RoleARN=${r.RoleArn}`);
        }
      }
    } else if (mapping.Type === "Token") {
      console.log("- Token mapping uses cognito:roles and cognito:preferred_role claims");
    }
  }
}

async function listPools(client, maxResults) {
  const cmd = new ListIdentityPoolsCommand({ MaxResults: Math.max(1, Math.min(60, maxResults)) });
  const resp = await client.send(cmd);
  return resp.IdentityPools || [];
}

async function describePool(client, poolId) {
  const cmd = new DescribeIdentityPoolCommand({ IdentityPoolId: poolId });
  const resp = await client.send(cmd);
  return resp;
}

async function getPoolRoles(client, poolId) {
  const cmd = new GetIdentityPoolRolesCommand({ IdentityPoolId: poolId });
  const resp = await client.send(cmd);
  return resp;
}

(async () => {
  const client = new CognitoIdentityClient({ region: argv.region });

  try {
    const pools = argv["pool-id"]
      ? [{ IdentityPoolId: argv["pool-id"] }]
      : await listPools(client, argv.max);

    if (pools.length === 0) {
      console.error("No identity pools found.");
      process.exit(1);
    }

    for (const p of pools) {
      const poolId = p.IdentityPoolId;
      const d = await describePool(client, poolId);
      const r = await getPoolRoles(client, poolId);

      if (argv.json) {
        // Emit combined JSON for machine consumption
        console.log(JSON.stringify({ poolId, describe: d, roles: r }, null, 2));
      } else {
        fmtHeader(`Identity Pool ${poolId}`);
        fmtKV("Name", d.IdentityPoolName);
        fmtKV("AllowUnauthenticatedIdentities", d.AllowUnauthenticatedIdentities);
        fmtKV("DeveloperProviderName", d.DeveloperProviderName);
        // Format SupportedLoginProviders
        if (d.SupportedLoginProviders && Object.keys(d.SupportedLoginProviders).fblength > 0) {
          fmtKV("SupportedLoginProviders", "");
          for (const [provider, clientId] of Object.entries(d.SupportedLoginProviders)) {
            console.log(`  • \x1b[36m${provider}\x1b[0m: ${clientId}`);
          }
        } else {
          fmtKV("SupportedLoginProviders", "-");
        }

        // Format CognitoIdentityProviders
        if (d.CognitoIdentityProviders && d.CognitoIdentityProviders.length > 0) {
          fmtKV("CognitoIdentityProviders", "");
          for (const provider of d.CognitoIdentityProviders) {
            console.log(`  • \x1b[36m${provider.ProviderName}\x1b[0m (${provider.ProviderType})`);
            if (provider.ClientId) console.log(`    Client ID: ${provider.ClientId}`);
            if (provider.ServerSideTokenCheck !== undefined) {
              console.log(`    Server Side Token Check: ${provider.ServerSideTokenCheck}`);
            }
          }
        } else {
          fmtKV("CognitoIdentityProviders", "-");
        }
        fmtKV("SamlProviderARNs", (d.SamlProviderARNs || []).join(", ") || "-");
        fmtKV("OpenIdConnectProviderARNs", (d.OpenIdConnectProviderARNs || []).join(", ") || "-");

        printRoleMappingsDetailed(r);
        console.log("\n\x1b[33m----------------------------------------\x1b[0m");
      }
    }
  } catch (err) {
    console.error("Error:", err?.message || err);
    process.exit(1);
  }
})();