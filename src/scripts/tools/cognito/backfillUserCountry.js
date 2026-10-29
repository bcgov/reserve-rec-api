#!/usr/bin/env node
// Set each user record's country to the one sign-in would store; dry run unless --apply.
// Records only get it at sign-in, so users who have not signed in since need this.
const { CognitoIdentityProviderClient, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, BatchGetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { userCountry } = require('../../../../lib/handlers/cognitoTriggers/postConfirmation/userCountry');

const REGION = 'ca-central-1';
const WRITE_CONCURRENCY = 25;
const BATCH_GET_SIZE = 100;

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: backfillUserCountry.js --env <dev|test|prod> --pool <userPoolId> [--table NAME] [--apply]');
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
    opts.table = `ReserveRecApi-${env}-TransactionalDataStack-TransactionalDataTable`;
  }
  return opts;
}

const attr = (user, name) => user.Attributes?.find((a) => a.Name === name)?.Value;

function cognitoCountry(user) {
  const attributes = Object.fromEntries((user.Attributes || []).map((a) => [a.Name, a.Value]));
  let address = {};
  try {
    address = JSON.parse(attributes.address || '{}');
  } catch {
    // Unparseable address: fall back to custom:country alone, as the trigger does.
  }
  return userCountry(attributes, address);
}

/** @returns {{sub: string, country: string}[]} users whose Cognito profile has a country */
function planCountries(users) {
  return users
    .map((user) => ({ sub: attr(user, 'sub'), country: cognitoCountry(user).trim() }))
    .filter((u) => u.sub && u.country);
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

/** @returns {Promise<Map<string, string>>} sub to stored country ('' when unset), for subs that have a record */
async function storedCountries(client, table, subs) {
  const stored = new Map();
  for (let i = 0; i < subs.length; i += BATCH_GET_SIZE) {
    let keys = subs.slice(i, i + BATCH_GET_SIZE).map((sub) => ({ pk: { S: 'user' }, sk: { S: sub } }));
    while (keys.length) {
      const res = await client.send(new BatchGetItemCommand({
        RequestItems: { [table]: { Keys: keys, ProjectionExpression: 'sk, country' } },
      }));
      for (const item of res.Responses?.[table] || []) {
        stored.set(item.sk.S, item.country?.S || '');
      }
      keys = res.UnprocessedKeys?.[table]?.Keys || [];
    }
  }
  return stored;
}

/** @returns {Promise<boolean>} false when the record already matches or vanished since it was read */
async function writeCountry(client, table, { sub, country }) {
  try {
    await client.send(new UpdateItemCommand({
      TableName: table,
      Key: { pk: { S: 'user' }, sk: { S: sub } },
      UpdateExpression: 'SET country = :c',
      ConditionExpression: 'attribute_exists(pk) AND (attribute_not_exists(country) OR country <> :c)',
      ExpressionAttributeValues: { ':c': { S: country } },
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
  const planned = planCountries(users);
  const client = new DynamoDBClient({ region: REGION });
  const stored = await storedCountries(client, opts.table, planned.map((u) => u.sub));
  const todo = planned.filter((u) => stored.has(u.sub) && stored.get(u.sub) !== u.country);

  const changes = {};
  for (const u of todo) {
    const key = `${stored.get(u.sub) || '(none)'} -> ${u.country}`;
    changes[key] = (changes[key] || 0) + 1;
  }
  console.error(`${users.length} Cognito users, ${planned.length} with a country, ${todo.length} records to update`);
  for (const [change, n] of Object.entries(changes).sort((a, b) => b[1] - a[1])) console.error(`  ${n}\t${change}`);

  if (!opts.apply) {
    console.error(`dry run: would set country on ${todo.length} records in ${opts.table}; pass --apply to write`);
    return;
  }

  let written = 0;
  for (let i = 0; i < todo.length; i += WRITE_CONCURRENCY) {
    const results = await Promise.all(todo.slice(i, i + WRITE_CONCURRENCY).map((u) => writeCountry(client, opts.table, u)));
    written += results.filter(Boolean).length;
  }
  console.log(`set country on ${written} records in ${opts.table}; ${todo.length - written} changed since read`);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { planCountries };
