/**
 * Rule-based schema converter for Aurora DSQL.
 *
 * Supports input from: PostgreSQL, MySQL, Oracle, SQL Server.
 * Output is always Aurora DSQL-compatible PostgreSQL DDL.
 *
 * Two-phase approach:
 *  1. Normalize source engine DDL to PG-compatible DDL
 *  2. Apply DSQL compatibility rules
 */

import { normalizeMysql } from './engines/mysql.js';
import { normalizeOracle } from './engines/oracle.js';
import { normalizeSqlServer } from './engines/sqlserver.js';

export const SUPPORTED_ENGINES = [
    { value: 'postgresql', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'oracle', label: 'Oracle' },
    { value: 'sqlserver', label: 'SQL Server' },
];

export function convertSchema(sql, engine = 'postgresql') {
    const changes = [];
    let result = sql;

    if (engine !== 'postgresql') {
        result = normalizeToPostgres(result, engine, changes);
    }

    result = removeCreateExtension(result, changes);
    result = removePlpgsqlFunctions(result, changes);
    result = removeTriggers(result, changes);
    result = convertSerialTypes(result, changes);
    result = removeForeignKeys(result, changes);
    result = removeInlineForeignKeys(result, changes);
    result = convertSequences(result, changes);
    result = removeSetStatements(result, changes);
    result = removeInheritance(result, changes);
    result = removePartitioning(result, changes);
    result = removeTablespaces(result, changes);
    result = removeRules(result, changes);
    result = removeEventTriggers(result, changes);
    result = removeListenNotify(result, changes);
    result = convertIdentityColumns(result, changes);
    result = addDsqlComments(result, changes);
    result = cleanupEmptyLines(result);

    return { sql: result.trim(), changes };
}

function normalizeToPostgres(sql, engine, changes) {
    switch (engine) {
        case 'mysql':
            return normalizeMysql(sql, changes);
        case 'oracle':
            return normalizeOracle(sql, changes);
        case 'sqlserver':
            return normalizeSqlServer(sql, changes);
        default:
            return sql;
    }
}

function removeCreateExtension(sql, changes) {
    const regex = /CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?[\w"]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        matches.forEach(m => {
            const extName = m.match(/EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/i);
            changes.push({
                type: 'removed',
                message: `Removed CREATE EXTENSION${extName ? ' ' + extName[1] : ''} — extensions are not supported in DSQL`
            });
        });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removePlpgsqlFunctions(sql, changes) {
    const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+([\w."]+)\s*\([^)]*\)[^]*?(?:\$\$[^]*?\$\$|\$[\w]*\$[^]*?\$[\w]*\$)[^;]*;/gi;
    const matches = sql.match(funcRegex);
    if (matches) {
        matches.forEach(m => {
            if (/LANGUAGE\s+plpgsql/i.test(m)) {
                const name = m.match(/(?:FUNCTION|PROCEDURE)\s+([\w."]+)/i);
                changes.push({
                    type: 'removed',
                    message: `Removed PL/pgSQL ${m.match(/FUNCTION/i) ? 'function' : 'procedure'} "${name ? name[1] : 'unknown'}" — only LANGUAGE SQL functions are supported in DSQL`
                });
                sql = sql.replace(m, '');
            } else if (/LANGUAGE\s+sql/i.test(m)) {
                // Keep SQL functions
            } else {
                const name = m.match(/(?:FUNCTION|PROCEDURE)\s+([\w."]+)/i);
                changes.push({
                    type: 'removed',
                    message: `Removed ${m.match(/FUNCTION/i) ? 'function' : 'procedure'} "${name ? name[1] : 'unknown'}" — only LANGUAGE SQL functions are supported in DSQL`
                });
                sql = sql.replace(m, '');
            }
        });
    }
    return sql;
}

function removeTriggers(sql, changes) {
    const regex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([\w"]+)[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        matches.forEach(m => {
            const name = m.match(/TRIGGER\s+([\w"]+)/i);
            changes.push({
                type: 'removed',
                message: `Removed trigger "${name ? name[1] : 'unknown'}" — triggers are not supported in DSQL`
            });
        });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function convertSerialTypes(sql, changes) {
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
            changes.push({
                type: 'modified',
                message: `Converted "${colName}" from ${serialType} to ${intType} GENERATED BY DEFAULT AS IDENTITY (CACHE 1)`
            });
        }
    }

    sql = sql.replace(/(\w+)\s+BIGSERIAL\s+PRIMARY\s+KEY/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY');
    sql = sql.replace(/(\w+)\s+SMALLSERIAL\s+PRIMARY\s+KEY/gi, '$1 SMALLINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY');
    sql = sql.replace(/(\w+)\s+SERIAL\s+PRIMARY\s+KEY/gi, '$1 INTEGER GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY');
    sql = sql.replace(/(\w+)\s+BIGSERIAL/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');
    sql = sql.replace(/(\w+)\s+SMALLSERIAL/gi, '$1 SMALLINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');
    sql = sql.replace(/(\w+)\s+SERIAL/gi, '$1 INTEGER GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');

    return sql;
}

function removeForeignKeys(sql, changes) {
    const alterFkRegex = /ALTER\s+TABLE\s+(?:ONLY\s+)?([\w."]+)\s+ADD\s+CONSTRAINT\s+([\w"]+)\s+FOREIGN\s+KEY[^;]*;/gi;
    const alterMatches = sql.match(alterFkRegex);
    if (alterMatches) {
        alterMatches.forEach(m => {
            const table = m.match(/TABLE\s+(?:ONLY\s+)?([\w."]+)/i);
            const constraint = m.match(/CONSTRAINT\s+([\w"]+)/i);
            changes.push({
                type: 'removed',
                message: `Removed FK "${constraint ? constraint[1] : ''}" on "${table ? table[1] : ''}" — foreign keys not supported in DSQL`
            });
        });
        sql = sql.replace(alterFkRegex, '');
    }

    const inlineFkConstraint = /,?[ \t]*\n?[ \t]*CONSTRAINT\s+[\w"]+\s+FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+[\w."]+\s*(?:\([^)]*\))?(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi;
    const inlineMatches = sql.match(inlineFkConstraint);
    if (inlineMatches) {
        inlineMatches.forEach(() => {
            changes.push({ type: 'removed', message: 'Removed inline FOREIGN KEY constraint' });
        });
        sql = sql.replace(inlineFkConstraint, '');
    }

    const fkLine = /,?[ \t]*\n?[ \t]*FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+[\w."]+\s*(?:\([^)]*\))?(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi;
    const fkMatches = sql.match(fkLine);
    if (fkMatches) {
        fkMatches.forEach(() => {
            changes.push({ type: 'removed', message: 'Removed FOREIGN KEY constraint' });
        });
        sql = sql.replace(fkLine, '');
    }

    sql = sql.replace(/,(\s*\))/g, '$1');

    return sql;
}

function removeInlineForeignKeys(sql, changes) {
    const refRegex = /\s+REFERENCES\s+[\w."]+\s*(?:\([^)]*\))?(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))*/gi;
    const matches = sql.match(refRegex);
    if (matches) {
        matches.forEach(() => {
            changes.push({ type: 'removed', message: 'Removed inline REFERENCES clause' });
        });
        sql = sql.replace(refRegex, '');
    }
    return sql;
}

function convertSequences(sql, changes) {
    const createSeqRegex = /CREATE\s+SEQUENCE\s+(IF\s+NOT\s+EXISTS\s+)?([\w."]+)([^;]*);/gi;
    let match;
    const replacements = [];

    while ((match = createSeqRegex.exec(sql)) !== null) {
        const fullMatch = match[0];
        const ifNotExists = match[1] || '';
        const name = match[2];
        const options = match[3] || '';

        if (!/CACHE\s+/i.test(options)) {
            const newStmt = `CREATE SEQUENCE ${ifNotExists}${name}${options} CACHE 1;`;
            replacements.push({ old: fullMatch, new: newStmt });
            changes.push({
                type: 'modified',
                message: `Added CACHE 1 to sequence "${name}" — DSQL requires explicit CACHE (1 or >= 65536)`
            });
        } else {
            const cacheMatch = options.match(/CACHE\s+(\d+)/i);
            if (cacheMatch) {
                const cacheVal = parseInt(cacheMatch[1], 10);
                if (cacheVal !== 1 && cacheVal < 65536) {
                    const newOptions = options.replace(/CACHE\s+\d+/i, 'CACHE 65536');
                    const newStmt = `CREATE SEQUENCE ${ifNotExists}${name}${newOptions};`;
                    replacements.push({ old: fullMatch, new: newStmt });
                    changes.push({
                        type: 'modified',
                        message: `Changed CACHE ${cacheVal} to CACHE 65536 on sequence "${name}" — DSQL only supports CACHE 1 or >= 65536`
                    });
                }
            }
        }
    }

    replacements.forEach(r => { sql = sql.replace(r.old, r.new); });

    const alterSeqRegex = /ALTER\s+SEQUENCE\s+[\w."]+[^;]*;/gi;
    const alterMatches = sql.match(alterSeqRegex);
    if (alterMatches) {
        changes.push({ type: 'info', message: `Removed ${alterMatches.length} ALTER SEQUENCE statement(s)` });
        sql = sql.replace(alterSeqRegex, '');
    }

    return sql;
}

function removeSetStatements(sql, changes) {
    const setRegex = /^SET\s+[\w.]+\s*(?:=|TO)\s*[^;]*;\s*$/gim;
    const matches = sql.match(setRegex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} SET statement(s)` });
        sql = sql.replace(setRegex, '');
    }
    return sql;
}

function removeInheritance(sql, changes) {
    const inheritsRegex = /\)\s*INHERITS\s*\([^)]+\)/gi;
    const matches = sql.match(inheritsRegex);
    if (matches) {
        changes.push({ type: 'removed', message: 'Removed table inheritance (INHERITS) — not supported in DSQL' });
        sql = sql.replace(inheritsRegex, ')');
    }
    return sql;
}

function removePartitioning(sql, changes) {
    const partitionRegex = /\s*PARTITION\s+BY\s+(?:RANGE|LIST|HASH)\s*\([^)]+\)/gi;
    const matches = sql.match(partitionRegex);
    if (matches) {
        changes.push({ type: 'modified', message: 'Removed PARTITION BY — DSQL handles distribution automatically' });
        sql = sql.replace(partitionRegex, '');
    }

    const partOfRegex = /CREATE\s+TABLE\s+[\w."]+\s+PARTITION\s+OF\s+[^;]*;/gi;
    const partOfMatches = sql.match(partOfRegex);
    if (partOfMatches) {
        partOfMatches.forEach(m => {
            const name = m.match(/TABLE\s+([\w."]+)/i);
            changes.push({ type: 'removed', message: `Removed partition table "${name ? name[1] : ''}"` });
        });
        sql = sql.replace(partOfRegex, '');
    }

    return sql;
}

function removeTablespaces(sql, changes) {
    const tsRegex = /\s*TABLESPACE\s+[\w"]+/gi;
    const matches = sql.match(tsRegex);
    if (matches) {
        changes.push({ type: 'removed', message: 'Removed TABLESPACE clause(s)' });
        sql = sql.replace(tsRegex, '');
    }
    return sql;
}

function removeRules(sql, changes) {
    const ruleRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?RULE\s+[\w"]+[^;]*;/gi;
    const matches = sql.match(ruleRegex);
    if (matches) {
        matches.forEach(m => {
            const name = m.match(/RULE\s+([\w"]+)/i);
            changes.push({ type: 'removed', message: `Removed rule "${name ? name[1] : ''}"` });
        });
        sql = sql.replace(ruleRegex, '');
    }
    return sql;
}

function removeEventTriggers(sql, changes) {
    const regex = /CREATE\s+EVENT\s+TRIGGER\s+[\w"]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: 'Removed event trigger(s)' });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeListenNotify(sql, changes) {
    const regex = /(?:LISTEN|NOTIFY|UNLISTEN)\s+[\w"]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: 'Removed LISTEN/NOTIFY statement(s)' });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function convertIdentityColumns(sql, changes) {
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
        changes.push({ type: 'modified', message: `Added CACHE to ${replacements.length} identity column(s)` });
        replacements.forEach(r => { sql = sql.replace(r.old, r.new); });
    }

    return sql;
}

function addDsqlComments(sql, changes) {
    if (changes.length > 0) {
        const header = `-- ============================================================\n-- Converted for Aurora DSQL compatibility\n-- ${changes.length} modification(s) applied\n-- ============================================================\n\n`;
        sql = header + sql;
    }
    return sql;
}

function cleanupEmptyLines(sql) {
    return sql.replace(/\n{4,}/g, '\n\n\n');
}
