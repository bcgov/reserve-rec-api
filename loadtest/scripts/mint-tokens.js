#!/usr/bin/env node
/**
 * Mint a pool of Cognito load-test users and write loadtest/tokens.json.
 *
 * Tokens are pre-minted because the public user-pool client only enables the
 * SRP auth flow (no USER_PASSWORD_AUTH), and authenticating inside k6 would
 * put Cognito in the measured path. Access tokens are valid for 24h — mint
 * the day of the run.
 *
 * Create + authenticate:
 *   USER_POOL_ID=ca-central-1_xxxx CLIENT_ID=xxxx COUNT=100 PASSWORD='S0me-Str0ng-Pass!' \
 *     node loadtest/scripts/mint-tokens.js
 *
 * Delete the created users (reads tokens.json, falls back to a ListUsers
 * prefix scan):
 *   USER_POOL_ID=ca-central-1_xxxx node loadtest/scripts/mint-tokens.js --cleanup
 *
 * Env:
 *   USER_POOL_ID   (required) public user pool id
 *   CLIENT_ID      (required unless --cleanup) public user pool app client id
 *   COUNT          number of users, default 100
 *   PASSWORD       (required unless --cleanup) permanent password for all users
 *   EMAIL_PATTERN  email/username template, {n} replaced by 1..COUNT.
 *                  Default targets the SES mailbox simulator so the
 *                  booking-confirmation/cancellation emails the load test
 *                  triggers cannot bounce against the account's reputation.
 *   AWS creds      ambient (env/SSO/profile); region is taken from the pool id
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDeleteUserCommand,
  ListUsersCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} = require("amazon-cognito-identity-js");

const OUT_FILE = path.join(__dirname, "..", "tokens.json");
const CLEANUP = process.argv.includes("--cleanup");

const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const COUNT = parseInt(process.env.COUNT || "100", 10);
const PASSWORD = process.env.PASSWORD;
const EMAIL_PATTERN = process.env.EMAIL_PATTERN || "success+loadtest{n}@simulator.amazonses.com";
const BATCH_SIZE = 5; // stay under Cognito admin API rate limits

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!USER_POOL_ID) die("USER_POOL_ID is required");
if (!CLEANUP && !CLIENT_ID) die("CLIENT_ID is required");
if (!CLEANUP && !PASSWORD) die("PASSWORD is required (permanent password for the pool users)");
if (!EMAIL_PATTERN.includes("{n}")) die("EMAIL_PATTERN must contain {n}");

const region = USER_POOL_ID.split("_")[0];
const client = new CognitoIdentityProviderClient({ region });

const emailFor = (n) => EMAIL_PATTERN.replace("{n}", String(n));

function srpAuthenticate(username, password) {
  const pool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });
  const user = new CognitoUser({ Username: username, Pool: pool });
  const details = new AuthenticationDetails({ Username: username, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => {
        const access = session.getAccessToken();
        resolve({ accessToken: access.getJwtToken(), sub: access.payload.sub });
      },
      onFailure: reject,
      newPasswordRequired: () => reject(new Error(`${username}: unexpected NEW_PASSWORD_REQUIRED`)),
    });
  });
}

async function mintOne(n) {
  const email = emailFor(n);
  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      })
    );
  } catch (err) {
    if (err.name !== "UsernameExistsException") throw err;
  }
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: PASSWORD,
      Permanent: true,
    })
  );
  const { accessToken, sub } = await srpAuthenticate(email, PASSWORD);
  return { username: email, sub, accessToken };
}

async function mint() {
  console.log(`Minting ${COUNT} users in ${USER_POOL_ID} (${region})...`);
  const results = [];
  for (let start = 1; start <= COUNT; start += BATCH_SIZE) {
    const batch = [];
    for (let n = start; n < start + BATCH_SIZE && n <= COUNT; n++) batch.push(mintOne(n));
    results.push(...(await Promise.all(batch)));
    process.stdout.write(`\r  ${results.length}/${COUNT}`);
  }
  process.stdout.write("\n");
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Wrote ${results.length} tokens to ${OUT_FILE}`);
  console.log("Access tokens expire in 24h — mint the day of the run.");
}

async function listUsernamesByPrefix() {
  const prefix = EMAIL_PATTERN.slice(0, EMAIL_PATTERN.indexOf("{n}"));
  const usernames = [];
  let token;
  do {
    const res = await client.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `email ^= "${prefix}"`,
        PaginationToken: token,
      })
    );
    for (const u of res.Users || []) usernames.push(u.Username);
    token = res.PaginationToken;
  } while (token);
  return usernames;
}

async function cleanup() {
  let usernames;
  if (fs.existsSync(OUT_FILE)) {
    usernames = JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).map((t) => t.username);
    console.log(`Deleting ${usernames.length} users listed in tokens.json...`);
  } else {
    usernames = await listUsernamesByPrefix();
    console.log(`tokens.json not found; deleting ${usernames.length} users matching the email prefix...`);
  }
  let deleted = 0;
  for (let start = 0; start < usernames.length; start += BATCH_SIZE) {
    const batch = usernames.slice(start, start + BATCH_SIZE).map(async (username) => {
      try {
        await client.send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
        deleted++;
      } catch (err) {
        if (err.name !== "UserNotFoundException") throw err;
      }
    });
    await Promise.all(batch);
    process.stdout.write(`\r  ${Math.min(start + BATCH_SIZE, usernames.length)}/${usernames.length}`);
  }
  process.stdout.write("\n");
  if (fs.existsSync(OUT_FILE)) fs.unlinkSync(OUT_FILE);
  console.log(`Deleted ${deleted} users; removed tokens.json.`);
}

(CLEANUP ? cleanup() : mint()).catch((err) => {
  console.error(err);
  process.exit(1);
});
