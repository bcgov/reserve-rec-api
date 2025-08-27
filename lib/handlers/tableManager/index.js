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
    for (const [tableKey, expectedTableName] of Object.entries(tableNames)) {
      const tableArn = await ensureTableExists(expectedTableName, stackName, tableKey);
      
      // Store table ARN in Parameter Store with appropriate path strategy
      // - For ReserveRecCdkStack (default): /reserve-rec/main/tables/{tableKey}/arn
      // - For custom stacks: /reserve-rec/{stackName}/tables/{tableKey}/arn
      const parameterPath = stackName === 'ReserveRecCdkStack' 
        ? `/reserve-rec/main/tables/${tableKey}/arn`
        : `/reserve-rec/${stackName}/tables/${tableKey}/arn`;
        
      await putParameter(parameterPath, tableArn);
      
      results[tableKey] = {
        tableName: expectedTableName,
        tableArn: tableArn,
        parameterName: parameterPath
      };
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Table management completed successfully',
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
      // Table doesn't exist, we could create it here or handle import
      console.log(`Table ${tableName} does not exist`);
      
      // For now, we'll assume tables should be imported if they exist
      // or created via CDK import process
      throw new Error(`Table ${tableName} not found. Please ensure it exists or use CDK import.`);
    }
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
