/**
 * Rule-based PostgreSQL to Aurora DSQL schema converter.
 * Handles known incompatibilities deterministically without any LLM dependency.
 *
 * Aurora DSQL supports (as of 2025):
 *  - Sequences (with explicit CACHE 1 or CACHE >= 65536)
 *  - Identity columns (GENERATED ALWAYS/BY DEFAULT AS IDENTITY)
 *  - SQL functions (LANGUAGE SQL only, NOT PL/pgSQL)
 *
 * Aurora DSQL does NOT support:
 *  - Foreign keys
 *  - Triggers
 *  - PL/pgSQL functions/procedures
 *  - Extensions
 *  - Table inheritance
 *  - Partitioning (auto-distributes)
 *  - LISTEN/NOTIFY
 *  - Temporary tables
 *  - Rules
 */

class DSQLConverter {
    constructor() {
        this.changes = [];
    }

    convert(sql) {
        this.changes = [];
        let result = sql;

        result = this.removeCreateExtension(result);
        result = this.removePlpgsqlFunctions(result);
        result = this.removeTriggers(result);
        result = this.convertSerialTypes(result);
        result = this.removeForeignKeys(result);
        result = this.removeInlineForeignKeys(result);
        result = this.convertSequences(result);
        result = this.removeSetStatements(result);
        result = this.removeInheritance(result);
        result = this.removePartitioning(result);
        result = this.removeTablespaces(result);
        result = this.removeRules(result);
        result = this.removeEventTriggers(result);
        result = this.removeListenNotify(result);
        result = this.convertIdentityColumns(result);
        result = this.addDsqlComments(result);
        result = this.cleanupEmptyLines(result);

        return { sql: result.trim(), changes: this.changes };
    }

    removeCreateExtension(sql) {
        const regex = /CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?[\w"]+[^;]*;/gi;
        const matches = sql.match(regex);
        if (matches) {
            matches.forEach(m => {
                const extName = m.match(/EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed CREATE EXTENSION${extName ? ' ' + extName[1] : ''} — extensions are not supported in DSQL`
                });
            });
            sql = sql.replace(regex, '');
        }
        return sql;
    }

    removePlpgsqlFunctions(sql) {
        // Remove PL/pgSQL functions and procedures (LANGUAGE plpgsql)
        // SQL functions (LANGUAGE SQL) ARE supported in DSQL and should be kept
        const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w."]+)\s*\([^)]*\)[^]*?(?:\$\$[^]*?\$\$|\$[\w]*\$[^]*?\$[\w]*\$)[^;]*;/gi;
        const matches = sql.match(funcRegex);
        if (matches) {
            matches.forEach(m => {
                // Only remove if it uses PL/pgSQL (not LANGUAGE SQL)
                if (/LANGUAGE\s+plpgsql/i.test(m)) {
                    const name = m.match(/(?:FUNCTION|PROCEDURE)\s+([\w."]+)/i);
                    this.changes.push({
                        type: 'removed',
                        message: `Removed PL/pgSQL ${m.match(/FUNCTION/i) ? 'function' : 'procedure'} "${name ? name[1] : 'unknown'}" — only LANGUAGE SQL functions are supported in DSQL. Move this logic to the application layer.`
                    });
                    sql = sql.replace(m, '');
                } else if (/LANGUAGE\s+sql/i.test(m)) {
                    // Keep SQL functions — they are supported
                } else {
                    // No explicit language or other language — remove
                    const name = m.match(/(?:FUNCTION|PROCEDURE)\s+([\w."]+)/i);
                    this.changes.push({
                        type: 'removed',
                        message: `Removed ${m.match(/FUNCTION/i) ? 'function' : 'procedure'} "${name ? name[1] : 'unknown'}" — only LANGUAGE SQL functions are supported in DSQL`
                    });
                    sql = sql.replace(m, '');
                }
            });
        }
        return sql;
    }

    removeTriggers(sql) {
        const regex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([\w"]+)[^;]*;/gi;
        const matches = sql.match(regex);
        if (matches) {
            matches.forEach(m => {
                const name = m.match(/TRIGGER\s+([\w"]+)/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed trigger "${name ? name[1] : 'unknown'}" — triggers are not supported in DSQL. Use application-level event handling.`
                });
            });
            sql = sql.replace(regex, '');
        }
        return sql;
    }

    convertSerialTypes(sql) {
        // SERIAL → INTEGER, BIGSERIAL → BIGINT, SMALLSERIAL → SMALLINT with IDENTITY
        const typeMap = { 'SERIAL': 'INTEGER', 'BIGSERIAL': 'BIGINT', 'SMALLSERIAL': 'SMALLINT' };
        const serialRegex = /(\w+)\s+(BIGSERIAL|SMALLSERIAL|SERIAL)\s*(PRIMARY\s+KEY)?/gi;
        let match;
        const seen = new Set();

        while ((match = serialRegex.exec(sql)) !== null) {
            const colName = match[1];
            const serialType = match[2].toUpperCase();
            const intType = typeMap[serialType];
            if (!seen.has(colName)) {
                seen.add(colName);
                this.changes.push({
                    type: 'modified',
                    message: `Converted "${colName}" from ${serialType} to ${intType} GENERATED BY DEFAULT AS IDENTITY (CACHE 1) — SERIAL shorthand is not directly supported in DSQL`
                });
            }
        }

        sql = sql.replace(
            /(\w+)\s+BIGSERIAL\s+PRIMARY\s+KEY/gi,
            '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY'
        );
        sql = sql.replace(
            /(\w+)\s+SMALLSERIAL\s+PRIMARY\s+KEY/gi,
            '$1 SMALLINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY'
        );
        sql = sql.replace(
            /(\w+)\s+SERIAL\s+PRIMARY\s+KEY/gi,
            '$1 INTEGER GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY'
        );

        // Handle without PRIMARY KEY (BIGSERIAL/SMALLSERIAL first to avoid partial match on SERIAL)
        sql = sql.replace(/(\w+)\s+BIGSERIAL/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');
        sql = sql.replace(/(\w+)\s+SMALLSERIAL/gi, '$1 SMALLINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');
        sql = sql.replace(/(\w+)\s+SERIAL/gi, '$1 INTEGER GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');

        return sql;
    }

    removeForeignKeys(sql) {
        // Remove standalone ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY
        const alterFkRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?([\w."]+)\s+ADD\s+CONSTRAINT\s+([\w"]+)\s+FOREIGN\s+KEY[^;]*;/gi;
        const alterMatches = sql.match(alterFkRegex);
        if (alterMatches) {
            alterMatches.forEach(m => {
                const table = m.match(/TABLE\s+(?:ONLY\s+)?([\w."]+)/i);
                const constraint = m.match(/CONSTRAINT\s+([\w"]+)/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed foreign key constraint "${constraint ? constraint[1] : ''}" on table "${table ? table[1] : ''}" — foreign keys are not supported in DSQL. Manage referential integrity in your application.`
                });
            });
            sql = sql.replace(alterFkRegex, '');
        }

        // Remove CONSTRAINT ... FOREIGN KEY lines within CREATE TABLE
        const inlineFkConstraint = /,?\s*CONSTRAINT\s+[\w"]+\s+FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+[^,)]+(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*\s*/gi;
        const inlineMatches = sql.match(inlineFkConstraint);
        if (inlineMatches) {
            inlineMatches.forEach(() => {
                this.changes.push({
                    type: 'removed',
                    message: `Removed inline FOREIGN KEY constraint — foreign keys are not supported in DSQL`
                });
            });
            sql = sql.replace(inlineFkConstraint, '');
        }

        // Remove standalone FOREIGN KEY lines (without CONSTRAINT keyword)
        const fkLine = /,?\s*FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+[^,)]+(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*\s*/gi;
        const fkMatches = sql.match(fkLine);
        if (fkMatches) {
            fkMatches.forEach(() => {
                this.changes.push({
                    type: 'removed',
                    message: `Removed FOREIGN KEY constraint — foreign keys are not supported in DSQL`
                });
            });
            sql = sql.replace(fkLine, '');
        }

        return sql;
    }

    removeInlineForeignKeys(sql) {
        // Remove inline REFERENCES in column definitions
        const refRegex = /\s+REFERENCES\s+[\w."]+\s*(?:\([^)]*\))?(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi;
        const matches = sql.match(refRegex);
        if (matches) {
            matches.forEach(() => {
                this.changes.push({
                    type: 'removed',
                    message: `Removed inline REFERENCES clause — foreign keys are not supported in DSQL`
                });
            });
            sql = sql.replace(refRegex, '');
        }
        return sql;
    }

    convertSequences(sql) {
        // Convert CREATE SEQUENCE to include required CACHE clause if missing
        const createSeqRegex = /CREATE\s+SEQUENCE\s+(IF\s+NOT\s+EXISTS\s+)?([\w."]+)([^;]*);/gi;
        let match;
        const replacements = [];

        while ((match = createSeqRegex.exec(sql)) !== null) {
            const fullMatch = match[0];
            const ifNotExists = match[1] || '';
            const name = match[2];
            const options = match[3] || '';

            if (!/CACHE\s+/i.test(options)) {
                // No CACHE specified — add CACHE 1
                const newStmt = `CREATE SEQUENCE ${ifNotExists}${name}${options} CACHE 1;`;
                replacements.push({ old: fullMatch, new: newStmt });
                this.changes.push({
                    type: 'modified',
                    message: `Added explicit CACHE 1 to sequence "${name}" — Aurora DSQL requires CACHE to be specified (1 or >= 65536)`
                });
            } else {
                // CACHE is specified — validate the value
                const cacheMatch = options.match(/CACHE\s+(\d+)/i);
                if (cacheMatch) {
                    const cacheVal = parseInt(cacheMatch[1], 10);
                    if (cacheVal !== 1 && cacheVal < 65536) {
                        const newOptions = options.replace(/CACHE\s+\d+/i, 'CACHE 65536');
                        const newStmt = `CREATE SEQUENCE ${ifNotExists}${name}${newOptions};`;
                        replacements.push({ old: fullMatch, new: newStmt });
                        this.changes.push({
                            type: 'modified',
                            message: `Changed CACHE ${cacheVal} to CACHE 65536 on sequence "${name}" — Aurora DSQL only supports CACHE 1 or CACHE >= 65536`
                        });
                    }
                }
            }
        }

        replacements.forEach(r => {
            sql = sql.replace(r.old, r.new);
        });

        // Remove ALTER SEQUENCE (not supported in same way)
        const alterSeqRegex = /ALTER\s+SEQUENCE\s+[\w."]+[^;]*;/gi;
        const alterMatches = sql.match(alterSeqRegex);
        if (alterMatches) {
            this.changes.push({
                type: 'info',
                message: `Removed ${alterMatches.length} ALTER SEQUENCE statement(s) — review and recreate sequences with desired options`
            });
            sql = sql.replace(alterSeqRegex, '');
        }

        // Keep nextval() calls — they are supported in DSQL
        // But convert columns with DEFAULT nextval() that reference a sequence that now has CACHE
        return sql;
    }

    removeSetStatements(sql) {
        const setRegex = /^SET\s+[\w.]+\s*(?:=|TO)\s*[^;]*;\s*$/gim;
        const matches = sql.match(setRegex);
        if (matches) {
            this.changes.push({
                type: 'removed',
                message: `Removed ${matches.length} SET statement(s) — PostgreSQL-specific configuration not applicable to DSQL`
            });
            sql = sql.replace(setRegex, '');
        }
        return sql;
    }

    removeInheritance(sql) {
        const inheritsRegex = /\)\s*INHERITS\s*\([^)]+\)/gi;
        const matches = sql.match(inheritsRegex);
        if (matches) {
            this.changes.push({
                type: 'removed',
                message: `Removed table inheritance (INHERITS) — not supported in DSQL. Consider using separate tables with shared columns.`
            });
            sql = sql.replace(inheritsRegex, ')');
        }
        return sql;
    }

    removePartitioning(sql) {
        const partitionRegex = /\s*PARTITION\s+BY\s+(?:RANGE|LIST|HASH)\s*\([^)]+\)/gi;
        const matches = sql.match(partitionRegex);
        if (matches) {
            this.changes.push({
                type: 'modified',
                message: `Removed PARTITION BY clause — DSQL handles data distribution automatically`
            });
            sql = sql.replace(partitionRegex, '');
        }

        const partOfRegex = /CREATE\s+TABLE\s+[\w."]+\s+PARTITION\s+OF\s+[^;]*;/gi;
        const partOfMatches = sql.match(partOfRegex);
        if (partOfMatches) {
            partOfMatches.forEach(m => {
                const name = m.match(/TABLE\s+([\w."]+)/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed partition table "${name ? name[1] : ''}" — DSQL manages data distribution automatically`
                });
            });
            sql = sql.replace(partOfRegex, '');
        }

        return sql;
    }

    removeTablespaces(sql) {
        const tsRegex = /\s*TABLESPACE\s+[\w"]+/gi;
        const matches = sql.match(tsRegex);
        if (matches) {
            this.changes.push({
                type: 'removed',
                message: `Removed TABLESPACE clause(s) — DSQL manages storage automatically`
            });
            sql = sql.replace(tsRegex, '');
        }
        return sql;
    }

    removeRules(sql) {
        const ruleRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?RULE\s+[\w"]+[^;]*;/gi;
        const matches = sql.match(ruleRegex);
        if (matches) {
            matches.forEach(m => {
                const name = m.match(/RULE\s+([\w"]+)/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed rule "${name ? name[1] : ''}" — rules are not supported in DSQL. Use application logic instead.`
                });
            });
            sql = sql.replace(ruleRegex, '');
        }
        return sql;
    }

    removeEventTriggers(sql) {
        const regex = /CREATE\s+EVENT\s+TRIGGER\s+[\w"]+[^;]*;/gi;
        const matches = sql.match(regex);
        if (matches) {
            this.changes.push({
                type: 'removed',
                message: `Removed event trigger(s) — not supported in DSQL`
            });
            sql = sql.replace(regex, '');
        }
        return sql;
    }

    removeListenNotify(sql) {
        const regex = /(?:LISTEN|NOTIFY|UNLISTEN)\s+[\w"]+[^;]*;/gi;
        const matches = sql.match(regex);
        if (matches) {
            this.changes.push({
                type: 'removed',
                message: `Removed LISTEN/NOTIFY statement(s) — pub/sub not supported in DSQL. Use application-level messaging (SQS, SNS, etc.).`
            });
            sql = sql.replace(regex, '');
        }
        return sql;
    }

    convertIdentityColumns(sql) {
        // Identity columns ARE supported in DSQL — just ensure they have CACHE specified
        const identityRegex = /GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY(?:\s*\(([^)]*)\))?/gi;
        let match;
        const replacements = [];

        while ((match = identityRegex.exec(sql)) !== null) {
            const fullMatch = match[0];
            const options = match[1] || '';

            if (!options || !/CACHE\s+/i.test(options)) {
                const newOptions = options ? `${options.trim()} CACHE 1` : 'CACHE 1';
                const newExpr = fullMatch.replace(
                    /AS\s+IDENTITY(?:\s*\([^)]*\))?/i,
                    `AS IDENTITY (${newOptions})`
                );
                replacements.push({ old: fullMatch, new: newExpr });
            }
        }

        if (replacements.length > 0) {
            this.changes.push({
                type: 'modified',
                message: `Added explicit CACHE to ${replacements.length} identity column(s) — Aurora DSQL requires CACHE to be specified`
            });
            replacements.forEach(r => {
                sql = sql.replace(r.old, r.new);
            });
        }

        return sql;
    }

    addDsqlComments(sql) {
        if (this.changes.length > 0) {
            const header = `-- ============================================================\n-- Converted for Aurora DSQL compatibility\n-- ${this.changes.length} modification(s) applied\n-- ============================================================\n\n`;
            sql = header + sql;
        }
        return sql;
    }

    cleanupEmptyLines(sql) {
        sql = sql.replace(/\n{4,}/g, '\n\n\n');
        return sql;
    }
}

window.DSQLConverter = DSQLConverter;
