#!/usr/bin/env node
/**
 * Backfill the one-account-per-mailbox claims that the Cognito PreSignUp
 * trigger checks. Accounts created before the trigger have no claim, so
 * without this `existing+2@...` would claim the mailbox afresh.
 *
 *   node src/scripts/tools/cognito/backfillEmailClaims.js --env dev --pool ca-central-1_XXXXXXXXX
 *   node src/scripts/tools/cognito/backfillEmailClaims.js --env dev --pool ca-central-1_XXXXXXXXX --apply
 *
 * Dry run unless --apply is given. Federated (BCSC) users are skipped. Where
 * several native accounts already share a mailbox the oldest is claimed and
 * the rest are printed as collisions; nothing is deleted or disabled.
 * Credentials come from the environment (AWS_PROFILE etc.).
 */
const { CognitoIdentityProviderClient, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { canonicalizeEmail } = require('../../../layers/base/emailBlocklist');

const REGION = 'ca-central-1';
// Parallel puts per round; ListUsers is the slow side, not DynamoDB.
const WRITE_CONCURRENCY = 25;

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: backfillEmailClaims.js --env <dev|test|prod> --pool <userPoolId> [--table NAME] [--apply]');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { env: null, pool: null, table: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env') opts.env = argv[++i];
    else if (a === '--pool') opts.pool = argv[++i];
    else if (a === '--table') opts.table = argv[++i];
    else if (a === '--apply') opts.apply = true;
    else if (a === '-h' || a === '--help') usage();
    else usage(`unknown argument: ${a}`);
  }
  if (!opts.pool) usage('--pool is required');
  if (!opts.table) {
    if (!opts.env) usage('--env or --table is required');
    const env = opts.env.charAt(0).toUpperCase() + opts.env.slice(1);
    opts.table = `ReserveRecApi-${env}-PublicIdentityStack-EmailClaim`;
  }
  return opts;
}

const attr = (user, name) => user.Attributes?.find((a) => a.Name === name)?.Value;

function isFederated(user) {
  return user.Username.toLowerCase().startsWith('bcsc_') || Boolean(attr(user, 'identities'));
}

/**
 * Group native users by canonical mailbox; the oldest account in each group
 * gets the claim.
 * @returns {{claims: {pk: string, email: string}[], collisions: {pk: string, kept: string, others: string[]}[]}}
 */
function planClaims(users) {
  const groups = new Map();
  for (const user of users) {
    if (isFederated(user)) continue;
    const email = attr(user, 'email');
    const pk = canonicalizeEmail(email);
    if (!pk) continue;
    if (!groups.has(pk)) groups.set(pk, []);
    groups.get(pk).push({ email: email.trim().toLowerCase(), created: new Date(user.UserCreateDate).getTime() });
  }
  const claims = [];
  const collisions = [];
  for (const [pk, accounts] of groups) {
    accounts.sort((a, b) => a.created - b.created);
    claims.push({ pk, email: accounts[0].email });
    if (accounts.length > 1) {
      collisions.push({ pk, kept: accounts[0].email, others: accounts.slice(1).map((a) => a.email) });
    }
  }
  return { claims, collisions };
}

async function listUsers(client, pool) {
  const users = [];
  let PaginationToken;
  do {
    const page = await client.send(new ListUsersCommand({ UserPoolId: pool, PaginationToken }));
    users.push(...(page.Users || []));
    PaginationToken = page.PaginationToken;
  } while (PaginationToken);
  return users;
}

/** @returns {Promise<boolean>} false when the mailbox was already claimed */
async function writeClaim(client, table, { pk, email }, claimedAt) {
  try {
    await client.send(new PutItemCommand({
      TableName: table,
      Item: { pk: { S: pk }, email: { S: email }, claimedAt: { S: claimedAt } },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const users = await listUsers(new CognitoIdentityProviderClient({ region: REGION }), opts.pool);
  const { claims, collisions } = planClaims(users);

  for (const c of collisions) console.log(`collision ${c.pk}: kept ${c.kept}; also ${c.others.join(', ')}`);
  console.error(`${users.length} users, ${claims.length} mailboxes, ${collisions.length} collisions`);

  if (!opts.apply) {
    console.error(`dry run: would claim ${claims.length} mailboxes in ${opts.table}; pass --apply to write`);
    return;
  }

  const client = new DynamoDBClient({ region: REGION });
  const claimedAt = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < claims.length; i += WRITE_CONCURRENCY) {
    const results = await Promise.all(
      claims.slice(i, i + WRITE_CONCURRENCY).map((c) => writeClaim(client, opts.table, c, claimedAt)),
    );
    written += results.filter(Boolean).length;
  }
  console.log(`claimed ${written} mailboxes in ${opts.table}; ${claims.length - written} already claimed`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { planClaims };
