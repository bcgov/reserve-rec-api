#!/usr/bin/env node
/**
 * Manage the signup email blocklist that the Cognito PreSignUp and
 * PreTokenGeneration triggers enforce. Entries live in the identity stack's
 * DynamoDB table, one item each; this is the only supported way to edit them.
 *
 *   node src/scripts/tools/cognito/emailBlocklist.js --env dev list
 *   node src/scripts/tools/cognito/emailBlocklist.js --env dev add address someone@example.com --reason "ticket 123"
 *   node src/scripts/tools/cognito/emailBlocklist.js --env dev add domain example.com --reason "..."
 *   node src/scripts/tools/cognito/emailBlocklist.js --env dev add pattern '^sample[0-9]{4,}@' --reason "..."
 *   node src/scripts/tools/cognito/emailBlocklist.js --env dev remove address someone@example.com
 *   node src/scripts/tools/cognito/emailBlocklist.js --env dev import list.json --reason "seeded from SSM"
 *
 * `import` takes the JSON shape the SSM parameter used:
 *   { "addresses": [...], "domains": [...], "patterns": [...] }
 *
 * The list is defence data. Keep it out of the repository and out of tickets.
 */
const fs = require('fs');
const os = require('os');
const { DynamoDBClient, QueryCommand, PutItemCommand, DeleteItemCommand, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { BLOCKLIST_PK, KINDS, toItem } = require('../../../layers/base/emailBlocklist');

const REGION = 'ca-central-1';
const PLURAL = { address: 'addresses', domain: 'domains', pattern: 'patterns' };

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: emailBlocklist.js --env <dev|test|prod> [--table NAME] <list|add|remove|import> ...');
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { env: null, table: null, reason: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--env') opts.env = argv[++i];
    else if (a === '--table') opts.table = argv[++i];
    else if (a === '--reason') opts.reason = argv[++i];
    else if (a === '-h' || a === '--help') usage();
    else rest.push(a);
  }
  if (!opts.table) {
    if (!opts.env) usage('--env or --table is required');
    const env = opts.env.charAt(0).toUpperCase() + opts.env.slice(1);
    opts.table = `ReserveRecApi-${env}-PublicIdentityStack-EmailBlocklist`;
  }
  return { opts, rest };
}

async function listItems(client, table) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await client.send(new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': { S: BLOCKLIST_PK } },
      ExclusiveStartKey,
    }));
    items.push(...(page.Items || []).map(unmarshall));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function batchPut(client, table, items) {
  for (let i = 0; i < items.length; i += 25) {
    let RequestItems = { [table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item: marshall(Item) } })) };
    do {
      const res = await client.send(new BatchWriteItemCommand({ RequestItems }));
      RequestItems = res.UnprocessedItems && Object.keys(res.UnprocessedItems).length ? res.UnprocessedItems : null;
    } while (RequestItems);
  }
}

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));
  const [cmd, ...args] = rest;
  const client = new DynamoDBClient({ region: REGION });
  const meta = { reason: opts.reason, addedBy: os.userInfo().username };

  switch (cmd) {
    case 'list': {
      const items = await listItems(client, opts.table);
      items.sort((a, b) => a.sk.localeCompare(b.sk));
      for (const it of items) console.log(`${it.kind.padEnd(8)} ${it.value}\t${it.addedAt || ''}\t${it.addedBy || ''}\t${it.reason || ''}`);
      console.error(`${items.length} entries in ${opts.table}`);
      return;
    }
    case 'add': {
      const [kind, value] = args;
      if (!kind || !value) usage('add <address|domain|pattern> <value>');
      if (!opts.reason) usage('--reason is required for add');
      const item = toItem(kind, value, meta);
      await client.send(new PutItemCommand({ TableName: opts.table, Item: marshall(item) }));
      console.log(`added ${item.sk}`);
      return;
    }
    case 'remove': {
      const [kind, value] = args;
      if (!kind || !value) usage('remove <address|domain|pattern> <value>');
      const { sk } = toItem(kind, value);
      await client.send(new DeleteItemCommand({ TableName: opts.table, Key: marshall({ pk: BLOCKLIST_PK, sk }) }));
      console.log(`removed ${sk}`);
      return;
    }
    case 'import': {
      const [file] = args;
      if (!file) usage('import <file.json>');
      const lists = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Keyed by sk: canonicalisation can fold two raw entries onto one key,
      // and a batch write refuses duplicates.
      const items = new Map();
      const bad = [];
      for (const kind of KINDS) {
        for (const value of lists[PLURAL[kind]] || []) {
          try {
            const item = toItem(kind, value, meta);
            items.set(item.sk, item);
          } catch (err) {
            bad.push(`${kind} ${value}: ${err.message}`);
          }
        }
      }
      if (bad.length) {
        console.error(`refusing to import; ${bad.length} entries would never match:`);
        for (const b of bad) console.error(`  ${b}`);
        process.exit(1);
      }
      await batchPut(client, opts.table, [...items.values()]);
      console.log(`imported ${items.size} entries into ${opts.table}`);
      return;
    }
    default:
      usage(cmd ? `unknown command: ${cmd}` : undefined);
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
