#!/usr/bin/env node

/**
 * Generates AI context by fetching and collating multiple GitHub wiki pages
 * into a single markdown document for use as contextual information.
 *
 * Usage: node generateContextFromGHDataModel.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const GITHUB_OWNER = 'bcgov'; // Replace with your GitHub organization
const GITHUB_REPO = 'reserve-rec-api'; // Replace with your repository name
const WIKI_PAGES = [
  'Data-Model',
];

// Page patterns - pages beginning with these strings will be included
const WIKI_PAGE_PREFIXES = [
   'Data-Model', // Example: will fetch all pages beginning with "Data-Model"
];

const OUTPUT_DIR = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'reserve-rec-ai-context.md');
const TEMP_WIKI_DIR = path.join(__dirname, '.temp-wiki');

/**
 * Clone the GitHub wiki repository and return list of pages
 * @returns {Promise<string[]>} Array of wiki page names
 */
async function fetchWikiPageList() {
  try {
    // Clean up any existing temp directory
    if (fs.existsSync(TEMP_WIKI_DIR)) {
      execSync(`rm -rf "${TEMP_WIKI_DIR}"`, { stdio: 'pipe' });
    }

    console.log('Cloning wiki repository...');
    const wikiRepoUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}.wiki.git`;
    execSync(`git clone "${wikiRepoUrl}" "${TEMP_WIKI_DIR}"`, { stdio: 'pipe' });

    // Read all .md files in the wiki directory
    const files = fs.readdirSync(TEMP_WIKI_DIR);
    const pageNames = files
      .filter(f => f.endsWith('.md') && f !== '_Sidebar.md' && f !== '_Footer.md')
      .map(f => f.replace('.md', ''));

    console.log(`Found ${pageNames.length} wiki page(s)`);
    return pageNames;
  } catch (error) {
    console.warn('⚠ Could not clone wiki repository:', error.message);
    return [];
  }
}

/**
 * Fetch a GitHub wiki page content from the local cloned wiki
 * @param {string} pageName - The name of the wiki page (URL-safe format)
 * @returns {Promise<string>} The markdown content of the page
 */
async function fetchWikiPage(pageName) {
  const filePath = path.join(TEMP_WIKI_DIR, `${pageName}.md`);

  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        reject(new Error(`Could not read wiki page: ${pageName}`));
      } else {
        resolve(data);
      }
    });
  });
}

/**
 * Generate the AI context document
 */
async function generateContext() {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log('Fetching GitHub wiki pages...\n');

    // Build the complete list of pages to fetch
    let pagesToFetch = [...WIKI_PAGES];

    // Fetch and filter pages by prefix
    if (WIKI_PAGE_PREFIXES.length > 0) {
      try {
        console.log('Fetching available wiki pages for prefix matching...');
        const availablePages = await fetchWikiPageList();

        for (const prefix of WIKI_PAGE_PREFIXES) {
          const matchingPages = availablePages.filter(page => page.startsWith(prefix));
          console.log(`  Found ${matchingPages.length} page(s) beginning with "${prefix}"`);
          pagesToFetch.push(...matchingPages);
        }
      } catch (error) {
        console.warn('⚠ Could not fetch wiki page list:', error.message);
      }
    }

    // Remove duplicates
    pagesToFetch = [...new Set(pagesToFetch)];

    let contextContent = '# Reserve Rec Context Document for AI Consumption\n\n';
    contextContent += `Generated: ${new Date().toISOString()}\n\n`;
    contextContent += `Repository: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}\n\n`;
    contextContent += '---\n\n';

    // Fetch and collate each wiki page
    for (const pageName of pagesToFetch) {
      try {
        console.log(`Fetching: ${pageName}...`);
        const content = await fetchWikiPage(pageName);

        // Add page to context with a section header
        contextContent += `## ${pageName}\n\n`;
        contextContent += content;
        contextContent += '\n\n---\n\n';

        console.log(`✓ ${pageName} added`);
      } catch (error) {
        console.warn(`⚠ Skipping ${pageName}: ${error.message}`);
      }
    }

    // Write the combined content to file
    fs.writeFileSync(OUTPUT_FILE, contextContent, 'utf8');
    console.log(`\n✓ AI context document generated: ${OUTPUT_FILE}`);
    console.log(`Total size: ${(contextContent.length / 1024).toFixed(2)} KB`);

    // Clean up temp wiki directory
    if (fs.existsSync(TEMP_WIKI_DIR)) {
      execSync(`rm -rf "${TEMP_WIKI_DIR}"`, { stdio: 'pipe' });
    }

    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error('Error generating context:', error);
    // Clean up on error
    if (fs.existsSync(TEMP_WIKI_DIR)) {
      execSync(`rm -rf "${TEMP_WIKI_DIR}"`, { stdio: 'pipe' });
    }
    process.exit(1);
  }
}

// Run the script
generateContext();
