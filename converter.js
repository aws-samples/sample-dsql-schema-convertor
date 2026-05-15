/**
 * Rule-based PostgreSQL to Aurora DSQL schema converter.
 * Handles known incompatibilities deterministically without any LLM dependency.
 */

class DSQLConverter {
    constructor() {
        this.changes = [];
    }

    convert(sql) {
        this.changes = [];
        let result = sql;

        result = this.removeCreateExtension(result);
        result = this.removeStoredProcedures(result);
        result = this.removeTriggerFunctions(result);
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

    removeStoredProcedures(sql) {
        // Remove CREATE FUNCTION / CREATE PROCEDURE blocks
        const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w."]+)\s*\([^)]*\)[^]*?(?:\$\$[^]*?\$\$|\$[\w]*\$[^]*?\$[\w]*\$)[^;]*;/gi;
        const matches = sql.match(funcRegex);
        if (matches) {
            matches.forEach(m => {
                const name = m.match(/(?:FUNCTION|PROCEDURE)\s+([\w."]+)/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed ${m.match(/FUNCTION/i) ? 'function' : 'procedure'} "${name ? name[1] : 'unknown'}" — stored procedures/functions are not supported in DSQL. Move this logic to the application layer.`
                });
            });
            sql = sql.replace(funcRegex, '');
        }
        return sql;
    }

    removeTriggerFunctions(sql) {
        // Remove remaining trigger function definitions that might not have been caught
        const regex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(\s*\)\s*RETURNS\s+TRIGGER[^]*?(?:\$\$[^]*?\$\$|\$[\w]*\$[^]*?\$[\w]*\$)[^;]*;/gi;
        const matches = sql.match(regex);
        if (matches) {
            matches.forEach(m => {
                const name = m.match(/FUNCTION\s+([\w."]+)/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed trigger function "${name ? name[1] : 'unknown'}" — triggers are not supported in DSQL`
                });
            });
            sql = sql.replace(regex, '');
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
        // SERIAL → UUID with gen_random_uuid()
        const serialRegex = /(\w+)\s+(BIGSERIAL|SERIAL|SMALLSERIAL)\s*(PRIMARY\s+KEY)?/gi;
        let match;
        const seen = new Set();

        while ((match = serialRegex.exec(sql)) !== null) {
            const colName = match[1];
            const serialType = match[2];
            if (!seen.has(colName)) {
                seen.add(colName);
                this.changes.push({
                    type: 'modified',
                    message: `Converted "${colName}" from ${serialType.toUpperCase()} to UUID with gen_random_uuid() — sequences are not supported in DSQL`
                });
            }
        }

        sql = sql.replace(
            /(\w+)\s+BIGSERIAL\s+PRIMARY\s+KEY/gi,
            '$1 UUID PRIMARY KEY DEFAULT gen_random_uuid()'
        );
        sql = sql.replace(
            /(\w+)\s+SERIAL\s+PRIMARY\s+KEY/gi,
            '$1 UUID PRIMARY KEY DEFAULT gen_random_uuid()'
        );
        sql = sql.replace(
            /(\w+)\s+SMALLSERIAL\s+PRIMARY\s+KEY/gi,
            '$1 UUID PRIMARY KEY DEFAULT gen_random_uuid()'
        );

        // Handle SERIAL without PRIMARY KEY
        sql = sql.replace(/(\w+)\s+BIGSERIAL/gi, '$1 UUID DEFAULT gen_random_uuid()');
        sql = sql.replace(/(\w+)\s+SERIAL/gi, '$1 UUID DEFAULT gen_random_uuid()');
        sql = sql.replace(/(\w+)\s+SMALLSERIAL/gi, '$1 UUID DEFAULT gen_random_uuid()');

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
                    message: `Removed foreign key constraint "${constraint ? constraint[1] : ''}" on table "${table ? table[1] : ''}" — foreign keys are not enforced in DSQL. Manage referential integrity in your application.`
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
                    message: `Removed inline FOREIGN KEY constraint — foreign keys are not enforced in DSQL`
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
                    message: `Removed FOREIGN KEY constraint — foreign keys are not enforced in DSQL`
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
                    message: `Removed inline REFERENCES clause — foreign keys are not enforced in DSQL`
                });
            });
            sql = sql.replace(refRegex, '');
        }
        return sql;
    }

    convertSequences(sql) {
        // Remove CREATE SEQUENCE
        const createSeqRegex = /CREATE\s+SEQUENCE\s+(IF\s+NOT\s+EXISTS\s+)?([\w."]+)[^;]*;/gi;
        const matches = sql.match(createSeqRegex);
        if (matches) {
            matches.forEach(m => {
                const name = m.match(/SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i);
                this.changes.push({
                    type: 'removed',
                    message: `Removed sequence "${name ? name[1] : ''}" — sequences are not supported in DSQL. Use gen_random_uuid() or application-generated IDs.`
                });
            });
            sql = sql.replace(createSeqRegex, '');
        }

        // Remove ALTER SEQUENCE
        const alterSeqRegex = /ALTER\s+SEQUENCE\s+[\w."]+[^;]*;/gi;
        const alterMatches = sql.match(alterSeqRegex);
        if (alterMatches) {
            sql = sql.replace(alterSeqRegex, '');
        }

        // Replace nextval() calls with gen_random_uuid()
        const nextvalRegex = /DEFAULT\s+nextval\([^)]+\)/gi;
        if (nextvalRegex.test(sql)) {
            this.changes.push({
                type: 'modified',
                message: `Replaced nextval() defaults with gen_random_uuid() — sequences are not supported in DSQL`
            });
            sql = sql.replace(/DEFAULT\s+nextval\([^)]+\)/gi, 'DEFAULT gen_random_uuid()');
        }

        return sql;
    }

    removeSetStatements(sql) {
        // Remove SET statements that configure PG-specific behavior
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
        // Remove INHERITS clauses
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
        // Remove PARTITION BY clauses
        const partitionRegex = /\s*PARTITION\s+BY\s+(?:RANGE|LIST|HASH)\s*\([^)]+\)/gi;
        const matches = sql.match(partitionRegex);
        if (matches) {
            this.changes.push({
                type: 'modified',
                message: `Removed PARTITION BY clause — table partitioning syntax differs in DSQL. DSQL handles distribution automatically.`
            });
            sql = sql.replace(partitionRegex, '');
        }

        // Remove CREATE TABLE ... PARTITION OF
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
        // Remove TABLESPACE clauses
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
        // Convert GENERATED ALWAYS AS IDENTITY / GENERATED BY DEFAULT AS IDENTITY
        const identityRegex = /(\w+)\s+(\w+)\s+GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY(?:\s*\([^)]*\))?/gi;
        let match;
        const seen = new Set();

        while ((match = identityRegex.exec(sql)) !== null) {
            const colName = match[1];
            if (!seen.has(colName)) {
                seen.add(colName);
                this.changes.push({
                    type: 'modified',
                    message: `Converted identity column "${colName}" to UUID with gen_random_uuid() — identity columns use sequences internally, which are not supported in DSQL`
                });
            }
        }

        sql = sql.replace(
            /(\w+)\s+(?:INTEGER|INT|BIGINT|SMALLINT)\s+GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY(?:\s*\([^)]*\))?/gi,
            '$1 UUID DEFAULT gen_random_uuid()'
        );

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
        // Collapse 3+ consecutive blank lines into 2
        sql = sql.replace(/\n{4,}/g, '\n\n\n');
        return sql;
    }
}

// Export for use in app.js
window.DSQLConverter = DSQLConverter;
