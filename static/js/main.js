document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initRadioSelectors();
    initAlterFields();
    initForms();
});

// управление вкладками DDL, DML, Консоль
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = `tab-${btn.dataset.tab}`;
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

// переключение подкоманд
function initRadioSelectors() {
    const ddlRadios = document.querySelectorAll('input[name="ddl-subcommand"]');
    const ddlForms = {
        create: document.getElementById('form-create-table'),
        alter: document.getElementById('form-alter-table'),
        truncate: document.getElementById('form-truncate-table'),
        drop: document.getElementById('form-drop-table')
    };

    ddlRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            Object.values(ddlForms).forEach(f => f && f.classList.remove('active'));
            if (ddlForms[e.target.value]) {
                ddlForms[e.target.value].classList.add('active');
            }
        });
    });

    const dmlRadios = document.querySelectorAll('input[name="dml-subcommand"]');
    const dmlForms = {
        select: document.getElementById('form-dml-select'),
        insert: document.getElementById('form-dml-insert'),
        update: document.getElementById('form-dml-update'),
        delete: document.getElementById('form-dml-delete')
    };

    dmlRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            Object.values(dmlForms).forEach(f => f && f.classList.remove('active'));
            if (dmlForms[e.target.value]) {
                dmlForms[e.target.value].classList.add('active');
            }
        });
    });
}

function initAlterFields() {
    const select = document.getElementById('alter-action-select');
    const fieldColName = document.getElementById('alter-field-column-name');
    const fieldColType = document.getElementById('alter-field-column-type');
    const fieldNewCol = document.getElementById('alter-field-new-col');
    const fieldNewTable = document.getElementById('alter-field-new-table');
    const colLabel = document.getElementById('alter-col-label');

    function updateFields() {
        const action = select.value;

        // Сброс видимости
        fieldColName.style.display = 'none';
        fieldColType.style.display = 'none';
        fieldNewCol.style.display = 'none';
        fieldNewTable.style.display = 'none';

        if (action === 'ADD') {
            colLabel.textContent = 'Имя нового столбца';
            fieldColName.style.display = 'flex';
            fieldColType.style.display = 'flex';
        } else if (action === 'MODIFY') {
            colLabel.textContent = 'Имя изменяемого столбца';
            fieldColName.style.display = 'flex';
            fieldColType.style.display = 'flex';
        } else if (action === 'DROP_COLUMN') {
            colLabel.textContent = 'Имя удаляемого столбца';
            fieldColName.style.display = 'flex';
        } else if (action === 'RENAME_COLUMN') {
            colLabel.textContent = 'Текущее имя столбца';
            fieldColName.style.display = 'flex';
            fieldNewCol.style.display = 'flex';
        } else if (action === 'RENAME_TABLE') {
            fieldNewTable.style.display = 'flex';
        }
    }

    select.addEventListener('change', updateFields);
    updateFields();
}

function initForms() {
    // CREATE TABLE
    document.getElementById('form-create-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            command: 'CREATE_TABLE',
            table_name: document.getElementById('create-table-name').value,
            columns: document.getElementById('create-columns').value,
            types: document.getElementById('create-types').value,
        };
        await sendRequest('/ddl', payload);
    });

    // ALTER TABLE
    document.getElementById('form-alter-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            command: 'ALTER_TABLE',
            table_name: document.getElementById('alter-table-name').value,
            alter_action: document.getElementById('alter-action-select').value,
            column_name: document.getElementById('alter-col-input').value,
            column_type: document.getElementById('alter-type-input').value,
            new_column_name: document.getElementById('alter-new-col-input').value,
            new_table_name: document.getElementById('alter-new-table-input').value,
        };
        await sendRequest('/ddl', payload);
    });

    // TRUNCATE TABLE
    document.getElementById('form-truncate-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tableName = document.getElementById('truncate-table-name').value;
        if (!confirm(`Вы действительно хотите очистить таблицу '${tableName}'?`)) return;

        const payload = {
            command: 'TRUNCATE_TABLE',
            table_name: tableName,
        };
        await sendRequest('/ddl', payload);
    });

    // DROP TABLE
    document.getElementById('form-drop-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tableName = document.getElementById('drop-table-name').value;
        if (!confirm(`Вы действительно хотите удалить таблицу '${tableName}'? Это действие необратимо!`)) return;

        const payload = {
            command: 'DROP_TABLE',
            table_name: tableName,
        };
        await sendRequest('/ddl', payload);
    });

    // SELECT
    document.getElementById('form-dml-select').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            command: 'SELECT',
            table_name: document.getElementById('select-table-name').value,
            columns: document.getElementById('select-columns').value,
            where: document.getElementById('select-where').value,
            limit: parseInt(document.getElementById('select-limit').value, 10) || 50,
        };
        await sendRequest('/dml', payload);
    });

    // INSERT
    document.getElementById('form-dml-insert').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            command: 'INSERT',
            table_name: document.getElementById('insert-table-name').value,
            columns: document.getElementById('insert-columns').value,
            values: document.getElementById('insert-values').value,
        };
        await sendRequest('/dml', payload);
    });

    // UPDATE
    document.getElementById('form-dml-update').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            command: 'UPDATE',
            table_name: document.getElementById('update-table-name').value,
            set_clause: document.getElementById('update-set').value,
            where: document.getElementById('update-where').value,
        };
        await sendRequest('/dml', payload);
    });

    // DELETE
    document.getElementById('form-dml-delete').addEventListener('submit', async (e) => {
        e.preventDefault();
        const whereClause = document.getElementById('delete-where').value;
        if (!whereClause.trim()) {
            if (!confirm('Вы не указали условие WHERE. Будут удалены ВСЕ строки таблицы! Продолжить?')) return;
        }

        const payload = {
            command: 'DELETE',
            table_name: document.getElementById('delete-table-name').value,
            where: whereClause,
        };
        await sendRequest('/dml', payload);
    });

    // RAW SQL
    document.getElementById('form-raw-sql').addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = document.getElementById('raw-sql-input').value;
        const payload = { query };
        await sendRequest('/raw-sql', payload);
    });
}

// Отправка JSON запроса
async function sendRequest(url, payload) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({
            success: false,
            status: 500,
            duration_ms: 0,
            message: `Сетевая ошибка: ${err.message}`,
        });
    }
}

// Отображение результатов выполнения
function displayResult(data) {
    const queryPreview = document.getElementById('query-preview');
    const queryCode = document.getElementById('query-code');
    const resultMessage = document.getElementById('result-message');
    const tableContainer = document.getElementById('table-container');
    const thead = document.getElementById('result-thead');
    const tbody = document.getElementById('result-tbody');

    if (data.query) {
        queryPreview.style.display = 'flex';
        queryCode.textContent = data.query;
    } else {
        queryPreview.style.display = 'none';
    }

    resultMessage.className = 'result-message';
    resultMessage.classList.add(data.success ? 'success' : 'error');
    resultMessage.textContent = data.message || (data.success ? 'Успешно' : 'Ошибка');

    if (data.rows && Array.isArray(data.rows) && data.rows.length > 0 && data.columns && data.columns.length > 0) {
        tableContainer.style.display = 'block';

        thead.innerHTML = `<tr>${data.columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`;

        tbody.innerHTML = data.rows.map(row => {
            const cells = data.columns.map(col => {
                const val = row[col];
                const displayVal = val === null ? '<span style="color: var(--text-dim); font-style: italic;">NULL</span>' : escapeHtml(String(val));
                return `<td>${displayVal}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
    } else {
        tableContainer.style.display = 'none';
        thead.innerHTML = '';
        tbody.innerHTML = '';
    }
}

function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}