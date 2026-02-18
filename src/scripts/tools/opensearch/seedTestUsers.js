// Seed test users to local DynamoDB and OpenSearch
// Usage: 
//   node src/scripts/tools/opensearch/seedTestUsers.js [opensearch_endpoint] [dynamodb_endpoint] [num_users]
//   node seedTestUsers.js                        # Seeds 20 random users (default)
//   node seedTestUsers.js http://localhost:9200 http://localhost:8000 100  # Seeds 100 random users
const AWS = require('aws-sdk');
const { Client } = require('@opensearch-project/opensearch');
const { randomUUID } = require('crypto');

// Allow endpoints to be overridden via environment variables or command line args
const OPENSEARCH_DOMAIN_ENDPOINT = process.env.OPENSEARCH_ENDPOINT || process.argv[2] || 'http://localhost:9200';
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || process.argv[3] || 'http://localhost:8000';
const NUM_USERS = parseInt(process.argv[4] || process.env.NUM_USERS || '20', 10);
const OPENSEARCH_USERS_INDEX_NAME = 'users-index';
const TABLE_NAME = 'ReserveRecApi-Local-TransactionalDataTable'; // Update if your local table name differs

// Configure AWS SDK for local DynamoDB
AWS.config.update({
  region: 'ca-central-1',
  endpoint: DYNAMODB_ENDPOINT,
  credentials: {
    accessKeyId: 'DUMMYACCESSKEY',
    secretAccessKey: 'DUMMYSECRETKEY'
  }
});

const dynamodb = new AWS.DynamoDB.DocumentClient();

// Configure OpenSearch client
const osClient = new Client({
  node: OPENSEARCH_DOMAIN_ENDPOINT,
  ssl: {
    rejectUnauthorized: false
  }
});

// Random data generators for creating test users
const firstNames = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Barbara', 'David', 'Elizabeth', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Christopher', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa',
  'Anthony', 'Betty', 'Mark', 'Margaret', 'Donald', 'Sandra', 'Steven', 'Ashley',
  'Andrew', 'Kimberly', 'Paul', 'Emily', 'Joshua', 'Donna', 'Kenneth', 'Michelle',
  'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa', 'Timothy', 'Deborah',
  'Ronald', 'Stephanie', 'Edward', 'Dorothy', 'Jason', 'Rebecca', 'Jeffrey', 'Sharon',
  'Ryan', 'Laura', 'Jacob', 'Cynthia', 'Gary', 'Kathleen', 'Nicholas', 'Amy',
  'Eric', 'Angela', 'Jonathan', 'Shirley', 'Stephen', 'Anna', 'Larry', 'Brenda',
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy',
];

const bcCities = [
  'Victoria', 'Vancouver', 'Kelowna', 'Kamloops', 'Nanaimo', 'Prince George',
  'Abbotsford', 'Chilliwack', 'Courtenay', 'Vernon', 'Campbell River', 'Penticton',
];

const streets = [
  'Main St', 'Oak Ave', 'Pine Rd', 'Cedar Lane', 'Birch Blvd', 'Maple Dr',
  'Elm Way', 'Spruce Ct', 'Douglas St', 'Willow Pl', 'Fir Cres', 'Hemlock Rd',
];

/**
 * Generate a random BC phone number
 */
function randomPhoneNumber() {
  const areaCodes = ['250', '604', '778', '236', '672'];
  const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];
  const exchange = Math.floor(Math.random() * 900) + 100;
  const subscriber = Math.floor(Math.random() * 9000) + 1000;
  return `+1${areaCode}${exchange}${subscriber}`;
}

/**
 * Generate a random BC postal code
 */
function randomPostalCode() {
  const letters = 'ABCEGHJKLMNPRSTVWXYZ';
  const digits = '0123456789';
  
  return `V${digits[Math.floor(Math.random() * 10)]}${letters[Math.floor(Math.random() * letters.length)]} ${digits[Math.floor(Math.random() * 10)]}${letters[Math.floor(Math.random() * letters.length)]}${digits[Math.floor(Math.random() * 10)]}`;
}


function randomLicensePlate() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  
  // Format: ABC123 or AB1234
  if (Math.random() > 0.5) {
    return `${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}${digits[Math.floor(Math.random() * 10)]}${digits[Math.floor(Math.random() * 10)]}${digits[Math.floor(Math.random() * 10)]}`;
  } else {
    return `${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}${digits[Math.floor(Math.random() * 10)]}${digits[Math.floor(Math.random() * 10)]}${digits[Math.floor(Math.random() * 10)]}${digits[Math.floor(Math.random() * 10)]}`;
  }
}

/**
 * Generate a random test user
 */
function generateRandomUser(index) {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${index}@example.com`;
  const phone = randomPhoneNumber();
  const streetNum = Math.floor(Math.random() * 9000) + 100;
  const street = streets[Math.floor(Math.random() * streets.length)];
  const city = bcCities[Math.floor(Math.random() * bcCities.length)];
  
  return {
    givenName: firstName,
    familyName: lastName,
    email: email,
    phoneNumber: phone,
    mobilePhone: phone,
    postalCode: randomPostalCode(),
    province: 'BC',
    city: city,
    streetAddress: `${streetNum} ${street}`,
    licensePlate: randomLicensePlate(),
    vehicleRegLocale: 'BC',
  };
}

/**
 * Build searchable terms string from user data
 */
function buildSearchTerms(userData) {
  const terms = [
    userData.email,
    userData.givenName,
    userData.familyName,
    userData.phoneNumber,
    userData.mobilePhone,
    userData.licensePlate,
    userData.postalCode,
  ].filter(Boolean);
  
  return terms.join(' ');
}

/**
 * Write a user to DynamoDB
 */
async function writeUserToDynamoDB(user) {
  const now = new Date().toISOString();
  
  const item = {
    pk: 'user',
    sk: user.sub,
    schema: 'user',
    username: user.email.split('@')[0], // Use email prefix as username
    userPoolId: 'local-test-pool',
    ...user,
    userStatus: 'CONFIRMED',
    enabled: true,
    createdAt: now,
    lastModified: now,
  };

  try {
    await dynamodb.put({
      TableName: TABLE_NAME,
      Item: item
    }).promise();
    console.log(`  ✓ DynamoDB: ${user.email}`);
  } catch (err) {
    console.error(`  ✗ DynamoDB error for ${user.email}:`, err.message);
    throw err;
  }
}

/**
 * Index a user in OpenSearch
 */
async function indexUserInOpenSearch(user) {
  const now = new Date().toISOString();
  
  const document = {
    id: user.sub,
    username: user.email.split('@')[0],
    ...user,
    userStatus: 'CONFIRMED',
    enabled: true,
    createdAt: now,
    lastModified: now,
    searchTerms: buildSearchTerms(user),
    pk: 'user',
    sk: user.sub,
  };

  try {
    await osClient.index({
      index: OPENSEARCH_USERS_INDEX_NAME,
      id: user.sub,
      body: document,
      refresh: true, // Make immediately searchable
    });
    console.log(`  ✓ OpenSearch: ${user.email}`);
  } catch (err) {
    console.error(`  ✗ OpenSearch error for ${user.email}:`, err.message);
    throw err;
  }
}

/**
 * Main seeding function
 */
async function seedUsers() {
  console.log('='.repeat(60));
  console.log('Seed Test Users to DynamoDB and OpenSearch');
  console.log('='.repeat(60));
  console.log();
  console.log(`OpenSearch: ${OPENSEARCH_DOMAIN_ENDPOINT}`);
  console.log(`DynamoDB: ${DYNAMODB_ENDPOINT}`);
  console.log(`Number of users to seed: ${NUM_USERS}`);
  console.log();

  // Generate random users
  const allUsers = [];
  console.log(`Generating ${NUM_USERS} random users...`);
  for (let i = 0; i < NUM_USERS; i++) {
    allUsers.push(generateRandomUser(i + 1));
  }
  console.log();

  try {
    // Check OpenSearch connection
    const osInfo = await osClient.info();
    console.log(`✓ Connected to OpenSearch ${osInfo.body.version.number}`);
    
    // Check DynamoDB connection (try to describe table)
    try {
      const dynamodbRaw = new AWS.DynamoDB({ endpoint: DYNAMODB_ENDPOINT });
      await dynamodbRaw.describeTable({ TableName: TABLE_NAME }).promise();
      console.log(`✓ Connected to DynamoDB table: ${TABLE_NAME}`);
    } catch (err) {
      console.error(`✗ DynamoDB table '${TABLE_NAME}' not found. Create it first.`);
      throw err;
    }
    
    console.log();
    console.log(`📝 Seeding ${allUsers.length} random users...`);
    console.log();

    let successCount = 0;
    
    for (const userData of allUsers) {
      // Add unique sub (Cognito UUID)
      const user = {
        ...userData,
        sub: randomUUID(),
        email_verified: true,
        phone_number_verified: true,
      };

      console.log(`Processing: ${user.givenName} ${user.familyName} (${user.email})`);
      
      try {
        await writeUserToDynamoDB(user);
        await indexUserInOpenSearch(user);
        successCount++;
        console.log();
      } catch (err) {
        console.error(`Failed to seed user: ${user.email}`);
        console.error(err);
        console.log();
      }
    }

    console.log('='.repeat(60));
    console.log(`✅ Successfully seeded ${successCount}/${allUsers.length} random users`);
    console.log('='.repeat(60));
    console.log();
    console.log('Users are searchable by:');
    console.log('  - Email (e.g., any generated email)');
    console.log('  - Name (first or last name)');
    console.log('  - Phone number');
    console.log('  - License plate');
    console.log('  - Partial matches (e.g., "J" for names starting with J)');
    console.log();
    console.log('Use POST /users/search endpoint to test');
    console.log();

  } catch (err) {
    console.error();
    console.error('='.repeat(60));
    console.error('❌ Error:', err.message);
    console.error('='.repeat(60));
    console.error(err);
    process.exit(1);
  }
}

seedUsers();
