/**
 * Sync DSQL converter rules from latest AWS documentation.
 *
 * Flow:
 *  1. Fetch public Aurora DSQL doc pages
 *  2. Send docs + current converter rules to Claude
 *  3. If Claude suggests changes, write updated converter.js
 *  4. Exit with code 0 (no changes) or 1 (changes written)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONVERTER_PATH = resolve(__dirname, '../src/converter.js');

const DSQL_DOC_URLS = [
    'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-supported-sql-features.html',
    'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-table-syntax-support.html',
    'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/create-sequence-syntax-support.html',
    'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html',
    'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns-overview.html'
];

async function fetchDoc(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return `[FETCH FAILED: ${res.status}] ${url}`;
        const html = await res.text();
        // Strip HTML tags, keep text content
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 15000); // Cap per-page size
    } catch (e) {
        return `[FETCH ERROR] ${url}: ${e.message}`;
    }
}

async function callClaude(prompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        console.error('ERROR: ANTHROPIC_API_KEY not set');
        process.exit(2);
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 16000,
            messages: [{ role: 'user', content: prompt }]
        })
    });

    if (!res.ok) {
        const err = await res.text();
        console.error(`Claude API error: ${res.status} - ${err}`);
        process.exit(2);
    }

    const data = await res.json();
    return data.content[0].text;
}

async function main() {
    console.log('Fetching DSQL documentation...');
    const docs = await Promise.all(DSQL_DOC_URLS.map(fetchDoc));
    const docsText = docs.map((d, i) => `--- Document ${i + 1}: ${DSQL_DOC_URLS[i]} ---\n${d}`).join('\n\n');

    console.log('Reading current converter rules...');
    const currentConverter = readFileSync(CONVERTER_PATH, 'utf-8');

    const prompt = `You are reviewing a PostgreSQL-to-Aurora-DSQL schema converter to ensure its rules match the latest Aurora DSQL documentation.

## Current converter source code:

\`\`\`javascript
${currentConverter}
\`\`\`

## Latest Aurora DSQL documentation:

${docsText}

## Your task:

1. Compare the converter's rules against the documentation.
2. Identify any discrepancies:
   - Features the converter removes that DSQL now supports (false removals)
   - Features DSQL doesn't support that the converter misses (missing removals)
   - Incorrect conversions (wrong replacement syntax)
3. If changes are needed, output the COMPLETE updated converter.js file enclosed in \`\`\`javascript ... \`\`\` blocks.
4. If NO changes are needed, respond with exactly: NO_CHANGES_NEEDED

IMPORTANT RULES:
- Only make changes that are clearly supported by the documentation.
- Do NOT add speculative features or remove rules without clear documentation evidence.
- Keep the same code structure, export format, and function signatures.
- Preserve all existing comments about what's supported/unsupported.
- Update the top-of-file comment block if the supported/unsupported lists change.
- If you're uncertain about a change, do NOT make it. Err on the side of no change.`;

    console.log('Asking Claude to analyze rules vs docs...');
    const response = await callClaude(prompt);

    if (response.includes('NO_CHANGES_NEEDED')) {
        console.log('✓ Converter rules are up to date. No changes needed.');
        process.exit(0);
    }

    // Extract updated code
    const codeMatch = response.match(/```javascript\n([\s\S]*?)```/);
    if (!codeMatch) {
        console.error('ERROR: Claude suggested changes but did not provide valid code block.');
        console.log('Response preview:', response.slice(0, 500));
        process.exit(2);
    }

    const newConverter = codeMatch[1].trim() + '\n';

    // Safeguard: check diff size
    const oldLines = currentConverter.split('\n').length;
    const newLines = newConverter.split('\n').length;
    const diffRatio = Math.abs(newLines - oldLines) / oldLines;

    if (diffRatio > 0.5) {
        console.error(`ERROR: Proposed changes are too large (${Math.round(diffRatio * 100)}% size change). Skipping.`);
        console.error('This likely indicates a hallucination. Manual review required.');
        process.exit(2);
    }

    // Safeguard: ensure core export is preserved
    if (!newConverter.includes('export function convertSchema')) {
        console.error('ERROR: Updated code missing main export. Rejecting.');
        process.exit(2);
    }

    writeFileSync(CONVERTER_PATH, newConverter);
    console.log(`✓ Updated converter.js (${oldLines} → ${newLines} lines)`);

    // Extract what changed for PR description
    const summaryPrompt = `In 3-5 bullet points, summarize what changed between the old and new converter rules. Be specific about which DSQL features were added/removed/modified.\n\nOld top comment:\n${currentConverter.slice(0, 800)}\n\nNew top comment:\n${newConverter.slice(0, 800)}`;

    try {
        const summary = await callClaude(summaryPrompt);
        writeFileSync(resolve(__dirname, '../.sync-summary.md'), summary);
        console.log('✓ Written change summary to .sync-summary.md');
    } catch (e) {
        // Non-fatal — summary is just nice-to-have for the PR
    }

    process.exit(1); // Signal that changes were made
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(2);
});
