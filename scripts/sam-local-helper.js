#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SAMLocalRunner {
    constructor(cdkOutDir) {
        this.cdkOutDir = cdkOutDir;
        this.samTemplates = [];
    }

    /**
     * Find all generated SAM templates
     */
    findSAMTemplates() {
        const files = fs.readdirSync(this.cdkOutDir);
        this.samTemplates = files
            .filter(file => file.startsWith('sam-') && file.endsWith('.yaml'))
            .map(file => path.join(this.cdkOutDir, file));

        return this.samTemplates;
    }

    /**
     * List available SAM templates
     */
    listTemplates() {
        const templates = this.findSAMTemplates();

        console.log('🏗️  Available SAM Templates:');
        console.log('=====================================');

        if (templates.length === 0) {
            console.log('❌ No SAM templates found.');
            console.log('   Run "node scripts/generate-sam-templates.js" first to generate them.');
            return false;
        }

        templates.forEach((template, index) => {
            const name = path.basename(template);
            const stats = fs.statSync(template);
            console.log(`${index + 1}. ${name}`);
            console.log(`   📁 Path: ${template}`);
            console.log(`   📅 Modified: ${stats.mtime.toLocaleString()}`);
            console.log(`   📏 Size: ${(stats.size / 1024).toFixed(1)} KB`);
            console.log('');
        });

        return true;
    }

    /**
     * Get usage instructions for a specific template
     */
    getUsageInstructions(templatePath) {
        const templateName = path.basename(templatePath);
        const relativePath = path.relative(process.cwd(), templatePath);

        console.log(`🚀 Usage Instructions for ${templateName}`);
        console.log('=====================================');
        console.log('');

        console.log('1. Start SAM Local API:');
        console.log(`   sam local start-api -t ${relativePath} --port 3000`);
        console.log('');

        console.log('2. Alternative with debug mode:');
        console.log(`   sam local start-api -t ${relativePath} --port 3000 --debug`);
        console.log('');

        console.log('3. Test the API endpoints:');
        this.printAPIEndpoints(templatePath);
        console.log('');

        console.log('📋 Additional SAM Local Commands:');
        console.log('   - Invoke specific function:');
        console.log(`     sam local invoke <FunctionName> -t ${relativePath} -e test-event.json`);
        console.log('   - Generate sample events:');
        console.log('     sam local generate-event apigateway aws-proxy --method GET --path /test');
        console.log('');

        console.log('⚠️  Prerequisites:');
        console.log('   - AWS SAM CLI installed (https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)');
        console.log('   - Docker installed and running');
        console.log('   - AWS credentials configured (aws configure)');
    }

    /**
     * Extract and print API endpoints from SAM template
     */
    printAPIEndpoints(templatePath) {
        try {
            const content = fs.readFileSync(templatePath, 'utf8');
            const endpoints = this.extractEndpoints(content);

            if (endpoints.length > 0) {
                console.log('   Available endpoints:');
                endpoints.forEach(endpoint => {
                    console.log(`     ${endpoint.method} http://localhost:3000${endpoint.path}`);
                });
            } else {
                console.log('   No API endpoints found in template');
            }
        } catch (error) {
            console.log('   Could not parse template for endpoints');
        }
    }

    /**
     * Extract endpoints from YAML content
     */
    extractEndpoints(yamlContent) {
        const endpoints = [];
        const lines = yamlContent.split('\n');

        let currentPath = null;
        let currentMethod = null;

        lines.forEach(line => {
            // Look for Path definitions
            const pathMatch = line.match(/^\s*Path:\s*(.+)$/);
            if (pathMatch) {
                currentPath = pathMatch[1].replace(/['"]/g, '');
            }

            // Look for Method definitions
            const methodMatch = line.match(/^\s*Method:\s*(.+)$/);
            if (methodMatch) {
                currentMethod = methodMatch[1].replace(/['"]/g, '');

                if (currentPath && currentMethod) {
                    endpoints.push({
                        path: currentPath,
                        method: currentMethod
                    });
                }
            }
        });

        return endpoints;
    }

    /**
     * Run interactive mode
     */
    interactive() {
        const templates = this.findSAMTemplates();

        if (!this.listTemplates()) {
            return;
        }

        console.log('🎯 Select a template to get usage instructions:');
        console.log('   (Or run with template name: node scripts/sam-local-helper.js <template-name>)');
        console.log('');

        // For now, just show instructions for the first template
        if (templates.length > 0) {
            this.getUsageInstructions(templates[0]);
        }
    }

    /**
     * Validate template
     */
    validateTemplate(templatePath) {
        console.log(`🔍 Validating SAM template: ${path.basename(templatePath)}`);

        try {
            // Check if SAM CLI is available
            execSync('sam --version', { stdio: 'pipe' });

            // Validate the template
            execSync(`sam validate -t "${templatePath}"`, { stdio: 'pipe' });
            console.log('✅ Template is valid!');
            return true;

        } catch (error) {
            if (error.message.includes('sam: command not found') || error.message.includes('sam is not recognized')) {
                console.log('⚠️  SAM CLI not found. Please install it first:');
                console.log('   https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html');
            } else {
                console.log('❌ Template validation failed:');
                console.log(error.message);
            }
            return false;
        }
    }

    /**
     * Create a simple test event file
     */
    createTestEvent(templatePath) {
        const testEventPath = path.join(path.dirname(templatePath), 'test-event.json');

        const testEvent = {
            "httpMethod": "GET",
            "path": "/test",
            "pathParameters": null,
            "queryStringParameters": null,
            "headers": {
                "Accept": "application/json"
            },
            "body": null,
            "isBase64Encoded": false,
            "requestContext": {
                "accountId": "123456789012",
                "apiId": "test-api",
                "stage": "local",
                "requestId": "test-request",
                "httpMethod": "GET",
                "path": "/test"
            }
        };

        fs.writeFileSync(testEventPath, JSON.stringify(testEvent, null, 2));
        console.log(`📝 Created test event file: ${testEventPath}`);

        return testEventPath;
    }
}

// Main execution
function main() {
    const cdkOutDir = path.join(__dirname, '..', 'cdk.out');
    const runner = new SAMLocalRunner(cdkOutDir);

    // Check command line arguments
    const args = process.argv.slice(2);

    if (args.length === 0) {
        // Interactive mode
        runner.interactive();
    } else if (args[0] === 'list') {
        // List templates
        runner.listTemplates();
    } else if (args[0] === 'validate') {
        // Validate all templates
        const templates = runner.findSAMTemplates();
        templates.forEach(template => {
            runner.validateTemplate(template);
        });
    } else {
        // Show instructions for specific template
        const templateName = args[0];
        const templates = runner.findSAMTemplates();
        const template = templates.find(t => path.basename(t).includes(templateName));

        if (template) {
            runner.getUsageInstructions(template);

            if (args.includes('--validate')) {
                runner.validateTemplate(template);
            }

            if (args.includes('--create-test-event')) {
                runner.createTestEvent(template);
            }
        } else {
            console.log(`❌ Template not found: ${templateName}`);
            console.log('Available templates:');
            runner.listTemplates();
        }
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { SAMLocalRunner };