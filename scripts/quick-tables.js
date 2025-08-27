#!/usr/bin/env node

/**
 * Quick Table Manager - Simplified interface for common operations
 */

const { execSync } = require('child_process');
const path = require('path');

function runCommand(command, description) {
  console.log(`\n${description}`);
  console.log(`Running: ${command}\n`);
  
  try {
    execSync(command, { stdio: 'inherit', cwd: path.dirname(__dirname) });
    return true;
  } catch (error) {
    console.error(`Command failed: ${error.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('Reserve Rec Table Manager - Quick Commands\n');

  switch (command) {
    case 'deploy':
      runCommand('npm run deploy:table-manager', 'Deploying Table Manager infrastructure...');
      break;

    case 'manage':
      const stackName = args[1] || 'default';
      if (stackName === 'default') {
        runCommand('node scripts/manage-tables.js', 'Managing tables for default stack...');
      } else {
        runCommand(`node scripts/manage-tables.js ${stackName}`, `Managing tables for stack: ${stackName}...`);
      }
      break;

    case 'status':
      console.log('  Checking Table Manager status...\n');
      
      // Check if Table Manager stack exists
      try {
        execSync('aws cloudformation describe-stacks --stack-name ReserveRecTableManager --query "Stacks[0].StackStatus" --output text', { stdio: 'pipe' });
        console.log('Table Manager stack: DEPLOYED');
        
        // Get function name
        const functionName = execSync('aws cloudformation describe-stacks --stack-name ReserveRecTableManager --query "Stacks[0].Outputs[?OutputKey==\`TableManagerFunctionName\`].OutputValue" --output text', { stdio: 'pipe' }).toString().trim();
        console.log(`Function name: ${functionName}`);
        
      } catch (error) {
        console.log('Table Manager stack: NOT DEPLOYED');
        console.log('Run: npm run quick-tables deploy');
      }
      break;

    case 'help':
    default:
      console.log(`Available commands:

    deploy                    Deploy the Table Manager infrastructure
    manage [stack-name]       Manage tables for a stack (default: ReserveRecCdkStack)  
    status                    Check Table Manager deployment status
    help                      Show this help

Examples:
  npm run quick-tables deploy             # Deploy table manager
  npm run quick-tables manage             # Manage default stack tables
  npm run quick-tables manage test    # Manage "test" stack tables  
  npm run quick-tables status             # Check deployment status

Full workflow:
  1. npm run quick-tables deploy          # One-time setup
  2. npm run quick-tables manage test # Register your tables
  3. cdk deploy test                  # Deploy your stack (no errors!)
`);
      break;
  }
}

main().catch(console.error);
