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
    ColumnLayout,
    Alert,
    StatusIndicator,
    Tabs,
    SideNavigation,
    Table,
    Badge,
    Link,
    HelpPanel
} from '@cloudscape-design/components';
import { convertSchema } from './converter';
import { SAMPLE_SCHEMA } from './sampleSchema';

function App() {
    const [inputSchema, setInputSchema] = useState('');
    const [outputSchema, setOutputSchema] = useState('');
    const [changes, setChanges] = useState([]);
    const [hasOutput, setHasOutput] = useState(false);

    const handleConvert = useCallback(() => {
        const input = inputSchema.trim();
        if (!input) return;
        const result = convertSchema(input);
        setOutputSchema(result.sql);
        setChanges(result.changes);
        setHasOutput(true);
    }, [inputSchema]);

    const handleLoadSample = () => {
        setInputSchema(SAMPLE_SCHEMA);
    };

    const handleClear = () => {
        setInputSchema('');
        setOutputSchema('');
        setChanges([]);
        setHasOutput(false);
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

    const handleFileUpload = (e) => {
        const files = e.target.files;
        if (!files.length) return;
        const allowed = ['.sql', '.ddl', '.txt', '.pgsql'];
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
                    text: 'DSQL Constraints',
                    items: [
                        { type: 'link', text: 'No Foreign Keys', href: '#' },
                        { type: 'link', text: 'No Triggers', href: '#' },
                        { type: 'link', text: 'No PL/pgSQL', href: '#' },
                        { type: 'link', text: 'No Extensions', href: '#' },
                        { type: 'link', text: 'Sequences require CACHE', href: '#' }
                    ]
                },
                { type: 'divider' },
                {
                    type: 'section',
                    text: 'Resources',
                    items: [
                        { type: 'link', text: 'Aurora DSQL Docs', href: 'https://docs.aws.amazon.com/aurora-dsql/', external: true },
                        { type: 'link', text: 'GitHub Repository', href: 'https://github.com/noql/dsql-schema-convertor', external: true }
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
                        description="Convert PostgreSQL schemas to Aurora DSQL-compatible format"
                    >
                        Aurora DSQL Schema Converter
                    </Header>

                    <Alert type="info">
                        Aurora DSQL supports sequences (with explicit CACHE), identity columns, and SQL functions.
                        It does not support PL/pgSQL, triggers, foreign keys, or extensions. This tool automatically applies the necessary transformations.
                    </Alert>

                    <Container>
                        <SpaceBetween size="l">
                            <FormField
                                label="PostgreSQL Schema (Input)"
                                description="Paste your PostgreSQL DDL or upload .sql files"
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
                                                    accept=".sql,.ddl,.txt,.pgsql"
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
                                    placeholder="Paste your PostgreSQL DDL here..."
                                    rows={16}
                                />
                            </FormField>

                            <Box textAlign="center">
                                <Button
                                    variant="primary"
                                    onClick={handleConvert}
                                    disabled={!inputSchema.trim()}
                                >
                                    Convert Schema
                                </Button>
                            </Box>

                            {hasOutput && (
                                <FormField
                                    label="Aurora DSQL Schema (Output)"
                                    secondaryControl={
                                        <SpaceBetween direction="horizontal" size="xs">
                                            <Button onClick={handleCopy} iconName="copy">Copy</Button>
                                            <Button onClick={handleDownload} iconName="download">Download</Button>
                                        </SpaceBetween>
                                    }
                                >
                                    <Textarea
                                        value={outputSchema}
                                        readOnly
                                        rows={16}
                                    />
                                </FormField>
                            )}
                        </SpaceBetween>
                    </Container>

                    {changes.length > 0 && (
                        <Container header={<Header variant="h2">Conversion Summary</Header>}>
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

                    <Container header={<Header variant="h2">Aurora DSQL Key Constraints</Header>}>
                        <ColumnLayout columns={3} variant="text-grid">
                            <div>
                                <Box variant="awsui-key-label">
                                    <StatusIndicator type="warning">Sequences require CACHE</StatusIndicator>
                                </Box>
                                <Box variant="p">
                                    Sequences are supported but require explicit <code>CACHE 1</code> or <code>CACHE &gt;= 65536</code>. SERIAL types are converted to identity columns.
                                </Box>
                            </div>
                            <div>
                                <Box variant="awsui-key-label">
                                    <StatusIndicator type="error">No Foreign Keys</StatusIndicator>
                                </Box>
                                <Box variant="p">
                                    Foreign key constraints are not supported. Manage referential integrity in your application.
                                </Box>
                            </div>
                            <div>
                                <Box variant="awsui-key-label">
                                    <StatusIndicator type="warning">SQL Functions Only</StatusIndicator>
                                </Box>
                                <Box variant="p">
                                    Only <code>LANGUAGE SQL</code> functions are supported. PL/pgSQL must be moved to the application layer.
                                </Box>
                            </div>
                            <div>
                                <Box variant="awsui-key-label">
                                    <StatusIndicator type="error">No Triggers</StatusIndicator>
                                </Box>
                                <Box variant="p">
                                    Triggers cannot be created. Use application-level event handling instead.
                                </Box>
                            </div>
                            <div>
                                <Box variant="awsui-key-label">
                                    <StatusIndicator type="error">No Extensions</StatusIndicator>
                                </Box>
                                <Box variant="p">
                                    PostgreSQL extensions (e.g., PostGIS, pg_trgm) are not available.
                                </Box>
                            </div>
                            <div>
                                <Box variant="awsui-key-label">
                                    <StatusIndicator type="info">Async Indexes</StatusIndicator>
                                </Box>
                                <Box variant="p">
                                    Use <code>CREATE INDEX ASYNC</code> for non-blocking index creation.
                                </Box>
                            </div>
                        </ColumnLayout>
                    </Container>
                </SpaceBetween>
            }
        />
    );
}

export default App;
