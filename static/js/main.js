document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initRadioSelectors();
    initAlterFields();
    initForms();
    loadTables();

    document.getElementById('btn-refresh-tables').addEventListener('click', loadTables);
});

// Управление основными вкладками
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = `tab-${btn.dataset.tab}`;
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const target = document.getElementById(targetId);
            if (target) target.classList.add('active');
        });
    });
}

// Переключение подкоманд внутри каждого раздела
function initRadioSelectors() {
    function bindRadios(radioName, formsMap) {
        const radios = document.querySelectorAll(`input[name="${radioName}"]`);
        radios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                Object.values(formsMap).forEach(f => f && f.classList.remove('active'));
                if (formsMap[e.target.value]) {
                    formsMap[e.target.value].classList.add('active');
                }
            });
        });
    }

    bindRadios('ddl-subcommand', {
        create: document.getElementById('form-create-table'),
        alter: document.getElementById('form-alter-table'),
        truncate: document.getElementById('form-truncate-table'),
        drop: document.getElementById('form-drop-table')
    });

    bindRadios('dml-subcommand', {
        select: document.getElementById('form-dml-select'),
        insert: document.getElementById('form-dml-insert'),
        update: document.getElementById('form-dml-update'),
        delete: document.getElementById('form-dml-delete')
    });

    bindRadios('index-subcommand', {
        create: document.getElementById('form-create-index'),
        drop: document.getElementById('form-drop-index'),
        show: document.getElementById('form-show-index')
    });

    bindRadios('trg-subcommand', {
        create: document.getElementById('form-create-trigger'),
        drop: document.getElementById('form-drop-trigger'),
        show: document.getElementById('form-show-triggers')
    });

    bindRadios('proc-subcommand', {
        create: document.getElementById('form-create-proc'),
        call: document.getElementById('form-call-proc'),
        drop: document.getElementById('form-drop-proc'),
        show: document.getElementById('form-show-procs')
    });

    bindRadios('view-subcommand', {
        create: document.getElementById('form-create-view'),
        drop: document.getElementById('form-drop-view'),
        show: document.getElementById('form-show-views')
    });
}

// Динамические поля для ALTER TABLE
function initAlterFields() {
    const select = document.getElementById('alter-action-select');
    const fieldColName = document.getElementById('alter-field-column-name');
    const fieldColType = document.getElementById('alter-field-column-type');
    const fieldNewCol = document.getElementById('alter-field-new-col');
    const fieldNewTable = document.getElementById('alter-field-new-table');
    const colLabel = document.getElementById('alter-col-label');

    function updateFields() {
        const action = select.value;
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

// Загрузка таблиц
async function loadTables() {
    const container = document.getElementById('tables-list');
    const counter = document.getElementById('tables-count');

    try {
        const res = await fetch('/tables');
        const data = await res.json();

        if (!data.success) {
            container.innerHTML = `<div class="empty-hint" style="color: #f87171;">${data.message}</div>`;
            return;
        }

        const tables = data.tables || [];
        counter.textContent = tables.length;

        if (tables.length === 0) {
            container.innerHTML = `<div class="empty-hint">Таблиц пока нет</div>`;
            return;
        }

        container.innerHTML = '';
        tables.forEach(tableName => {
            const item = document.createElement('div');
            item.className = 'table-item';
            item.innerHTML = `
                <span>${escapeHtml(tableName)}</span>
                <button type="button" class="table-item-btn" title="Структура">Схема</button>
            `;

            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('table-item-btn')) return;
                document.querySelectorAll('.table-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                fillActiveTableInput(tableName);
            });

            const schemaBtn = item.querySelector('.table-item-btn');
            schemaBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await inspectTableSchema(tableName);
            });

            container.appendChild(item);
        });
    } catch (err) {
        container.innerHTML = `<div class="empty-hint" style="color: #f87171;">Ошибка: ${err.message}</div>`;
    }
}

function fillActiveTableInput(name) {
    const ids = [
        'alter-table-name',
        'truncate-table-name',
        'drop-table-name',
        'select-table-name',
        'insert-table-name',
        'update-table-name',
        'delete-table-name',
        'idx-table-name',
        'drop-idx-table',
        'show-idx-table',
        'trg-table'
    ];
    ids.forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = name;
    });
}

async function inspectTableSchema(tableName) {
    try {
        const res = await fetch(`/tables/${encodeURIComponent(tableName)}/schema`);
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

// Обработчики форм
function initForms() {
    // --- DDL ---
    document.getElementById('form-create-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/ddl', {
            command: 'CREATE_TABLE',
            table_name: document.getElementById('create-table-name').value,
            columns: document.getElementById('create-columns').value,
            types: document.getElementById('create-types').value,
        }, true);
    });

    document.getElementById('form-alter-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/ddl', {
            command: 'ALTER_TABLE',
            table_name: document.getElementById('alter-table-name').value,
            alter_action: document.getElementById('alter-action-select').value,
            column_name: document.getElementById('alter-col-input').value,
            column_type: document.getElementById('alter-type-input').value,
            new_column_name: document.getElementById('alter-new-col-input').value,
            new_table_name: document.getElementById('alter-new-table-input').value,
        }, true);
    });

    document.getElementById('form-truncate-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tbl = document.getElementById('truncate-table-name').value;
        if (!confirm(`Очистить таблицу '${tbl}'?`)) return;
        await sendRequest('/ddl', { command: 'TRUNCATE_TABLE', table_name: tbl });
    });

    document.getElementById('form-drop-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tbl = document.getElementById('drop-table-name').value;
        if (!confirm(`Удалить таблицу '${tbl}'?`)) return;
        await sendRequest('/ddl', { command: 'DROP_TABLE', table_name: tbl }, true);
    });

    // --- DML ---
    document.getElementById('form-dml-select').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/dml', {
            command: 'SELECT',
            table_name: document.getElementById('select-table-name').value,
            columns: document.getElementById('select-columns').value,
            where: document.getElementById('select-where').value,
            limit: parseInt(document.getElementById('select-limit').value, 10) || 50,
        });
    });

    document.getElementById('form-dml-insert').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/dml', {
            command: 'INSERT',
            table_name: document.getElementById('insert-table-name').value,
            columns: document.getElementById('insert-columns').value,
            values: document.getElementById('insert-values').value,
        });
    });

    document.getElementById('form-dml-update').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/dml', {
            command: 'UPDATE',
            table_name: document.getElementById('update-table-name').value,
            set_clause: document.getElementById('update-set').value,
            where: document.getElementById('update-where').value,
        });
    });

    document.getElementById('form-dml-delete').addEventListener('submit', async (e) => {
        e.preventDefault();
        const where = document.getElementById('delete-where').value;
        if (!where.trim() && !confirm('WHERE пустой. Удалить ВСЕ строки?')) return;
        await sendRequest('/dml', {
            command: 'DELETE',
            table_name: document.getElementById('delete-table-name').value,
            where: where,
        });
    });

    // --- ИНДЕКСЫ ---
    document.getElementById('form-create-index').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/indexes', {
            command: 'CREATE_INDEX',
            table_name: document.getElementById('idx-table-name').value,
            index_name: document.getElementById('idx-name').value,
            columns: document.getElementById('idx-columns').value,
            unique: document.getElementById('idx-unique').checked,
        });
    });

    document.getElementById('form-drop-index').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/indexes', {
            command: 'DROP_INDEX',
            table_name: document.getElementById('drop-idx-table').value,
            index_name: document.getElementById('drop-idx-name').value,
        });
    });

    document.getElementById('form-show-index').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/indexes', {
            command: 'SHOW_INDEX',
            table_name: document.getElementById('show-idx-table').value,
        });
    });

    // --- ТРИГГЕРЫ ---
    document.getElementById('form-create-trigger').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/triggers', {
            command: 'CREATE_TRIGGER',
            trigger_name: document.getElementById('trg-name').value,
            table_name: document.getElementById('trg-table').value,
            timing: document.getElementById('trg-timing').value,
            event: document.getElementById('trg-event').value,
            statement: document.getElementById('trg-statement').value,
        });
    });

    document.getElementById('form-drop-trigger').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/triggers', {
            command: 'DROP_TRIGGER',
            trigger_name: document.getElementById('drop-trg-name').value,
        });
    });

    document.getElementById('form-show-triggers').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/triggers', { command: 'SHOW_TRIGGERS' });
    });

    // --- ХРАНИМЫЕ ПРОЦЕДУРЫ ---
    document.getElementById('form-create-proc').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/procedures', {
            command: 'CREATE_PROCEDURE',
            procedure_name: document.getElementById('proc-name').value,
            parameters: document.getElementById('proc-params').value,
            body: document.getElementById('proc-body').value,
        });
    });

    document.getElementById('form-call-proc').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/procedures', {
            command: 'CALL_PROCEDURE',
            procedure_name: document.getElementById('call-proc-name').value,
            call_args: document.getElementById('call-proc-args').value,
        });
    });

    document.getElementById('form-drop-proc').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/procedures', {
            command: 'DROP_PROCEDURE',
            procedure_name: document.getElementById('drop-proc-name').value,
        });
    });

    document.getElementById('form-show-procs').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/procedures', { command: 'SHOW_PROCEDURES' });
    });

    // --- ПРЕДСТАВЛЕНИЯ (VIEWS) ---
    document.getElementById('form-create-view').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/views', {
            command: 'CREATE_VIEW',
            view_name: document.getElementById('view-name').value,
            select_query: document.getElementById('view-query').value,
        }, true);
    });

    document.getElementById('form-drop-view').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/views', {
            command: 'DROP_VIEW',
            view_name: document.getElementById('drop-view-name').value,
        }, true);
    });

    document.getElementById('form-show-views').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/views', { command: 'SHOW_VIEWS' });
    });

    // --- RAW SQL ---
    document.getElementById('form-raw-sql').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/raw-sql', {
            query: document.getElementById('raw-sql-input').value,
        }, true);
    });
}

async function sendRequest(url, payload, shouldReloadTables = false) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        displayResult(data);

        if (shouldReloadTables && data.success) {
            loadTables();
        }
    } catch (err) {
        displayResult({
            success: false,
            status: 500,
            duration_ms: 0,
            message: `Сетевая ошибка: ${err.message}`,
        });
    }
}

function displayResult(data) {
    const statusTag = document.getElementById('meta-status');
    const timeTag = document.getElementById('meta-time');
    const queryPreview = document.getElementById('query-preview');
    const queryCode = document.getElementById('query-code');
    const resultMessage = document.getElementById('result-message');
    const tableContainer = document.getElementById('table-container');
    const thead = document.getElementById('result-thead');
    const tbody = document.getElementById('result-tbody');

    statusTag.className = 'meta-tag';
    if (data.success) {
        statusTag.textContent = `${data.status || 200} OK`;
        statusTag.classList.add('status-ok');
    } else {
        statusTag.textContent = `Код ${data.status || 'ERR'}`;
        statusTag.classList.add('status-err');
    }

    timeTag.textContent = data.duration_ms !== undefined ? `${data.duration_ms} мс` : '—';

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
