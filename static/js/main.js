// Глобальное состояние приложения
const appState = {
    activeDatabase: '',
    activeObject: null, // { type: 'table'|'view'|'proc'|'trg', name: '...' }
    databases: [],
    treeCache: {}, // dbName -> { tables: [], views: [], procedures: [], triggers: [] }
    expandedDbs: new Set(),
    expandedCategories: new Set(),
    currentRows: [],
    currentColumns: [],
};

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initRadioSelectors();
    initAlterFields();
    initContextBar();
    initModal();
    initForms();
    initSearchFilter();
    initQueryPreviewActions();
    initTabSupportInTextareas();

    // Загрузка дерева баз данных
    loadDatabasesAndTree();

    // Кнопки обновления
    document.getElementById('btn-refresh-all').addEventListener('click', () => loadDatabasesAndTree(true));
    document.getElementById('btn-sidebar-refresh').addEventListener('click', () => loadDatabasesAndTree(true));
    document.getElementById('btn-sidebar-add-db').addEventListener('click', openCreateDbModal);
    document.getElementById('btn-open-create-db-modal').addEventListener('click', openCreateDbModal);
});

// --- УПРАВЛЕНИЕ ВКЛАДКАМИ ---
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

function switchTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
}

// --- ПЕРЕКЛЮЧЕНИЕ ПОДКОМАНД (РАДИОКНОПКИ) ---
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
        drop: document.getElementById('form-drop-table'),
    });

    bindRadios('dml-subcommand', {
        select: document.getElementById('form-dml-select'),
        insert: document.getElementById('form-dml-insert'),
        update: document.getElementById('form-dml-update'),
        delete: document.getElementById('form-dml-delete'),
    });

    bindRadios('index-subcommand', {
        create: document.getElementById('form-create-index'),
        drop: document.getElementById('form-drop-index'),
        show: document.getElementById('form-show-index'),
    });

    bindRadios('trg-subcommand', {
        create: document.getElementById('form-create-trigger'),
        drop: document.getElementById('form-drop-trigger'),
        show: document.getElementById('form-show-triggers'),
    });

    bindRadios('proc-subcommand', {
        create: document.getElementById('form-create-proc'),
        call: document.getElementById('form-call-proc'),
        drop: document.getElementById('form-drop-proc'),
        show: document.getElementById('form-show-procs'),
    });

    bindRadios('view-subcommand', {
        create: document.getElementById('form-create-view'),
        drop: document.getElementById('form-drop-view'),
        show: document.getElementById('form-show-views'),
    });

    bindRadios('db-subcommand', {
        create: document.getElementById('form-create-db-tab'),
        drop: document.getElementById('form-drop-db-tab'),
        show: document.getElementById('form-show-dbs-tab'),
    });
}

// --- ДИНАМИЧЕСКИЕ ПОЛЯ ДЛЯ ALTER TABLE ---
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

// --- КОНТЕКСТНАЯ СТРОКА ---
function initContextBar() {
    const select = document.getElementById('context-db-select');
    select.addEventListener('change', async (e) => {
        const dbName = e.target.value;
        if (dbName && dbName !== appState.activeDatabase) {
            await setActiveDatabase(dbName);
        }
    });

    document.getElementById('btn-context-browse').addEventListener('click', () => {
        if (appState.activeObject && appState.activeObject.type === 'table') {
            loadTableData(appState.activeDatabase, appState.activeObject.name);
        }
    });

    document.getElementById('btn-context-schema').addEventListener('click', () => {
        if (appState.activeObject && appState.activeObject.type === 'table') {
            loadTableSchema(appState.activeDatabase, appState.activeObject.name);
        }
    });
}

// --- МОДАЛЬНОЕ ОКНО СОЗДАНИЯ БД ---
function initModal() {
    const modal = document.getElementById('modal-create-db');
    const closeBtn = document.getElementById('modal-close-create-db');
    const cancelBtn = document.getElementById('btn-cancel-create-db');
    const form = document.getElementById('form-modal-create-db');

    const closeModal = () => { modal.style.display = 'none'; };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dbName = document.getElementById('modal-db-name').value.trim();
        const charset = document.getElementById('modal-db-charset').value;
        const collation = document.getElementById('modal-db-collation').value;

        await createDatabaseAction(dbName, charset, collation);
        closeModal();
        form.reset();
    });
}

function openCreateDbModal() {
    document.getElementById('modal-create-db').style.display = 'flex';
    document.getElementById('modal-db-name').focus();
}

// --- ЗАГРУЗКА БАЗ ДАННЫХ И ДЕРЕВА ---
async function loadDatabasesAndTree(forceReload = false) {
    const treeContainer = document.getElementById('database-tree');
    const dbCountEl = document.getElementById('db-count');
    const contextSelect = document.getElementById('context-db-select');

    try {
        const res = await fetch('/databases');
        const data = await res.json();

        if (!data.success) {
            treeContainer.innerHTML = `<div class="tree-loading" style="color: #f87171;">${escapeHtml(data.message)}</div>`;
            return;
        }

        appState.databases = data.databases || [];
        dbCountEl.textContent = appState.databases.length;

        // Если активная база ещё не задана, берем с бэкенда или первую доступную
        if (!appState.activeDatabase && data.active_database) {
            appState.activeDatabase = data.active_database;
        } else if (!appState.activeDatabase && appState.databases.length > 0) {
            // Найдём первую несистемную базу
            const nonSystem = appState.databases.find(db => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));
            appState.activeDatabase = nonSystem || appState.databases[0];
        }

        // По умолчанию разворачиваем активную базу
        if (appState.activeDatabase) {
            appState.expandedDbs.add(appState.activeDatabase);
            // Разворачиваем таблицы по умолчанию
            appState.expandedCategories.add(`${appState.activeDatabase}:tables`);
        }

        // Обновляем селектор контекста
        contextSelect.innerHTML = appState.databases.map(db =>
            `<option value="${escapeHtml(db)}" ${db === appState.activeDatabase ? 'selected' : ''}>${escapeHtml(db)}</option>`
        ).join('');

        updateActiveDbHeader();

        // Загружаем объекты для развернутых баз данных
        await renderTree();

    } catch (err) {
        treeContainer.innerHTML = `<div class="tree-loading" style="color: #f87171;">Ошибка сети: ${escapeHtml(err.message)}</div>`;
    }
}

async function renderTree() {
    const treeContainer = document.getElementById('database-tree');
    if (appState.databases.length === 0) {
        treeContainer.innerHTML = `<div class="tree-loading">Нет баз данных</div>`;
        return;
    }

    treeContainer.innerHTML = '';

    for (const dbName of appState.databases) {
        const isExpanded = appState.expandedDbs.has(dbName);
        const isActive = (dbName === appState.activeDatabase);

        const node = document.createElement('div');
        node.className = 'db-node';
        node.dataset.db = dbName;

        const header = document.createElement('div');
        header.className = `db-node-header ${isActive ? 'active' : ''}`;
        header.innerHTML = `
            <button type="button" class="tree-toggle ${isExpanded ? '' : 'collapsed'}" title="${isExpanded ? 'Свернуть' : 'Развернуть'}">▼</button>
            <span class="db-icon">🗄️</span>
            <span class="db-name" title="${escapeHtml(dbName)}">${escapeHtml(dbName)}</span>
            ${isActive ? '<span class="active-badge">активна</span>' : ''}
            <button type="button" class="db-drop-btn" title="Удалить базу данных '${escapeHtml(dbName)}'">✕</button>
        `;

        // Клик по стрелке: свернуть / развернуть
        const toggleBtn = header.querySelector('.tree-toggle');
        toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (appState.expandedDbs.has(dbName)) {
                appState.expandedDbs.delete(dbName);
            } else {
                appState.expandedDbs.add(dbName);
            }
            await renderTree();
        });

        // Клик по имени базы: сделать активной и развернуть
        header.addEventListener('click', async (e) => {
            if (e.target.closest('.tree-toggle') || e.target.closest('.db-drop-btn')) return;
            if (!appState.expandedDbs.has(dbName)) {
                appState.expandedDbs.add(dbName);
            }
            await setActiveDatabase(dbName);
        });

        // Удаление базы
        const dropBtn = header.querySelector('.db-drop-btn');
        dropBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Вы действительно хотите удалить базу данных '${dbName}'?\nВсе данные будут безвозвратно потеряны!`)) {
                await dropDatabaseAction(dbName);
            }
        });

        node.appendChild(header);

        // Если база развернута, рендерим дочерние объекты
        if (isExpanded) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'db-children';

            // Получаем дерево объектов для этой БД
            const data = await getDbTreeData(dbName);
            if (data) {
                renderDbCategories(childrenContainer, dbName, data);
            }

            node.appendChild(childrenContainer);
        }

        treeContainer.appendChild(node);
    }
}

async function getDbTreeData(dbName) {
    if (appState.treeCache[dbName]) {
        return appState.treeCache[dbName];
    }
    try {
        const res = await fetch(`/databases/${encodeURIComponent(dbName)}/tree`);
        const data = await res.json();
        if (data.success) {
            appState.treeCache[dbName] = data;
            return data;
        }
        return null;
    } catch (err) {
        return null;
    }
}

function renderDbCategories(container, dbName, data) {
    const categories = [
        { key: 'tables', title: 'Таблицы', icon: '📄', items: data.tables || [] },
        { key: 'views', title: 'Представления', icon: '👁️', items: data.views || [] },
        { key: 'procedures', title: 'Процедуры', icon: '⚙️', items: data.procedures || [] },
        { key: 'triggers', title: 'Триггеры', icon: '⚡', items: data.triggers || [] },
    ];

    categories.forEach(cat => {
        const catKey = `${dbName}:${cat.key}`;
        const isExpanded = appState.expandedCategories.has(catKey);

        const catNode = document.createElement('div');
        catNode.className = 'category-node';

        const catHeader = document.createElement('div');
        catHeader.className = 'category-header';
        catHeader.innerHTML = `
            <button type="button" class="tree-toggle ${isExpanded ? '' : 'collapsed'}">▼</button>
            <span class="cat-icon">📁</span>
            <span class="cat-title">${cat.title}</span>
            <span class="counter">${cat.items.length}</span>
        `;

        catHeader.addEventListener('click', () => {
            if (appState.expandedCategories.has(catKey)) {
                appState.expandedCategories.delete(catKey);
            } else {
                appState.expandedCategories.add(catKey);
            }
            renderTree();
        });

        catNode.appendChild(catHeader);

        if (isExpanded) {
            const catChildren = document.createElement('div');
            catChildren.className = 'category-children';

            if (cat.items.length === 0) {
                catChildren.innerHTML = `<div class="empty-hint" style="padding: 2px 6px; font-size: 11px;">(пусто)</div>`;
            } else {
                cat.items.forEach(itemName => {
                    const item = document.createElement('div');
                    item.className = 'tree-item';
                    const isItemActive = appState.activeObject &&
                        appState.activeObject.name === itemName &&
                        appState.activeDatabase === dbName;

                    if (isItemActive) item.classList.add('active');

                    let actionsHtml = '';
                    if (cat.key === 'tables') {
                        actionsHtml = `
                            <button type="button" class="item-action-btn btn-data" title="Просмотр данных">Данные</button>
                            <button type="button" class="item-action-btn btn-schema" title="Структура таблицы">Схема</button>
                        `;
                    } else if (cat.key === 'views') {
                        actionsHtml = `
                            <button type="button" class="item-action-btn btn-data" title="Просмотр данных">Данные</button>
                            <button type="button" class="item-action-btn btn-code" title="Определение DDL">DDL</button>
                        `;
                    } else if (cat.key === 'procedures') {
                        actionsHtml = `
                            <button type="button" class="item-action-btn btn-code" title="Посмотреть тело процедуры">Код</button>
                            <button type="button" class="item-action-btn btn-call" title="Перейти к вызову">Вызов</button>
                        `;
                    } else if (cat.key === 'triggers') {
                        actionsHtml = `
                            <button type="button" class="item-action-btn btn-code" title="Посмотреть определение триггера">Код</button>
                        `;
                    }

                    item.innerHTML = `
                        <div class="item-left">
                            <span>${cat.icon}</span>
                            <span class="item-name" title="${escapeHtml(itemName)}">${escapeHtml(itemName)}</span>
                        </div>
                        <div class="item-actions">${actionsHtml}</div>
                    `;

                    // Клик по самому элементу
                    item.addEventListener('click', async (e) => {
                        if (e.target.closest('.item-action-btn')) return;
                        selectActiveObject(cat.key.slice(0, -1), itemName, dbName);
                        if (cat.key === 'tables') {
                            await loadTableData(dbName, itemName);
                        } else if (cat.key === 'views') {
                            await loadViewData(dbName, itemName);
                        }
                    });

                    // Действия кнопок
                    if (cat.key === 'tables') {
                        item.querySelector('.btn-data').addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectActiveObject('table', itemName, dbName);
                            loadTableData(dbName, itemName);
                        });
                        item.querySelector('.btn-schema').addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectActiveObject('table', itemName, dbName);
                            loadTableSchema(dbName, itemName);
                        });
                    } else if (cat.key === 'views') {
                        item.querySelector('.btn-data').addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectActiveObject('view', itemName, dbName);
                            loadViewData(dbName, itemName);
                        });
                        item.querySelector('.btn-code').addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectActiveObject('view', itemName, dbName);
                            loadViewDefinition(dbName, itemName);
                        });
                    } else if (cat.key === 'procedures') {
                        item.querySelector('.btn-code').addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectActiveObject('procedure', itemName, dbName);
                            loadProcedureDefinition(dbName, itemName);
                        });
                        item.querySelector('.btn-call').addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectActiveObject('procedure', itemName, dbName);
                            switchTab('procedures');
                            const radioCall = document.querySelector('input[name="proc-subcommand"][value="call"]');
                            if (radioCall) {
                                radioCall.checked = true;
                                radioCall.dispatchEvent(new Event('change'));
                            }
                            document.getElementById('call-proc-name').value = itemName;
                        });
                    } else if (cat.key === 'triggers') {
                        item.querySelector('.btn-code').addEventListener('click', (e) => {
                            e.stopPropagation();
                            selectActiveObject('trigger', itemName, dbName);
                            loadTriggerDefinition(dbName, itemName);
                        });
                    }

                    catChildren.appendChild(item);
                });
            }

            catNode.appendChild(catChildren);
        }

        container.appendChild(catNode);
    });
}

// --- ВЫБОР АКТИВНОЙ БАЗЫ ДАННЫХ И ОБЪЕКТА ---
async function setActiveDatabase(dbName) {
    if (!dbName) return;
    try {
        const res = await fetch('/databases/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ database: dbName }),
        });
        const data = await res.json();
        if (data.success) {
            appState.activeDatabase = dbName;
            updateActiveDbHeader();
            document.getElementById('context-db-select').value = dbName;
            fillActiveDatabaseInputs(dbName);
            await renderTree();
        } else {
            displayResult(data);
        }
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

function updateActiveDbHeader() {
    const badge = document.getElementById('header-active-db-name');
    if (badge) badge.textContent = appState.activeDatabase || 'не выбрана';

    const hint = document.getElementById('raw-sql-target-hint');
    if (hint) hint.textContent = `База: ${appState.activeDatabase || '—'}`;
}

function selectActiveObject(type, name, dbName) {
    if (dbName && dbName !== appState.activeDatabase) {
        appState.activeDatabase = dbName;
        updateActiveDbHeader();
        document.getElementById('context-db-select').value = dbName;
    }

    appState.activeObject = { type, name };
    const objEl = document.getElementById('context-active-object');
    if (objEl) {
        const icons = { table: '📄', view: '👁️', procedure: '⚙️', trigger: '⚡' };
        objEl.textContent = `${icons[type] || ''} ${name}`;
    }

    const btnBrowse = document.getElementById('btn-context-browse');
    const btnSchema = document.getElementById('btn-context-schema');
    if (type === 'table') {
        btnBrowse.style.display = 'inline-flex';
        btnSchema.style.display = 'inline-flex';
    } else {
        btnBrowse.style.display = 'none';
        btnSchema.style.display = 'none';
    }

    if (type === 'table') {
        fillActiveTableInputs(name);
    }
}

function fillActiveDatabaseInputs(dbName) {
    const rawHint = document.getElementById('raw-sql-target-hint');
    if (rawHint) rawHint.textContent = `База: ${dbName}`;
}

function fillActiveTableInputs(tableName) {
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
        'trg-table',
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = tableName;
    });
}

// --- ЗАГРУЗКА ДАННЫХ И СХЕМ ОБЪЕКТОВ ---
async function loadTableData(dbName, tableName) {
    try {
        const res = await fetch(`/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/data?limit=100`);
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

async function loadTableSchema(dbName, tableName) {
    try {
        const res = await fetch(`/databases/${encodeURIComponent(dbName)}/tables/${encodeURIComponent(tableName)}/schema`);
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

async function loadViewData(dbName, viewName) {
    try {
        const res = await fetch(`/databases/${encodeURIComponent(dbName)}/views/${encodeURIComponent(viewName)}/data?limit=100`);
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

async function loadViewDefinition(dbName, viewName) {
    try {
        const res = await fetch(`/databases/${encodeURIComponent(dbName)}/views/${encodeURIComponent(viewName)}/definition`);
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

async function loadProcedureDefinition(dbName, procName) {
    try {
        const res = await fetch(`/databases/${encodeURIComponent(dbName)}/procedures/${encodeURIComponent(procName)}/definition`);
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

async function loadTriggerDefinition(dbName, trgName) {
    try {
        const res = await fetch(`/databases/${encodeURIComponent(dbName)}/triggers/${encodeURIComponent(trgName)}/definition`);
        const data = await res.json();
        displayResult(data);
    } catch (err) {
        displayResult({ success: false, status: 500, message: err.message });
    }
}

// --- ДЕЙСТВИЯ С БАЗАМИ ДАННЫХ ---
async function createDatabaseAction(databaseName, charset, collation) {
    await sendRequest('/databases', {
        database_name: databaseName,
        charset: charset || 'utf8mb4',
        collation: collation || 'utf8mb4_unicode_ci',
    }, true);
}

async function dropDatabaseAction(databaseName) {
    await sendRequest('/databases/drop', {
        database: databaseName,
    }, true);
}

// --- ОТПРАВКА ЗАПРОСОВ ---
async function sendRequest(url, payload, shouldReloadTree = false) {
    try {
        // Подмешиваем активную базу данных, если не указана
        if (!payload.database && appState.activeDatabase) {
            payload.database = appState.activeDatabase;
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        displayResult(data);

        if (shouldReloadTree && data.success) {
            // Очищаем кэш дерева для активной БД
            if (payload.database) {
                delete appState.treeCache[payload.database];
            }
            delete appState.treeCache[appState.activeDatabase];
            await loadDatabasesAndTree(true);
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

// --- ВЫВОД РЕЗУЛЬТАТОВ ---
function displayResult(data) {
    const statusTag = document.getElementById('meta-status');
    const timeTag = document.getElementById('meta-time');
    const queryPreview = document.getElementById('query-preview');
    const queryCode = document.getElementById('query-code');
    const resultMessage = document.getElementById('result-message');
    const countBadge = document.getElementById('results-count-badge');
    const tableToolbar = document.getElementById('table-toolbar');
    const tableContainer = document.getElementById('table-container');
    const thead = document.getElementById('result-thead');
    const tbody = document.getElementById('result-tbody');
    const rowsInfo = document.getElementById('table-rows-info');

    // Статус
    statusTag.className = 'meta-tag';
    if (data.success) {
        statusTag.textContent = `${data.status || 200} OK`;
        statusTag.classList.add('status-ok');
    } else {
        statusTag.textContent = `Код ${data.status || 'ERR'}`;
        statusTag.classList.add('status-err');
    }

    // Время
    timeTag.textContent = data.duration_ms !== undefined ? `${data.duration_ms} мс` : '—';

    // SQL предпросмотр
    if (data.query) {
        queryPreview.style.display = 'flex';
        queryPreview.classList.remove('expanded');
        queryCode.textContent = data.query;
    } else {
        queryPreview.style.display = 'none';
    }

    // Сообщение
    resultMessage.className = 'result-message';
    resultMessage.classList.add(data.success ? 'success' : 'error');
    resultMessage.textContent = data.message || (data.success ? 'Успешно' : 'Ошибка');

    // Таблица данных
    if (data.rows && Array.isArray(data.rows) && data.rows.length > 0 && data.columns && data.columns.length > 0) {
        appState.currentRows = data.rows;
        appState.currentColumns = data.columns;

        countBadge.style.display = 'inline-block';
        countBadge.textContent = `${data.rows.length} строк`;

        tableToolbar.style.display = 'flex';
        rowsInfo.textContent = `Показано ${data.rows.length} ${data.total_count ? `из ${data.total_count}` : ''} строк`;

        tableContainer.style.display = 'block';
        renderTableRows(data.columns, data.rows);

        const resultsPanel = document.getElementById('results-panel');
        if (resultsPanel) {
            resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    } else {
        appState.currentRows = [];
        appState.currentColumns = [];
        countBadge.style.display = 'none';
        tableToolbar.style.display = 'none';
        tableContainer.style.display = 'none';
        thead.innerHTML = '';
        tbody.innerHTML = '';
    }
}

function renderTableRows(columns, rows) {
    const thead = document.getElementById('result-thead');
    const tbody = document.getElementById('result-tbody');

    thead.innerHTML = `<tr>${columns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}</tr>`;

    tbody.innerHTML = rows.map(row => {
        const cells = columns.map(col => {
            const val = row[col];
            let displayVal;
            if (val === null || val === undefined) {
                displayVal = '<span style="color: var(--text-dim); font-style: italic;">NULL</span>';
            } else if (typeof val === 'object') {
                displayVal = `<pre style="margin:0; font-size:11px;">${escapeHtml(JSON.stringify(val, null, 2))}</pre>`;
            } else {
                displayVal = escapeHtml(String(val));
            }
            return `<td>${displayVal}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');
}

// Быстрый поиск / фильтр по строкам таблицы
function initSearchFilter() {
    const filterInput = document.getElementById('table-filter-input');
    if (!filterInput) return;

    filterInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        if (!q) {
            renderTableRows(appState.currentColumns, appState.currentRows);
            document.getElementById('table-rows-info').textContent = `Показано ${appState.currentRows.length} строк`;
            return;
        }

        const filtered = appState.currentRows.filter(row => {
            return appState.currentColumns.some(col => {
                const val = row[col];
                return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
            });
        });

        renderTableRows(appState.currentColumns, filtered);
        document.getElementById('table-rows-info').textContent = `Найдено ${filtered.length} из ${appState.currentRows.length} строк`;
    });

    // Фильтр объектов в левом дереве
    const treeSearch = document.getElementById('tree-search-input');
    if (treeSearch) {
        treeSearch.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            const items = document.querySelectorAll('.tree-item');
            items.forEach(item => {
                const name = item.querySelector('.item-name')?.textContent.toLowerCase() || '';
                item.style.display = (!q || name.includes(q)) ? 'flex' : 'none';
            });
        });
    }
}

// --- ОБРАБОТЧИКИ ВСЕХ ФОРМ ---
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
        if (!confirm(`Очистить таблицу '${tbl}' в базе '${appState.activeDatabase}'?`)) return;
        await sendRequest('/ddl', { command: 'TRUNCATE_TABLE', table_name: tbl });
    });

    document.getElementById('form-drop-table').addEventListener('submit', async (e) => {
        e.preventDefault();
        const tbl = document.getElementById('drop-table-name').value;
        if (!confirm(`Удалить таблицу '${tbl}' из базы '${appState.activeDatabase}'?`)) return;
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
            limit: parseInt(document.getElementById('select-limit').value, 10) || 100,
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
        const tbl = document.getElementById('delete-table-name').value;
        const where = document.getElementById('delete-where').value;
        if (!where && !confirm(`Удалить ВСЕ строки из таблицы '${tbl}'?`)) return;
        await sendRequest('/dml', {
            command: 'DELETE',
            table_name: tbl,
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
        }, true);
    });

    document.getElementById('form-drop-trigger').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/triggers', {
            command: 'DROP_TRIGGER',
            trigger_name: document.getElementById('drop-trg-name').value,
        }, true);
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
        }, true);
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
        }, true);
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

    // --- УПРАВЛЕНИЕ БАЗАМИ ДАННЫХ (ВКЛАДКА) ---
    document.getElementById('form-create-db-tab').addEventListener('submit', async (e) => {
        e.preventDefault();
        const dbName = document.getElementById('tab-create-db-name').value.trim();
        const charset = document.getElementById('tab-create-db-charset').value;
        const collation = document.getElementById('tab-create-db-collation').value;
        await createDatabaseAction(dbName, charset, collation);
    });

    document.getElementById('form-drop-db-tab').addEventListener('submit', async (e) => {
        e.preventDefault();
        const dbName = document.getElementById('tab-drop-db-name').value.trim();
        if (confirm(`Вы точно хотите удалить базу данных '${dbName}' со всеми таблицами?`)) {
            await dropDatabaseAction(dbName);
        }
    });

    document.getElementById('form-show-dbs-tab').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/raw-sql', { query: 'SHOW DATABASES;' });
    });

    // --- RAW SQL ---
    document.getElementById('form-raw-sql').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sendRequest('/raw-sql', {
            query: document.getElementById('raw-sql-input').value,
        }, true);
    });
}

// --- УТИЛИТА ЭКРАНИРОВАНИЯ HTML ---
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// --- УПРАВЛЕНИЕ SQL PREVIEW (РАЗВОРАЧИВАНИЕ И КОПИРОВАНИЕ) ---
function initQueryPreviewActions() {
    const preview = document.getElementById('query-preview');
    const code = document.getElementById('query-code');
    const btnExpand = document.getElementById('btn-toggle-query-expand');
    const btnCopy = document.getElementById('btn-copy-query');

    if (btnExpand && preview) {
        btnExpand.addEventListener('click', (e) => {
            e.stopPropagation();
            preview.classList.toggle('expanded');
        });
    }

    if (code && preview) {
        code.addEventListener('click', () => {
            preview.classList.toggle('expanded');
        });
    }

    if (btnCopy && code) {
        btnCopy.addEventListener('click', async (e) => {
            e.stopPropagation();
            const sql = code.textContent || '';
            if (!sql) return;
            try {
                await navigator.clipboard.writeText(sql);
                btnCopy.textContent = '✓';
                setTimeout(() => { btnCopy.textContent = '📋'; }, 1200);
            } catch (err) {
                // clipboard fallback
            }
        });
    }
}

// --- ПОДДЕРЖКА ТАБОВ И ГОРЯЧИХ КЛАВИШ В ТЕКСТОВЫХ ПОЛЯХ ---
function initTabSupportInTextareas() {
    document.addEventListener('keydown', (e) => {
        const target = e.target;
        if (!target) return;

        // Горячая клавиша Ctrl+Enter / Cmd+Enter для быстрой отправки формы
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
                const form = target.closest('form');
                if (form) {
                    e.preventDefault();
                    if (typeof form.requestSubmit === 'function') {
                        form.requestSubmit();
                    } else {
                        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                    }
                }
            }
            return;
        }

        // Поддержка Tab и Shift+Tab только для многострочных полей (textarea)
        if (target.tagName !== 'TEXTAREA') return;

        if (e.key === 'Tab') {
            e.preventDefault();

            const start = target.selectionStart;
            const end = target.selectionEnd;
            const val = target.value;

            if (e.shiftKey) {
                // Shift+Tab: уменьшение отступа (unindent)
                const lineStart = val.lastIndexOf('\n', start - 1) + 1;
                let lineEnd = val.indexOf('\n', end);
                if (lineEnd === -1) lineEnd = val.length;

                const textToUnindent = val.substring(lineStart, lineEnd);
                const lines = textToUnindent.split('\n');
                let firstLineRemoved = 0;
                let totalRemoved = 0;

                const processed = lines.map((line, idx) => {
                    let removed = 0;
                    let newLine = line;
                    if (line.startsWith('\t')) {
                        newLine = line.substring(1);
                        removed = 1;
                    } else if (line.startsWith('    ')) {
                        newLine = line.substring(4);
                        removed = 4;
                    } else {
                        const m = line.match(/^ {1,3}/);
                        if (m) {
                            newLine = line.substring(m[0].length);
                            removed = m[0].length;
                        }
                    }
                    if (idx === 0) firstLineRemoved = removed;
                    totalRemoved += removed;
                    return newLine;
                });

                const replacement = processed.join('\n');
                target.setRangeText(replacement, lineStart, lineEnd, 'preserve');

                const newStart = Math.max(lineStart, start - firstLineRemoved);
                const newEnd = Math.max(newStart, end - totalRemoved);
                target.setSelectionRange(newStart, newEnd);
                target.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // Tab: увеличение отступа (indent)
                const isMultiLine = start !== end && val.substring(start, end).includes('\n');

                if (isMultiLine) {
                    // Выделено несколько строк: добавляем табуляцию перед каждой строкой
                    const lineStart = val.lastIndexOf('\n', start - 1) + 1;
                    let lineEnd = val.indexOf('\n', end);
                    if (lineEnd === -1) lineEnd = val.length;

                    const textToIndent = val.substring(lineStart, lineEnd);
                    const lines = textToIndent.split('\n');
                    const processed = lines.map(line => '\t' + line);
                    const replacement = processed.join('\n');

                    target.setRangeText(replacement, lineStart, lineEnd, 'preserve');
                    target.setSelectionRange(start + 1, end + lines.length);
                    target.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    // Одиночный курсор или выделение внутри одной строки: вставляем символ табуляции '\t'
                    let inserted = false;
                    try {
                        inserted = document.execCommand('insertText', false, '\t');
                    } catch (err) {
                        inserted = false;
                    }

                    if (!inserted) {
                        target.setRangeText('\t', start, end, 'end');
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
            }
        }
    });
}

