const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { SSMClient, PutParameterCommand, GetParameterCommand } = require('@aws-sdk/client-ssm');

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

exports.handler = async (event) => {
  console.log('Table Manager Lambda triggered:', JSON.stringify(event, null, 2));
  
  const { stackName, tableNames } = event;
  const results = {};
  
  try {
    // For each table, check if it exists and store its ARN in Parameter Store
    const foundTables = {};
    const missingTables = {};
    
    for (const [tableKey, expectedTableName] of Object.entries(tableNames)) {
      const tableArn = await ensureTableExists(expectedTableName, stackName, tableKey);
      
      if (tableArn) {
        // Store table ARN in Parameter Store
        const parameterPath = stackName === 'ReserveRecCdkStack' 
          ? `/reserve-rec/main/tables/${tableKey}/arn`
          : `/reserve-rec/${stackName}/tables/${tableKey}/arn`;
          
        await putParameter(parameterPath, tableArn);
        
        foundTables[tableKey] = {
          tableName: expectedTableName,
          tableArn: tableArn,
          parameterName: parameterPath
        };
      } else {
        missingTables[tableKey] = {
          tableName: expectedTableName,
          status: 'NOT_FOUND'
        };
      }
    }
    
    results.foundTables = foundTables;
    results.missingTables = missingTables;
    results.summary = {
      totalTables: Object.keys(tableNames).length,
      foundCount: Object.keys(foundTables).length,
      missingCount: Object.keys(missingTables).length
    };
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: results.summary.missingCount > 0 
          ? `Table management completed with ${results.summary.missingCount} missing tables`
          : 'Table management completed successfully',
        results: results
      })
    };
    
  } catch (error) {
    console.error('Error in table management:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Table management failed',
        error: error.message
      })
    };
  }
};

/*
 * Ensure the DynamoDB table exists. If not, attempt to create it or import it.
 * 
 * @param {string} tableName - The expected name of the Dynamo table.
 * @param {string} stackName - The name of the CDK stack (for Parameter Store pathing).
 * @param {string} tableKey - The logical key for the table (e.g. 'main', 'audit', 'pubsub').
 * 
 * @returns {string} - The ARN of the DynamoDB table.
 */
async function ensureTableExists(tableName, stackName, tableKey) {
  try {
    // Check if table exists
    const describeCommand = new DescribeTableCommand({ TableName: tableName });
    const tableInfo = await dynamoClient.send(describeCommand);
    
    console.log(`Table ${tableName} already exists`);
    return tableInfo.Table.TableArn;
    
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      // Table doesn't exist - this is expected on first deployments
      console.log(`Table ${tableName} does not exist - this may be expected for first deployments`);
      return null; // Return null instead of throwing an error
    }
    // Re-throw other errors (access denied, etc.)
    throw error;
  }
}

// Store a parameter in SSM Parameter Store
async function putParameter(name, value) {
  const command = new PutParameterCommand({
    Name: name,
    Value: value,
    Type: 'String',
    Overwrite: true,
    Description: `DynamoDB table ARN managed by Reserve Rec CDK`
  });
  
  await ssmClient.send(command);
  console.log(`Parameter stored: ${name} = ${value}`);
}

// Retrieve a parameter from SSM Parameter Store
async function getParameter(name) {
  try {
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: true
    });
    
    const result = await ssmClient.send(command);
    return result.Parameter.Value;
  } catch (error) {
    if (error.name === 'ParameterNotFound') {
      return null;
    }
    throw error;
  }
}
