# GitHub Wiki to AI Context Generator

A Node.js script that clones a GitHub wiki repository and collates multiple wiki pages into a single markdown document for use as AI context.

## What It Does

This script:
1. Clones the GitHub wiki for a specified repository
2. Discovers all wiki pages (filtering out special pages like `_Sidebar.md`)
3. Fetches pages matching exact names or prefix patterns
4. Combines them into a single markdown document with section headers
5. Cleans up temporary files

## Configuration

Edit the configuration section at the top of `generateContextFromGHDataModel.js`:

```javascript
const GITHUB_OWNER = 'bcgov';                    // GitHub organization/user
const GITHUB_REPO = 'reserve-rec-api';           // Repository name
const WIKI_PAGES = ['Data-Model'];               // Exact page names to include
const WIKI_PAGE_PREFIXES = ['Data-Model'];       // Prefix patterns to match
```

```bash
node generateContextFromGHDataModel.js
```
## Output

The generated markdown file includes:
- A header with generation timestamp
- Link to the source repository
- Each wiki page as a numbered section
- Separator lines between sections

## Use

Feed the output file to your AI client of choice to provide up-to-date data-model context.

```
Flush all prior context. Rebuild your understanding entirely from this markdown: <reserve-rec-ai-context.md>
```