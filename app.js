document.addEventListener('DOMContentLoaded', () => {
    const inputSchema = document.getElementById('input-schema');
    const outputSchema = document.getElementById('output-schema');
    const convertBtn = document.getElementById('convert-btn');
    const btnText = convertBtn.querySelector('.btn-text');
    const btnLoading = convertBtn.querySelector('.btn-loading');
    const loadSampleBtn = document.getElementById('load-sample');
    const clearInputBtn = document.getElementById('clear-input');
    const copyOutputBtn = document.getElementById('copy-output');
    const downloadOutputBtn = document.getElementById('download-output');
    const changesSection = document.getElementById('changes-section');
    const changesList = document.getElementById('changes-list');
    const modeAi = document.getElementById('mode-ai');
    const modeRules = document.getElementById('mode-rules');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const filePickerBtn = document.getElementById('file-picker-btn');
    const fileListEl = document.getElementById('file-list');

    const converter = new DSQLConverter();
    const uploadedFiles = new Map(); // filename -> content

    // --- File Upload ---

    filePickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        handleFiles(fileInput.files);
        fileInput.value = '';
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });

    function handleFiles(files) {
        const allowed = ['.sql', '.ddl', '.txt', '.pgsql'];
        Array.from(files).forEach(file => {
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (!allowed.includes(ext)) return;
            const reader = new FileReader();
            reader.onload = () => {
                uploadedFiles.set(file.name, reader.result);
                renderFileList();
                populateTextareaFromFiles();
            };
            reader.readAsText(file);
        });
    }

    function renderFileList() {
        if (uploadedFiles.size === 0) {
            fileListEl.hidden = true;
            return;
        }
        fileListEl.hidden = false;
        fileListEl.innerHTML = '';
        uploadedFiles.forEach((_, name) => {
            const chip = document.createElement('span');
            chip.className = 'file-chip';
            chip.innerHTML = `${escapeHtml(name)}<button class="file-chip-remove" data-file="${escapeHtml(name)}">&times;</button>`;
            fileListEl.appendChild(chip);
        });
        fileListEl.querySelectorAll('.file-chip-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                uploadedFiles.delete(btn.dataset.file);
                renderFileList();
                populateTextareaFromFiles();
            });
        });
    }

    function populateTextareaFromFiles() {
        if (uploadedFiles.size === 0) {
            inputSchema.value = '';
            return;
        }
        const parts = [];
        uploadedFiles.forEach((content, name) => {
            parts.push(`-- ========== File: ${name} ==========\n${content}`);
        });
        inputSchema.value = parts.join('\n\n');
    }

    // API endpoint — update this after deploying the CDK stack
    const API_ENDPOINT = window.DSQL_API_ENDPOINT || '';

    const sampleSchema = `-- Sample PostgreSQL schema for an e-commerce application

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE SEQUENCE order_id_seq START 1000;

CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    stock_count INTEGER DEFAULT 0,
    category_id INT REFERENCES categories(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE orders (
    id INTEGER DEFAULT nextval('order_id_seq') PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'pending',
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    shipped_at TIMESTAMP,
    CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- Trigger function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- Stored procedure for order placement
CREATE OR REPLACE FUNCTION place_order(
    p_customer_id INT,
    p_items JSONB
) RETURNS INT AS $$
DECLARE
    v_order_id INT;
BEGIN
    INSERT INTO orders (customer_id, total)
    VALUES (p_customer_id, 0)
    RETURNING id INTO v_order_id;

    RETURN v_order_id;
END;
$$ LANGUAGE plpgsql;`;

    convertBtn.addEventListener('click', async () => {
        const input = inputSchema.value.trim();
        if (!input) {
            outputSchema.innerHTML = '<span class="placeholder-text">Please enter a PostgreSQL schema to convert.</span>';
            return;
        }

        const useAi = modeAi.checked;

        if (useAi) {
            await convertWithAgent(input);
        } else {
            convertWithRules(input);
        }
    });

    async function convertWithAgent(input) {
        if (!API_ENDPOINT) {
            outputSchema.innerHTML = '<span class="placeholder-text">API endpoint not configured. Deploy the backend first or switch to Rule-Based mode.\n\nSet window.DSQL_API_ENDPOINT in config.js after deploying the CDK stack.</span>';
            return;
        }

        setLoading(true);

        try {
            const response = await fetch(`${API_ENDPOINT}/convert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schema: input }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${response.status}`);
            }

            const data = await response.json();

            outputSchema.textContent = data.converted_schema;
            highlightSQL(outputSchema);
            copyOutputBtn.disabled = false;
            downloadOutputBtn.disabled = false;

            if (data.changes && data.changes.length > 0) {
                renderChanges(data.changes);
            } else {
                changesSection.hidden = true;
            }
        } catch (err) {
            outputSchema.innerHTML = `<span class="placeholder-text">Error calling Strands Agent: ${escapeHtml(err.message)}\n\nTry switching to Rule-Based mode, or check that the backend is deployed.</span>`;
        } finally {
            setLoading(false);
        }
    }

    function convertWithRules(input) {
        const result = converter.convert(input);
        outputSchema.textContent = result.sql;
        highlightSQL(outputSchema);

        copyOutputBtn.disabled = false;
        downloadOutputBtn.disabled = false;

        if (result.changes.length > 0) {
            renderChanges(result.changes);
        } else {
            changesSection.hidden = true;
        }
    }

    function renderChanges(changes) {
        changesSection.hidden = false;
        changesList.innerHTML = '';
        changes.forEach(change => {
            const item = document.createElement('div');
            item.className = `change-item ${change.type}`;

            const badge = document.createElement('span');
            badge.className = 'change-badge';
            badge.textContent = change.type === 'removed' ? 'Removed' : change.type === 'modified' ? 'Modified' : 'Info';

            const text = document.createElement('span');
            text.textContent = change.message;

            item.appendChild(badge);
            item.appendChild(text);
            changesList.appendChild(item);
        });
    }

    function setLoading(loading) {
        convertBtn.disabled = loading;
        btnText.hidden = loading;
        btnLoading.hidden = !loading;
    }

    loadSampleBtn.addEventListener('click', () => {
        inputSchema.value = sampleSchema;
    });

    clearInputBtn.addEventListener('click', () => {
        inputSchema.value = '';
        uploadedFiles.clear();
        renderFileList();
        outputSchema.innerHTML = '<span class="placeholder-text">Converted schema will appear here...</span>';
        copyOutputBtn.disabled = true;
        downloadOutputBtn.disabled = true;
        changesSection.hidden = true;
    });

    copyOutputBtn.addEventListener('click', () => {
        const text = outputSchema.textContent;
        navigator.clipboard.writeText(text).then(() => {
            const original = copyOutputBtn.textContent;
            copyOutputBtn.textContent = 'Copied!';
            setTimeout(() => { copyOutputBtn.textContent = original; }, 2000);
        });
    });

    downloadOutputBtn.addEventListener('click', () => {
        const text = outputSchema.textContent;
        const blob = new Blob([text], { type: 'text/sql' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dsql_schema.sql';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function highlightSQL(element) {
        let html = element.textContent;
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html = html.replace(/(--[^\n]*)/g, '<span class="comment">$1</span>');
        const keywords = ['CREATE', 'TABLE', 'INDEX', 'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'SELECT',
            'FROM', 'WHERE', 'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'KEY', 'UNIQUE', 'CHECK',
            'CONSTRAINT', 'IF', 'EXISTS', 'ON', 'INTO', 'VALUES', 'SET', 'AS', 'OR', 'AND',
            'REPLACE', 'CASCADE', 'RESTRICT', 'BEGIN', 'END', 'RETURNS', 'RETURN', 'DECLARE',
            'FOR', 'EACH', 'ROW', 'EXECUTE', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'BEFORE',
            'AFTER', 'LANGUAGE', 'REFERENCES', 'FOREIGN'];
        const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
        html = html.replace(kwRegex, '<span class="keyword">$1</span>');
        const types = ['UUID', 'VARCHAR', 'TEXT', 'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'DECIMAL',
            'NUMERIC', 'BOOLEAN', 'TIMESTAMP', 'DATE', 'TIME', 'JSONB', 'JSON', 'BYTEA'];
        const typeRegex = new RegExp(`\\b(${types.join('|')})\\b`, 'g');
        html = html.replace(typeRegex, '<span class="type">$1</span>');
        html = html.replace(/\b(gen_random_uuid|NOW|COALESCE|LOWER|UPPER)\b/gi, '<span class="function">$1</span>');
        html = html.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="string">$1</span>');
        element.innerHTML = html;
    }
});
