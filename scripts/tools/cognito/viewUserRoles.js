const {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
  ListUserPoolsCommand
} = require("@aws-sdk/client-cognito-identity-provider");
const fetch = require("node-fetch");
const aws4 = require("aws4");
const readline = require("readline");

const OPENSEARCH_DOMAIN_ENDPOINT = "https://search-reserve-rec-opensearch-dev-jdbrtigqohrxm6reb3527mckfy.ca-central-1.es.amazonaws.com";

// 1. Lookup Cognito groups for a user
async function getUserGroups(userPoolId, username, region) {
  const client = new CognitoIdentityProviderClient({ region });
  const cmd = new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username });
  const resp = await client.send(cmd);
  return resp.Groups?.map(g => g.GroupName) || [];
}

// 2. Call OpenSearch Security API to see backend roles and permissions
async function getAuthInfo(domainEndpoint, region, credentials) {
  const opts = {
    host: domainEndpoint.replace(/^https?:\/\//, ""),
    path: "/_plugins/_security/api/authinfo",
    service: "es",
    region,
    method: "GET"
  };
  aws4.sign(opts, credentials);
  const resp = await fetch(`https://${opts.host}${opts.path}`, {
    method: "GET",
    headers: opts.headers
  });
  return resp.json();
}

// 3. Helper function to list user pools and let user select
async function selectUserPool(region) {
  const client = new CognitoIdentityProviderClient({ region });
  const cmd = new ListUserPoolsCommand({ MaxResults: 60 });
  const resp = await client.send(cmd);

  if (!resp.UserPools || resp.UserPools.length === 0) {
    throw new Error("No user pools found in the region");
  }

  console.log("\nAvailable User Pools:");
  resp.UserPools.forEach((pool, index) => {
    console.log(`${index + 1}. ${pool.Name} (${pool.Id})`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('\nSelect user pool (enter number): ', (answer) => {
      const index = parseInt(answer) - 1;
      if (index >= 0 && index < resp.UserPools.length) {
        resolve(resp.UserPools[index]);
      } else {
        console.log("Invalid selection, using first user pool");
        resolve(resp.UserPools[0]);
      }
      rl.close();
    });
  });
}

// 4. Helper function to get username input
async function getUsername() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question('Enter username to check: ', (username) => {
      resolve(username.trim());
      rl.close();
    });
  });
}

// 5. Helper function to get OpenSearch domain endpoint input
async function getDomainEndpoint() {
  return OPENSEARCH_DOMAIN_ENDPOINT;
}

// 6. Combine results
async function main() {
  const region = "ca-central-1";

  try {
    console.log("🔍 User Role Viewer for OpenSearch and Cognito");
    console.log("===============================================");

    // Get user pool selection
    const selectedUserPool = await selectUserPool(region);
    console.log(`\nSelected User Pool: ${selectedUserPool.Name} (${selectedUserPool.Id})`);

    // Get username
    const username = await getUsername();
    console.log(`\nChecking roles for user: ${username}`);

    // Get domain endpoint
    const domainEndpoint = await getDomainEndpoint();
    console.log(`\nUsing OpenSearch domain: ${domainEndpoint}`);

    console.log("\n" + "=".repeat(50));

    // Check Cognito groups
    console.log("\n📝 Checking Cognito Groups...");
    const groups = await getUserGroups(selectedUserPool.Id, username, region);
    console.log("Cognito groups:", groups.length > 0 ? groups : "No groups assigned");

    // Supply AWS credentials here (from env, profile, or STS)
    const credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN
    };

    // Check OpenSearch roles
    console.log("\n🔒 Checking OpenSearch Security...");
    const authInfo = await getAuthInfo(domainEndpoint, region, credentials);
    console.log("OpenSearch backend_roles:", authInfo.backend_roles?.length > 0 ? authInfo.backend_roles : "No backend roles assigned");
    console.log("Dashboards tenants:", authInfo.tenants ? Object.keys(authInfo.tenants) : "No tenants");
    console.log("Cluster permissions:", authInfo.cluster_permissions?.length > 0 ? authInfo.cluster_permissions : "No cluster permissions");

    console.log("\n" + "=".repeat(50));
    console.log("✅ Role check complete!");

  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.log("\nTroubleshooting tips:");
    console.log("- Ensure AWS credentials are configured");
    console.log("- Verify the user exists in the selected user pool");
    console.log("- Check OpenSearch domain endpoint is accessible");
    console.log("- Ensure your IAM user has permissions to access Cognito and OpenSearch");
  }
}

main().catch(console.error);