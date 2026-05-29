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
    result = removeDropExtension(result, changes);
    result = removeProcedures(result, changes);
    result = removePlpgsqlFunctions(result, changes);
    result = removeTriggers(result, changes);
    result = convertSerialTypes(result, changes);
    result = convertNextvalDefaults(result, changes);
    result = removeForeignKeys(result, changes);
    result = removeInlineForeignKeys(result, changes);
    result = convertSequences(result, changes);
    result = removeSetStatements(result, changes);
    result = removeInheritance(result, changes);
    result = removePartitioning(result, changes);
    result = removeTablespaces(result, changes);
    result = removeCreateTablespace(result, changes);
    result = removeRules(result, changes);
    result = removeEventTriggers(result, changes);
    result = removeListenNotify(result, changes);
    result = removeTemporaryTables(result, changes);
    result = convertTruncate(result, changes);
    result = removeMaterializedViews(result, changes);
    result = removeDeferrableConstraints(result, changes);
    result = removeGeneratedStoredColumns(result, changes);
    result = removeExclusionConstraints(result, changes);
    result = removeCreateType(result, changes);
    result = removeCreateAggregate(result, changes);
    result = removeCreateOperator(result, changes);
    result = removeAlterIndex(result, changes);
    result = removeVacuum(result, changes);
    result = removeCursors(result, changes);
    result = convertIdentityColumns(result, changes);
    result = convertIndexToAsync(result, changes);
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
    const regex = /CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?[\w".-]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        matches.forEach(m => {
            const extName = m.match(/EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([\w.-]+)["']?/i);
            changes.push({
                type: 'removed',
                message: `Removed CREATE EXTENSION${extName ? ' ' + extName[1] : ''} — extensions are not supported in DSQL`
            });
        });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeDropExtension(sql, changes) {
    const regex = /DROP\s+EXTENSION\s+(IF\s+EXISTS\s+)?[\w".-]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} DROP EXTENSION statement(s)` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeProcedures(sql, changes) {
    const procRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+([\w."]+)\s*\([^)]*\)[^]*?(?:\$\$[^]*?\$\$|\$[\w]*\$[^]*?\$[\w]*\$)[^;]*;/gi;
    const matches = sql.match(procRegex);
    if (matches) {
        matches.forEach(m => {
            const name = m.match(/PROCEDURE\s+([\w."]+)/i);
            changes.push({
                type: 'removed',
                message: `Removed procedure "${name ? name[1] : 'unknown'}" — DSQL only supports CREATE FUNCTION (LANGUAGE SQL)`
            });
            sql = sql.replace(m, '');
        });
    }
    return sql;
}

function removePlpgsqlFunctions(sql, changes) {
    const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\([^)]*\)[^]*?(?:\$\$[^]*?\$\$|\$[\w]*\$[^]*?\$[\w]*\$)[^;]*;/gi;
    const matches = sql.match(funcRegex);
    if (matches) {
        matches.forEach(m => {
            if (/LANGUAGE\s+sql/i.test(m)) {
                // Keep SQL functions — they are supported
            } else {
                const name = m.match(/FUNCTION\s+([\w."]+)/i);
                const lang = m.match(/LANGUAGE\s+(\w+)/i);
                changes.push({
                    type: 'removed',
                    message: `Removed function "${name ? name[1] : 'unknown'}" (LANGUAGE ${lang ? lang[1] : 'unknown'}) — only LANGUAGE SQL functions are supported in DSQL`
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
    const typeMap = { 'SERIAL': 'BIGINT', 'BIGSERIAL': 'BIGINT', 'SMALLSERIAL': 'BIGINT' };
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
    sql = sql.replace(/(\w+)\s+SMALLSERIAL\s+PRIMARY\s+KEY/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY');
    sql = sql.replace(/(\w+)\s+SERIAL\s+PRIMARY\s+KEY/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1) PRIMARY KEY');
    sql = sql.replace(/(\w+)\s+BIGSERIAL/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');
    sql = sql.replace(/(\w+)\s+SMALLSERIAL/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');
    sql = sql.replace(/(\w+)\s+SERIAL/gi, '$1 BIGINT GENERATED BY DEFAULT AS IDENTITY (CACHE 1)');

    return sql;
}

function convertNextvalDefaults(sql, changes) {
    const nextvalDefaultRegex = /(\w+)\s+((?:BIGINT|INTEGER|INT|SMALLINT|NUMERIC(?:\(\d+\))?)\s+)DEFAULT\s+nextval\(\s*'([^']+)'\s*\)/gi;
    let match;
    const convertedSeqs = new Set();
    const replacements = [];

    while ((match = nextvalDefaultRegex.exec(sql)) !== null) {
        const fullMatch = match[0];
        const colName = match[1];
        const typePart = match[2].trim();
        const seqName = match[3];

        const intType = 'BIGINT';

        replacements.push({
            old: fullMatch,
            new: `${colName} ${intType} GENERATED BY DEFAULT AS IDENTITY (CACHE 1)`
        });
        convertedSeqs.add(seqName);
    }

    if (replacements.length > 0) {
        changes.push({
            type: 'modified',
            message: `Converted ${replacements.length} DEFAULT nextval() column(s) to GENERATED BY DEFAULT AS IDENTITY — DSQL does not support DEFAULT nextval() in column definitions`
        });
        replacements.forEach(r => { sql = sql.replace(r.old, r.new); });

        convertedSeqs.forEach(seqName => {
            const seqRegex = new RegExp(
                `CREATE\\s+SEQUENCE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:["']?${seqName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?)[^;]*;`,
                'gi'
            );
            if (seqRegex.test(sql)) {
                sql = sql.replace(seqRegex, '');
                changes.push({
                    type: 'removed',
                    message: `Removed CREATE SEQUENCE "${seqName}" — replaced by identity column`
                });
            }
        });
    }

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

function removeCreateTablespace(sql, changes) {
    const regex = /CREATE\s+TABLESPACE\s+[\w"]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} CREATE TABLESPACE statement(s)` });
        sql = sql.replace(regex, '');
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

function removeTemporaryTables(sql, changes) {
    const regex = /CREATE\s+(?:GLOBAL\s+|LOCAL\s+)?(?:TEMPORARY|TEMP)\s+TABLE\s+([\w."]+)[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        matches.forEach(m => {
            const name = m.match(/TABLE\s+([\w."]+)/i);
            changes.push({ type: 'removed', message: `Removed temporary table "${name ? name[1] : ''}" — temporary tables not supported in DSQL` });
        });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function convertTruncate(sql, changes) {
    const regex = /TRUNCATE\s+(?:TABLE\s+)?([\w."]+)\s*(?:CASCADE|RESTRICT|CONTINUE\s+IDENTITY|RESTART\s+IDENTITY)?\s*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'modified', message: `Converted ${matches.length} TRUNCATE to DELETE FROM — TRUNCATE not supported in DSQL` });
        sql = sql.replace(regex, (match, tableName) => `DELETE FROM ${tableName};`);
    }
    return sql;
}

function removeMaterializedViews(sql, changes) {
    const createRegex = /CREATE\s+MATERIALIZED\s+VIEW\s+([\w."]+)[^;]*;/gi;
    const matches = sql.match(createRegex);
    if (matches) {
        matches.forEach(m => {
            const name = m.match(/VIEW\s+([\w."]+)/i);
            changes.push({ type: 'removed', message: `Removed materialized view "${name ? name[1] : ''}" — not supported in DSQL` });
        });
        sql = sql.replace(createRegex, '');
    }

    const refreshRegex = /REFRESH\s+MATERIALIZED\s+VIEW\s+(?:CONCURRENTLY\s+)?[\w."]+[^;]*;/gi;
    const refreshMatches = sql.match(refreshRegex);
    if (refreshMatches) {
        changes.push({ type: 'removed', message: `Removed ${refreshMatches.length} REFRESH MATERIALIZED VIEW statement(s)` });
        sql = sql.replace(refreshRegex, '');
    }

    const dropRegex = /DROP\s+MATERIALIZED\s+VIEW\s+(?:IF\s+EXISTS\s+)?[\w."]+[^;]*;/gi;
    sql = sql.replace(dropRegex, '');

    return sql;
}

function removeDeferrableConstraints(sql, changes) {
    const regex = /\s+DEFERRABLE(?:\s+INITIALLY\s+(?:DEFERRED|IMMEDIATE))?/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: 'Removed DEFERRABLE constraint clauses — not supported in DSQL' });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeGeneratedStoredColumns(sql, changes) {
    const regex = /\s+GENERATED\s+ALWAYS\s+AS\s*\([^)]+\)\s+STORED/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} generated stored column expression(s) — not supported in DSQL (use views or application logic)` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeExclusionConstraints(sql, changes) {
    const regex = /,?[ \t]*\n?[ \t]*(?:CONSTRAINT\s+[\w"]+\s+)?EXCLUDE\s+(?:USING\s+\w+\s*)?\([^)]+\)(?:\s+WHERE\s*\([^)]+\))?/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} exclusion constraint(s) — not supported in DSQL` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeCreateType(sql, changes) {
    const regex = /CREATE\s+TYPE\s+([\w."]+)\s+AS\s*\([^)]*\)\s*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        matches.forEach(m => {
            const name = m.match(/TYPE\s+([\w."]+)/i);
            changes.push({ type: 'removed', message: `Removed CREATE TYPE "${name ? name[1] : ''}" — use CREATE DOMAIN or restructure into columns` });
        });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeCreateAggregate(sql, changes) {
    const regex = /CREATE\s+(?:OR\s+REPLACE\s+)?AGGREGATE\s+[\w."]+\s*\([^)]*\)\s*\([^)]*\)\s*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} CREATE AGGREGATE statement(s) — not supported in DSQL` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeCreateOperator(sql, changes) {
    const regex = /CREATE\s+OPERATOR\s+[^\s(]+\s*\([^)]*\)\s*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} CREATE OPERATOR statement(s) — not supported in DSQL` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeAlterIndex(sql, changes) {
    const regex = /ALTER\s+INDEX\s+[\w."]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} ALTER INDEX statement(s) — use DROP and CREATE INDEX ASYNC instead` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeVacuum(sql, changes) {
    const regex = /\b(?:VACUUM|ANALYZE)\s*(?:FULL\s+|VERBOSE\s+|FREEZE\s+)*(?:[\w."]+)?\s*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} VACUUM/ANALYZE statement(s) — managed automatically by DSQL` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeCursors(sql, changes) {
    const regex = /DECLARE\s+[\w"]+\s+CURSOR\s+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} DECLARE CURSOR statement(s) — not supported in DSQL` });
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
        } else {
            const cacheMatch = options.match(/CACHE\s+(\d+)/i);
            if (cacheMatch) {
                const cacheVal = parseInt(cacheMatch[1], 10);
                if (cacheVal !== 1 && cacheVal < 65536) {
                    const newExpr = fullMatch.replace(/CACHE\s+\d+/i, 'CACHE 65536');
                    replacements.push({ old: fullMatch, new: newExpr });
                    changes.push({
                        type: 'modified',
                        message: `Changed identity CACHE ${cacheVal} to CACHE 65536 — DSQL only supports CACHE 1 or >= 65536`
                    });
                }
            }
        }
    }

    if (replacements.length > 0) {
        const added = replacements.filter(r => !r.old.match(/CACHE\s+\d+/i));
        if (added.length > 0) {
            changes.push({ type: 'modified', message: `Added CACHE to ${added.length} identity column(s)` });
        }
        replacements.forEach(r => { sql = sql.replace(r.old, r.new); });
    }

    return sql;
}

function convertIndexToAsync(sql, changes) {
    const indexRegex = /^([^-\n]*?)CREATE\s+(UNIQUE\s+)?INDEX\s+(?!ASYNC\b)/gim;
    const matches = sql.match(indexRegex);
    if (matches) {
        const realMatches = matches.filter(m => !m.trimStart().startsWith('--'));
        if (realMatches.length > 0) {
            changes.push({
                type: 'modified',
                message: `Converted ${realMatches.length} CREATE INDEX to CREATE INDEX ASYNC — DSQL requires async index creation`
            });
        }
    }
    sql = sql.replace(/^(\s*)CREATE\s+(UNIQUE\s+)?INDEX\s+(?!ASYNC\b)/gim, (match, indent, unique) => {
        if (match.trimStart().startsWith('--')) return match;
        return unique ? `${indent}CREATE UNIQUE INDEX ASYNC ` : `${indent}CREATE INDEX ASYNC `;
    });
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
