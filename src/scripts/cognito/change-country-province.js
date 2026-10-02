#!/usr/bin/env node

const readline = require('readline');
const {
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
  ListUsersCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const REGION = process.env.AWS_REGION || 'ca-central-1';
const COMMON_BC_VALUES = ['bc', 'b c'];
const COMMON_CANADA_VALUES = ['can', 'ca', 'canada'];
const COMMON_USA_VALUES = ['usa', 'united states', 'u.s.a.'];

function createPrompt() {
  const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    ask: (question) => new Promise((resolve) => readlineInterface.question(question, resolve)),
    close: () => readlineInterface.close(),
  };
}

async function listUserPools(client) {
  const pools = [];
  let NextToken;

  do {
    const response = await client.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken }));
    pools.push(...(response.UserPools || []));
    NextToken = response.NextToken;
  } while (NextToken);

  return pools;
}

async function selectUserPool(client, prompt) {
  const pools = await listUserPools(client);
  if (pools.length === 0) throw new Error(`No Cognito user pools found in ${REGION}.`);

  console.log('\nAvailable Cognito user pools:');
  pools.forEach((pool, index) => console.log(`${index + 1}. ${pool?.Name} (${pool?.Id})`));

  while (true) {
    const answer = (await prompt.ask('Select a user pool by number: ')).trim();
    const selectedIndex = Number(answer) - 1;
    if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < pools.length) {
      return pools[selectedIndex];
    }
    console.log('Enter one of the listed numbers.');
  }
}

// Safely retrieve attribute values from a user object
function getAttribute(user, name) {
  return user.Attributes?.find((attribute) => attribute.Name === name)?.Value || '';
}

async function getAllUsers(client, userPoolId) {
  let allUsers = [];
  let paginationToken;

  try {
    do {
      const command = new ListUsersCommand({
        UserPoolId: userPoolId,
        PaginationToken: paginationToken,
      });

      const response = await client.send(command);
      if (response.Users) {
        allUsers.push(...response.Users);
      }

      paginationToken = response.PaginationToken;
    } while (paginationToken);

    return allUsers;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
}

async function main() {
  const client = new CognitoIdentityProviderClient({ region: REGION });
  const prompt = createPrompt();

  try {
    console.log(`Cognito user attribute editor (${REGION})`);
    const pool = await selectUserPool(client, prompt);
    console.log(`\nSelected pool: ${pool.Name} (${pool.Id})`);

    const allUsers = await getAllUsers(client, pool.Id);

    for (let user of allUsers) {
      const email = getAttribute(user, 'email');
      const province = getAttribute(user, 'custom:province');
      const country = getAttribute(user, 'custom:country');

      console.log(`\nUser: ${user.Username}`);
      console.log(`Email: ${email || '(not set)'}`);
      console.log(`custom:province: ${province || '(not set)'}`);
      console.log(`custom:country: ${country || '(not set)'}`);

      let requiresConfirmation = false;

      // Province
      let newProvince;
      if (province && COMMON_BC_VALUES.includes(province.toLowerCase())) {
        newProvince = 'British Columbia';
      }

      if (!newProvince && province && province !== 'British Columbia') {
        newProvince = (await prompt.ask(`New custom:province (current: ${province}): `)).trim();
        requiresConfirmation ||= Boolean(newProvince);
      }

      // Country
      let newCountry;
      if (country && COMMON_USA_VALUES.includes(country.toLowerCase())) {
        newCountry = 'United States of America';
      } else if (country && COMMON_CANADA_VALUES.includes(country.toLowerCase())) {
        newCountry = 'Canada';
      }

      if (!newCountry && country && country !== 'Canada' && country !== 'United States of America') {
        newCountry = (await prompt.ask(`New custom:country (current: ${country}): `)).trim();
        requiresConfirmation ||= Boolean(newCountry);
      }

      const attributes = [];

      if (newProvince && newProvince !== province) {
        attributes.push({ Name: 'custom:province', Value: newProvince });
      }
      if (newCountry && newCountry !== country) {
        attributes.push({ Name: 'custom:country', Value: newCountry });
      }

      if (attributes.length === 0) {
        console.log('\nNo changes requested.');
        continue;
      }

      console.log('\nChanges to apply:');
      for (const attribute of attributes) {
        console.log(` ${attribute.Name}: ${getAttribute(user, attribute.Name) || '(not set)'} -> ${attribute.Value}`);
      }

      if (requiresConfirmation) {
        const confirmation = (await prompt.ask('Apply these changes? [y/N]: ')).trim().toLowerCase();
        if (confirmation !== 'y' && confirmation !== 'yes') {
          console.log('Update cancelled.');
          continue;
        }
      }

      await client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: pool.Id,
          Username: user.Username,
          UserAttributes: attributes,
        })
      );
      console.log(`Updated user: ${user.Username}`);
    }
  } finally {
    prompt.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Unable to update Cognito user: ${error.message}`);
    process.exitCode = 1;
  });
}
