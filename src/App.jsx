import React, { useState, useCallback } from 'react';
import {
    AppLayout,
    Container,
    Header,
    SpaceBetween,
    Box,
    Button,
    Textarea,
    FormField,
    SideNavigation,
    Table,
    Badge,
    HelpPanel,
    Select,
    StatusIndicator,
    Alert,
    Spinner
} from '@cloudscape-design/components';
import { convertSchema, SUPPORTED_ENGINES } from './converter';
import { SAMPLE_SCHEMAS } from './sampleSchema';

const API_URL = import.meta.env.VITE_API_URL || '';
const ENGINE_OPTIONS = SUPPORTED_ENGINES.map(e => ({ value: e.value, label: e.label }));

function App() {
    const [inputSchema, setInputSchema] = useState('');
    const [outputSchema, setOutputSchema] = useState('');
    const [changes, setChanges] = useState([]);
    const [hasOutput, setHasOutput] = useState(false);
    const [selectedEngine, setSelectedEngine] = useState(ENGINE_OPTIONS[0]);
    const [lintResult, setLintResult] = useState(null);
    const [lintLoading, setLintLoading] = useState(false);
    const [lintError, setLintError] = useState(null);

    const [converting, setConverting] = useState(false);

    const handleConvert = useCallback(async () => {
        const input = inputSchema.trim();
        if (!input) return;
        setConverting(true);
        setHasOutput(false);

        if (API_URL) {
            try {
                const response = await fetch(`${API_URL}/convert`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ schema: input }),
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                setOutputSchema(data.converted_schema || '');
                setChanges(data.changes || []);
                setHasOutput(true);
                setConverting(false);
                return;
            } catch (err) {
                // Fall back to local converter
            }
        }

        const result = convertSchema(input, selectedEngine.value);
        setOutputSchema(result.sql);
        setChanges(result.changes);
        setHasOutput(true);
        setConverting(false);
    }, [inputSchema, selectedEngine]);

    const handleLoadSample = () => {
        setInputSchema(SAMPLE_SCHEMAS[selectedEngine.value]);
    };

    const handleClear = () => {
        setInputSchema('');
        setOutputSchema('');
        setChanges([]);
        setHasOutput(false);
        setLintResult(null);
        setLintError(null);
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(outputSchema);
    };

    const handleDownload = () => {
        const blob = new Blob([outputSchema], { type: 'text/sql' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dsql_schema.sql';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleTryInPlayground = () => {
        navigator.clipboard.writeText(outputSchema).then(() => {
            window.open('https://playground.dsql.demo.aws/workspaces/public/edit', '_blank');
        });
    };

    const handleValidate = async () => {
        if (!API_URL) {
            setLintError('Validation API not configured. Set VITE_API_URL environment variable.');
            return;
        }
        setLintLoading(true);
        setLintError(null);
        setLintResult(null);
        try {
            const response = await fetch(`${API_URL}/lint`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: outputSchema }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setLintResult(data);
        } catch (err) {
            setLintError(`Validation failed: ${err.message}`);
        } finally {
            setLintLoading(false);
        }
    };

    const handleApplyFixes = () => {
        if (lintResult && lintResult.fixed_sql) {
            setOutputSchema(lintResult.fixed_sql);
            setLintResult(null);
            changes.push({ type: 'modified', message: 'Applied dsql-lint auto-fixes' });
        }
    };

    const handleDownloadSummary = () => {
        const removed = changes.filter(c => c.type === 'removed');
        const modified = changes.filter(c => c.type === 'modified');
        const info = changes.filter(c => c.type !== 'removed' && c.type !== 'modified');

        const lines = [
            '════════════════════════════════════════════════════════════════',
            '          AURORA DSQL SCHEMA CONVERSION REPORT',
            '════════════════════════════════════════════════════════════════',
            '',
            `  Source Engine:      ${selectedEngine.label}`,
            '  Target Engine:      Amazon Aurora DSQL',
            `  Conversion Date:    ${new Date().toLocaleString()}`,
            `  Total Changes:      ${changes.length}`,
            '',
            '────────────────────────────────────────────────────────────────',
            '  SUMMARY',
            '────────────────────────────────────────────────────────────────',
            '',
            `  Removed:    ${removed.length} unsupported feature(s)`,
            `  Modified:   ${modified.length} compatibility adjustment(s)`,
            `  Info:       ${info.length} informational note(s)`,
            '',
        ];

        if (removed.length > 0) {
            lines.push(
                '────────────────────────────────────────────────────────────────',
                '  REMOVED — Unsupported Features',
                '────────────────────────────────────────────────────────────────',
                '',
                ...removed.map(c => `  • ${c.message}`),
                ''
            );
        }

        if (modified.length > 0) {
            lines.push(
                '────────────────────────────────────────────────────────────────',
                '  MODIFIED — Compatibility Adjustments',
                '────────────────────────────────────────────────────────────────',
                '',
                ...modified.map(c => `  • ${c.message}`),
                ''
            );
        }

        if (info.length > 0) {
            lines.push(
                '────────────────────────────────────────────────────────────────',
                '  INFO — Additional Notes',
                '────────────────────────────────────────────────────────────────',
                '',
                ...info.map(c => `  • ${c.message}`),
                ''
            );
        }

        const nextSteps = ['Review the converted schema for application-specific logic'];
        const allMessages = changes.map(c => c.message.toLowerCase()).join(' ');
        if (allMessages.includes('foreign key')) {
            nextSteps.push('Implement removed foreign key constraints in your application layer');
        }
        if (allMessages.includes('trigger')) {
            nextSteps.push('Replace removed triggers with application-level event handling');
        }
        if (allMessages.includes('pl/pgsql') || allMessages.includes('function') || allMessages.includes('procedure')) {
            nextSteps.push('Rewrite removed PL/pgSQL logic as application code or LANGUAGE SQL functions');
        }
        if (allMessages.includes('extension')) {
            nextSteps.push('Find alternatives for removed PostgreSQL extensions');
        }
        if (allMessages.includes('sequence') || allMessages.includes('identity') || allMessages.includes('serial')) {
            nextSteps.push('Verify identity column and sequence CACHE values meet your throughput needs');
        }
        if (allMessages.includes('partition')) {
            nextSteps.push('Note that DSQL handles data distribution automatically — no manual partitioning needed');
        }
        nextSteps.push('Test the converted schema against an Aurora DSQL cluster');

        lines.push(
            '────────────────────────────────────────────────────────────────',
            '  NEXT STEPS',
            '────────────────────────────────────────────────────────────────',
            '',
            ...nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
            '',
            '════════════════════════════════════════════════════════════════',
            '  Generated by Aurora DSQL Schema Converter',
            '  https://docs.aws.amazon.com/aurora-dsql/',
            '════════════════════════════════════════════════════════════════',
        );

        const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dsql_conversion_report.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleFileUpload = (e) => {
        const files = e.target.files;
        if (!files.length) return;
        const allowed = ['.sql', '.ddl', '.txt', '.pgsql', '.mysql', '.ora', '.tsql'];
        const readers = [];

        Array.from(files).forEach(file => {
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (!allowed.includes(ext)) return;
            readers.push(
                new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({ name: file.name, content: reader.result });
                    reader.readAsText(file);
                })
            );
        });

        Promise.all(readers).then(results => {
            const parts = results.map(r => `-- ========== File: ${r.name} ==========\n${r.content}`);
            setInputSchema(prev => prev ? prev + '\n\n' + parts.join('\n\n') : parts.join('\n\n'));
        });

        e.target.value = '';
    };

    const navigation = (
        <SideNavigation
            header={{
                href: '#/',
                text: 'Aurora DSQL Schema Converter'
            }}
            items={[
                {
                    type: 'section',
                    text: 'Supported Sources',
                    items: [
                        { type: 'link', text: 'PostgreSQL', href: '#' },
                        { type: 'link', text: 'MySQL', href: '#' },
                        { type: 'link', text: 'Oracle', href: '#' },
                        { type: 'link', text: 'SQL Server', href: '#' }
                    ]
                },
                { type: 'divider' },
                {
                    type: 'section',
                    text: 'Migration Considerations',
                    items: [
                        { type: 'link', text: 'Referential Integrity', href: 'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html#dsql-schema-design-patterns', external: true },
                        { type: 'link', text: 'Application-level Logic', href: 'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html#dsql-modern-application-patterns', external: true },
                        { type: 'link', text: 'SQL Functions', href: 'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html#dsql-modern-application-patterns', external: true },
                        { type: 'link', text: 'DDL Alternatives', href: 'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-migration-guide.html#dsql-ddl-alternatives', external: true },
                        { type: 'link', text: 'Sequences & Identity', href: 'https://docs.aws.amazon.com/aurora-dsql/latest/userguide/sequences-identity-columns.html', external: true }
                    ]
                },
                { type: 'divider' },
                {
                    type: 'section',
                    text: 'Resources',
                    items: [
                        { type: 'link', text: 'Aurora DSQL Docs', href: 'https://docs.aws.amazon.com/aurora-dsql/', external: true },
                        { type: 'link', text: 'GitHub Repository', href: 'https://github.com/aws-samples/sample-dsql-schema-convertor', external: true }
                    ]
                }
            ]}
        />
    );

    const helpPanel = (
        <HelpPanel header={<h2>About Aurora DSQL</h2>}>
            <Box>
                <p>
                    Aurora DSQL is a serverless, distributed SQL database with PostgreSQL compatibility.
                    It supports sequences (with explicit CACHE), identity columns, and SQL functions.
                </p>
                <h3>Supported</h3>
                <ul>
                    <li>Sequences (CACHE 1 or &gt;= 65536)</li>
                    <li>Identity columns</li>
                    <li>SQL functions (LANGUAGE SQL)</li>
                    <li>Indexes (CREATE INDEX ASYNC)</li>
                    <li>CHECK, UNIQUE, NOT NULL, DEFAULT</li>
                </ul>
                <h3>Not Supported</h3>
                <ul>
                    <li>Foreign keys</li>
                    <li>Triggers</li>
                    <li>PL/pgSQL functions</li>
                    <li>Extensions</li>
                    <li>Partitioning</li>
                    <li>Table inheritance</li>
                    <li>LISTEN/NOTIFY</li>
                </ul>
            </Box>
        </HelpPanel>
    );

    return (
        <AppLayout
            navigation={navigation}
            tools={helpPanel}
            content={
                <SpaceBetween size="l">
                    <Header
                        variant="h1"
                        description="Convert database schemas from PostgreSQL, MySQL, Oracle, or SQL Server to Aurora DSQL-compatible format"
                    >
                        Aurora DSQL Schema Converter
                    </Header>


                    <Container>
                        <SpaceBetween size="l">
                            <FormField
                                label="Source Database Engine"
                                description="Select the database engine your schema is from"
                            >
                                <Select
                                    selectedOption={selectedEngine}
                                    onChange={({ detail }) => setSelectedEngine(detail.selectedOption)}
                                    options={ENGINE_OPTIONS}
                                />
                            </FormField>

                            <FormField
                                label={`${selectedEngine.label} Schema (Input)`}
                                description={`Paste your ${selectedEngine.label} DDL or upload schema files`}
                                secondaryControl={
                                    <SpaceBetween direction="horizontal" size="xs">
                                        <Button onClick={handleLoadSample}>Load Sample</Button>
                                        <Button onClick={handleClear}>Clear</Button>
                                        <Button iconName="upload">
                                            <label style={{ cursor: 'pointer' }}>
                                                Upload Files
                                                <input
                                                    type="file"
                                                    multiple
                                                    accept=".sql,.ddl,.txt,.pgsql,.mysql,.ora,.tsql"
                                                    onChange={handleFileUpload}
                                                    style={{ display: 'none' }}
                                                />
                                            </label>
                                        </Button>
                                    </SpaceBetween>
                                }
                            >
                                <Textarea
                                    value={inputSchema}
                                    onChange={({ detail }) => setInputSchema(detail.value)}
                                    placeholder={`Paste your ${selectedEngine.label} DDL here...`}
                                    rows={16}
                                />
                            </FormField>

                            <Box textAlign="center">
                                <Button
                                    variant="primary"
                                    onClick={handleConvert}
                                    disabled={!inputSchema.trim()}
                                    loading={converting}
                                >
                                    Convert Schema
                                </Button>
                            </Box>

                            {hasOutput && (<>
                                <FormField
                                    label="Aurora DSQL Schema (Output)"
                                    secondaryControl={
                                        <SpaceBetween direction="horizontal" size="xs">
                                            <Button onClick={handleCopy} iconName="copy">Copy</Button>
                                            <Button onClick={handleDownload} iconName="download">Download</Button>
                                            <span className="playground-btn"><Button onClick={handleTryInPlayground} iconName="external" iconAlign="right">Try in DSQL Playground</Button></span>
                                            {API_URL && (
                                                <Button onClick={handleValidate} loading={lintLoading} iconName="status-positive">
                                                    Validate with DSQL
                                                </Button>
                                            )}
                                        </SpaceBetween>
                                    }
                                >
                                    <Textarea
                                        value={outputSchema}
                                        readOnly
                                        rows={16}
                                    />
                                </FormField>

                                {lintError && (
                                    <Alert type="error" dismissible onDismiss={() => setLintError(null)}>
                                        {lintError}
                                    </Alert>
                                )}

                                {lintResult && (
                                    <Alert
                                        type={lintResult.valid ? "success" : "warning"}
                                        header={lintResult.valid ? "Schema is DSQL-compatible" : `Found ${lintResult.diagnostics.length} issue(s)`}
                                        action={lintResult.fixed_sql ? (
                                            <Button onClick={handleApplyFixes}>Apply Fixes</Button>
                                        ) : null}
                                    >
                                        {!lintResult.valid && (
                                            <ul>
                                                {lintResult.diagnostics.map((d, i) => (
                                                    <li key={i}>{d.message || d.rule}{d.line ? ` (line ${d.line})` : ''}</li>
                                                ))}
                                            </ul>
                                        )}
                                    </Alert>
                                )}
                            </>)}
                        </SpaceBetween>
                    </Container>

                    {changes.length > 0 && (
                        <Container header={
                            <Header
                                variant="h2"
                                actions={
                                    <Button onClick={handleDownloadSummary} iconName="download">
                                        Download Summary
                                    </Button>
                                }
                            >
                                Conversion Summary
                            </Header>
                        }>
                            <Table
                                columnDefinitions={[
                                    {
                                        id: 'type',
                                        header: 'Type',
                                        cell: item => (
                                            <Badge color={
                                                item.type === 'removed' ? 'red' :
                                                item.type === 'modified' ? 'blue' : 'grey'
                                            }>
                                                {item.type.toUpperCase()}
                                            </Badge>
                                        ),
                                        width: 120
                                    },
                                    {
                                        id: 'message',
                                        header: 'Change',
                                        cell: item => item.message
                                    }
                                ]}
                                items={changes}
                                variant="embedded"
                                stripedRows
                            />
                        </Container>
                    )}

                </SpaceBetween>
            }
        />
    );
}

export default App;
