/**
 * Oracle to PostgreSQL-compatible normalization.
 * Transforms Oracle DDL into PG-style DDL so the DSQL converter can process it.
 */

export function normalizeOracle(sql, changes) {
    let result = sql;

    result = removeSlashTerminators(result);
    result = convertOracleTypes(result, changes);
    result = convertOracleSequences(result, changes);
    result = convertNextval(result, changes);
    result = convertDefaultOnNull(result, changes);
    result = removeVirtualColumns(result, changes);
    result = removeEnableDisable(result, changes);
    result = removeOrganizationIndex(result, changes);
    result = removeSynonyms(result, changes);
    result = removePlsqlBlocks(result, changes);
    result = removeStorageClauses(result, changes);
    result = removeOracleTableOptions(result, changes);
    result = removeDatabaseLinks(result, changes);
    result = convertNvl(result, changes);
    result = convertSysdate(result, changes);
    result = removeOracleHints(result, changes);

    return result;
}

function removeSlashTerminators(sql) {
    return sql.replace(/^\s*\/\s*$/gm, '');
}

function convertOracleTypes(sql, changes) {
    const mappings = [
        [/\bVARCHAR2\s*\((\d+)(?:\s+(?:BYTE|CHAR))?\)/gi, 'VARCHAR($1)'],
        [/\bNVARCHAR2\s*\((\d+)\)/gi, 'VARCHAR($1)'],
        [/\bNUMBER\s*\((\d+),\s*(\d+)\)/gi, 'NUMERIC($1,$2)'],
        [/\bNUMBER\s*\((\d+)\)/gi, 'NUMERIC($1)'],
        [/\bNUMBER\b/gi, 'NUMERIC'],
        [/\bCLOB\b/gi, 'TEXT'],
        [/\bNCLOB\b/gi, 'TEXT'],
        [/\bBLOB\b/gi, 'BYTEA'],
        [/\bRAW\s*\(\d+\)/gi, 'BYTEA'],
        [/\bLONG\s+RAW\b/gi, 'BYTEA'],
        [/\bTIMESTAMP\s*\((\d+)\)\s+WITH\s+LOCAL\s+TIME\s+ZONE/gi, 'TIMESTAMPTZ'],
        [/\bBINARY_FLOAT\b/gi, 'REAL'],
        [/\bBINARY_DOUBLE\b/gi, 'DOUBLE PRECISION'],
        [/\bPLS_INTEGER\b/gi, 'INTEGER'],
        [/\bINTERVAL\s+YEAR(?:\s*\(\d+\))?\s+TO\s+MONTH/gi, 'INTERVAL'],
        [/\bINTERVAL\s+DAY(?:\s*\(\d+\))?\s+TO\s+SECOND(?:\s*\(\d+\))?/gi, 'INTERVAL'],
    ];

    let converted = false;
    mappings.forEach(([regex, replacement]) => {
        if (sql.match(regex)) {
            converted = true;
            sql = sql.replace(regex, replacement);
        }
    });

    const dateRegex = /\bDATE\b/gi;
    if (sql.match(dateRegex)) {
        converted = true;
        sql = sql.replace(/(?<!\w)DATE(?!\w)/gi, 'TIMESTAMP');
    }

    if (converted) {
        changes.push({ type: 'modified', message: 'Converted Oracle data types to PostgreSQL equivalents' });
    }
    return sql;
}

function convertOracleSequences(sql, changes) {
    const seqRegex = /CREATE\s+SEQUENCE\s+([\w."]+)([^;]*);/gi;
    let match;
    const replacements = [];

    while ((match = seqRegex.exec(sql)) !== null) {
        const fullMatch = match[0];
        let options = match[2] || '';

        options = options.replace(/\s+NOCACHE\b/gi, '');
        options = options.replace(/\s+NOCYCLE\b/gi, '');
        options = options.replace(/\s+NOORDER\b/gi, '');
        options = options.replace(/\s+ORDER\b/gi, '');
        options = options.replace(/\s+NOMINVALUE\b/gi, '');
        options = options.replace(/\s+NOMAXVALUE\b/gi, '');

        if (options !== match[2]) {
            const newStmt = `CREATE SEQUENCE ${match[1]}${options};`;
            replacements.push({ old: fullMatch, new: newStmt });
        }
    }

    if (replacements.length > 0) {
        changes.push({ type: 'modified', message: 'Cleaned Oracle-specific sequence options (NOCACHE, NOCYCLE, ORDER)' });
        replacements.forEach(r => { sql = sql.replace(r.old, r.new); });
    }

    return sql;
}

function convertNextval(sql, changes) {
    const nextvalRegex = /\b([\w."]+)\.NEXTVAL\b/gi;
    if (sql.match(nextvalRegex)) {
        changes.push({ type: 'modified', message: 'Converted sequence_name.NEXTVAL to nextval(\'sequence_name\')' });
        sql = sql.replace(nextvalRegex, (match, seqName) => `nextval('${seqName.replace(/"/g, '')}')`);
    }

    const currvalRegex = /\b([\w."]+)\.CURRVAL\b/gi;
    if (sql.match(currvalRegex)) {
        changes.push({ type: 'modified', message: 'Converted sequence_name.CURRVAL to currval(\'sequence_name\')' });
        sql = sql.replace(currvalRegex, (match, seqName) => `currval('${seqName.replace(/"/g, '')}')`);
    }

    return sql;
}

function convertDefaultOnNull(sql, changes) {
    const regex = /\bDEFAULT\s+ON\s+NULL\s+/gi;
    if (sql.match(regex)) {
        changes.push({ type: 'modified', message: 'Converted DEFAULT ON NULL to DEFAULT — NULL insert behavior differs' });
        sql = sql.replace(regex, 'DEFAULT ');
    }
    return sql;
}

function removeVirtualColumns(sql, changes) {
    const regex = /\s+GENERATED\s+ALWAYS\s+AS\s*\([^)]+\)\s*VIRTUAL/gi;
    if (sql.match(regex)) {
        changes.push({ type: 'removed', message: 'Removed Oracle virtual column expressions — use views or application logic' });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeEnableDisable(sql, changes) {
    const regex = /\s+(?:ENABLE|DISABLE)(?:\s+VALIDATE|\s+NOVALIDATE)?/gi;
    if (sql.match(regex)) {
        changes.push({ type: 'removed', message: 'Removed Oracle ENABLE/DISABLE constraint clauses' });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeOrganizationIndex(sql, changes) {
    const regex = /\s*ORGANIZATION\s+INDEX/gi;
    if (sql.match(regex)) {
        changes.push({ type: 'removed', message: 'Removed ORGANIZATION INDEX (index-organized table) — DSQL handles storage automatically' });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removeSynonyms(sql, changes) {
    const regex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:PUBLIC\s+)?SYNONYM\s+[\w."]+\s+FOR\s+[\w."]+\s*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} SYNONYM(s) — not supported in DSQL` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function removePlsqlBlocks(sql, changes) {
    const editionablePrefix = /(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?/;

    const packageRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?PACKAGE(?:\s+BODY)?\s+([\w."]+)[^]*?(?:END\s+\1\s*;|END\s*;)/gi;
    const packageMatches = sql.match(packageRegex);
    if (packageMatches) {
        packageMatches.forEach(m => {
            const name = m.match(/PACKAGE(?:\s+BODY)?\s+([\w."]+)/i);
            changes.push({ type: 'removed', message: `Removed PL/SQL package "${name ? name[1] : 'unknown'}"` });
        });
        sql = sql.replace(packageRegex, '');
    }

    const typeBodyRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?TYPE(?:\s+BODY)?\s+([\w."]+)[^]*?(?:END\s*;)/gi;
    const typeMatches = sql.match(typeBodyRegex);
    if (typeMatches) {
        typeMatches.forEach(() => {
            changes.push({ type: 'removed', message: 'Removed Oracle TYPE/TYPE BODY — not supported in DSQL' });
        });
        sql = sql.replace(typeBodyRegex, '');
    }

    const triggerRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?TRIGGER\s+([\w."]+)[^]*?(?:END\s+\1\s*;|END\s*;)/gi;
    const triggerMatches = sql.match(triggerRegex);
    if (triggerMatches) {
        triggerMatches.forEach(m => {
            const name = m.match(/TRIGGER\s+([\w."]+)/i);
            changes.push({ type: 'removed', message: `Removed Oracle trigger "${name ? name[1] : 'unknown'}"` });
        });
        sql = sql.replace(triggerRegex, '');
    }

    const procRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE)\s+)?(?:PROCEDURE|FUNCTION)\s+([\w."]+)\s*(?:\([^)]*\))?[^]*?(?:END\s+\1\s*;|END\s*;)/gi;
    const procMatches = sql.match(procRegex);
    if (procMatches) {
        procMatches.forEach(m => {
            const name = m.match(/(?:PROCEDURE|FUNCTION)\s+([\w."]+)/i);
            changes.push({ type: 'removed', message: `Removed PL/SQL ${m.match(/PROCEDURE/i) ? 'procedure' : 'function'} "${name ? name[1] : 'unknown'}"` });
        });
        sql = sql.replace(procRegex, '');
    }

    return sql;
}

function removeStorageClauses(sql, changes) {
    const patterns = [
        /\s*STORAGE\s*\([^)]*\)/gi,
        /\s*(?:NO)?LOGGING\b/gi,
        /\s*(?:PCTFREE|PCTUSED|INITRANS|MAXTRANS)\s+\d+/gi,
        /\s*SEGMENT\s+CREATION\s+(?:IMMEDIATE|DEFERRED)/gi,
    ];

    let removed = false;
    patterns.forEach(regex => {
        if (sql.match(regex)) {
            removed = true;
            sql = sql.replace(regex, '');
        }
    });

    if (removed) {
        changes.push({ type: 'removed', message: 'Removed Oracle STORAGE/LOGGING/PCT* clauses' });
    }
    return sql;
}

function removeOracleTableOptions(sql, changes) {
    sql = sql.replace(/\s*(?:ENABLE|DISABLE)\s+ROW\s+MOVEMENT/gi, '');
    sql = sql.replace(/\s*(?:NOCOMPRESS|COMPRESS(?:\s+\w+)?)/gi, '');
    return sql;
}

function removeDatabaseLinks(sql, changes) {
    const regex = /CREATE\s+(?:PUBLIC\s+)?DATABASE\s+LINK\s+[\w."]+[^;]*;/gi;
    const matches = sql.match(regex);
    if (matches) {
        changes.push({ type: 'removed', message: `Removed ${matches.length} DATABASE LINK(s)` });
        sql = sql.replace(regex, '');
    }
    return sql;
}

function convertNvl(sql, changes) {
    if (sql.match(/\bNVL\s*\(/gi)) {
        changes.push({ type: 'modified', message: 'Converted NVL() to COALESCE()' });
        sql = sql.replace(/\bNVL\s*\(/gi, 'COALESCE(');
    }
    return sql;
}

function convertSysdate(sql, changes) {
    if (sql.match(/\bSYSDATE\b/gi)) {
        changes.push({ type: 'modified', message: 'Converted SYSDATE to NOW()' });
        sql = sql.replace(/\bSYSDATE\b/gi, 'NOW()');
    }
    return sql;
}

function removeOracleHints(sql, changes) {
    if (sql.match(/\/\*\+[^*]*\*\//g)) {
        changes.push({ type: 'removed', message: 'Removed Oracle optimizer hints' });
        sql = sql.replace(/\/\*\+[^*]*\*\//g, '');
    }
    return sql;
}
