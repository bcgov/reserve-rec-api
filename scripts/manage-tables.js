#!/usr/bin/env node

/**
 * Helper script to manage Dynamo tables via Lambda
 * 
 * This script helps invoke the TableManager Lambda to:
 * 1. Check existing tables
 * 2. Store table ARNs in Parameter Store
 * 3. Adopt sad and lonely tables in CDK stack deployments
 */

const { LambdaClient, InvokeCommand, ListFunctionsCommand } = require('@aws-sdk/client-lambda');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const fs = require('fs');
const path = require('path');

// Load environment configuration
const envConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../env.json'), 'utf8'));

const lambdaClient = new LambdaClient({ 
  region: envConfig.Parameters.REGION || 'ca-central-1' 
});

const cfnClient = new CloudFormationClient({
  region: envConfig.Parameters.REGION || 'ca-central-1'
});

/*
  * Auto-detect the Table Manager Lambda function name

  * @returns {Promise<string>} The detected function name
  */
async function detectTableManagerFunction() {
  try {
    // First try to get it from CloudFormation outputs
    console.log('Looking up Table Manager function name from CloudFormation...');
    
    const cfnCommand = new DescribeStacksCommand({
      StackName: 'ReserveRecTableManager'
    });
    
    const cfnResult = await cfnClient.send(cfnCommand);
    const outputs = cfnResult.Stacks[0]?.Outputs || [];
    
    // Find the output with the function name
    const functionNameOutput = outputs.find(output => 
      output.OutputKey === 'TableManagerFunctionName'
    );
    
    if (functionNameOutput) {
      console.log(`Found function via CloudFormation: ${functionNameOutput.OutputValue}`);
      return functionNameOutput.OutputValue;
    }
    
    throw new Error('Function name not found in CloudFormation outputs');
    
  } catch (cfnError) {
    console.log('CloudFormation lookup failed, trying Lambda API...');
    
    // Fallback search Lambda functions by prefix
    // This assumes the function name starts with 'ReserveRecTableManager-TableManagerFunction'
    const lambdaCommand = new ListFunctionsCommand({});
    const lambdaResult = await lambdaClient.send(lambdaCommand);
    
    const tableManagerFunctions = lambdaResult.Functions.filter(func => 
      func.FunctionName.startsWith('ReserveRecTableManager-TableManagerFunction')
    );
    
    if (tableManagerFunctions.length === 1) {
      console.log(`Found function via Lambda API: ${tableManagerFunctions[0].FunctionName}`);
      return tableManagerFunctions[0].FunctionName;
    } else if (tableManagerFunctions.length > 1) {
      console.log('Multiple Table Manager functions found:');
      tableManagerFunctions.forEach((func, index) => {
        console.log(`  ${index + 1}: ${func.FunctionName}`);
      });
      throw new Error('Multiple functions found. Please specify the function name manually.');
    } else {
      throw new Error('No Table Manager function found. Please deploy the table manager first.');
    }
  }
}

/*
 * Invoke the Lambda function with parameters
 *
 * @param {string} functionName - The name of the Lambda function to invoke 
 * @param {string} stackName - The target stack name (e.g. ReserveRecCdkStack or custom)
 * @param {Object} tableNames - An object with expected table names { main, audit, pubsub }
 * @returns {Promise<Object>} The parsed JSON response from the Lambda function
 */
async function invokeLambda(functionName, stackName, tableNames) {
  const payload = {
    stackName: stackName,
    tableNames: tableNames
  };

  const command = new InvokeCommand({
    FunctionName: functionName,
    Payload: JSON.stringify(payload),
    InvocationType: 'RequestResponse'
  });

  try {
    console.log(`Invoking Table Manager Lambda: ${functionName}`);
    console.log(`Payload:`, JSON.stringify(payload, null, 2));
    
    const response = await lambdaClient.send(command);
    const result = JSON.parse(Buffer.from(response.Payload).toString());
    
    console.log('Lambda Response:', JSON.stringify(result, null, 2));
    return result;
    
  } catch (error) {
    console.error('Error invoking Lambda:', error);
    throw error;
  }
}

// Main script logic
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: 
  node scripts/manage-tables.js [lambda-function-name] [stack-name]
  node scripts/manage-tables.js [stack-name]

Examples:
  # Auto-detect function, default stack
  node scripts/manage-tables.js

  # Auto-detect function, custom stack  
  node scripts/manage-tables.js test

  # Explicit function name, default stack
  node scripts/manage-tables.js ReserveRecTableManager-TableManagerFunction123ABC

  # Explicit function name, custom stack
  node scripts/manage-tables.js ReserveRecTableManager-TableManagerFunction123ABC test

This will:
1. Auto-detect or use specified Table Manager Lambda function
2. Check if tables exist based on naming strategy
3. Store their ARNs in Parameter Store under appropriate paths
4. Allow your CDK stack to reference them seamlessly
    `);
    process.exit(1);
  }

  let functionName;
  let stackName;

  // Parse arguments
  if (args.length === 1) {
    if (args[0].startsWith('ReserveRecTableManager-')) {
      // Argument is a function name, use default stack
      functionName = args[0];
      stackName = 'ReserveRecCdkStack';
    } else {
      // Argument is a stack name, auto-detect function
      functionName = null;
      stackName = args[0];
    }
  } else {
    // Two arguments: function name and stack name
    functionName = args[0];
    stackName = args[1];
  }

  // Auto-detect function name if not provided
  if (!functionName) {
    console.log('Auto-detecting Table Manager function...');
    try {
      functionName = await detectTableManagerFunction();
    } catch (error) {
      console.error('Failed to auto-detect function:', error.message);
      console.log('\nTry deploying the table manager first:');
      console.log('   npm run deploy:table-manager');
      console.log('\nOr specify the function name manually:');
      console.log('   node scripts/manage-tables.js <function-name> <stack-name>');
      process.exit(1);
    }
  }
  
  // Define expected table names based on stack naming strategy
  let tableNames;
  if (stackName === 'ReserveRecCdkStack') {
    // Default stack uses base names
    tableNames = {
      main: 'reserve-rec-main',
      audit: 'reserve-rec-audit',
      pubsub: 'reserve-rec-pubsub'
    };
  } else {
    // Custom stacks (should) use suffixed names
    tableNames = {
      main: `reserve-rec-main-${stackName}`,
      audit: `reserve-rec-audit-${stackName}`,
      pubsub: `reserve-rec-pubsub-${stackName}`
    };
  }

  console.log(`Managing tables for stack: ${stackName}`);
  console.log(`Expected table names:`, tableNames);

  try {
    const result = await invokeLambda(functionName, stackName, tableNames);
    
    if (result.statusCode === 200) {
      console.log('\nTable management completed successfully!');
      console.log('\nNext steps:');
      console.log('1. Deploy your main CDK stack - it will now use the tables from Parameter Store');
      console.log(`2. Run: cdk deploy ${stackName}`);
    } else {
      console.log('\nTable management failed');
      console.log('Check the Lambda logs for more details');
    }
    
  } catch (error) {
    console.error('\nScript execution failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { invokeLambda };
