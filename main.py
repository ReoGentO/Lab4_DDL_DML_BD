import datetime
import os
import re
import sys
import time
import multiprocessing
import webbrowser
from decimal import Decimal
from typing import Any, Dict, List, Optional

import mysql.connector
import mysql.connector.plugins.caching_sha2_password
import mysql.connector.plugins.mysql_native_password
import mysql.connector.locales.eng.client_error
import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from colorama import just_fix_windows_console, Fore

from models import (
    CreateDatabasePayload,
    SelectDatabasePayload,
    DDLPayload,
    DMLPayload,
    IndexPayload,
    ProcedurePayload,
    RawSQLPayload,
    TriggerPayload,
    ViewPayload,
    clean_identifier,
)

just_fix_windows_console()

DB_CONFIG = {
    "database": None,
    "port": 3306,
    "host": None,
    "user": None,
    "password": None,
    "charset": "utf8mb4",
    "collation": "utf8mb4_unicode_ci",
    "use_pure": True,
}


def serialize_value(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (datetime.datetime, datetime.date, datetime.time)):
        return val.isoformat()
    if isinstance(val, set):
        return sorted([serialize_value(x) for x in val])
    if isinstance(val, (bytes, bytearray)):
        try:
            return val.decode("utf-8")
        except Exception:
            return str(val)
    if isinstance(val, Decimal):
        return float(val) if (val % 1) else int(val)
    return val


def serialize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: serialize_value(v) for k, v in row.items()}


def get_db(db_name: Optional[str] = None):
    config = dict(DB_CONFIG)
    if db_name:
        config["database"] = db_name
    return mysql.connector.connect(**config)


def execute_sql(
    query: str,
    is_select: bool = False,
    multi: bool = False,
    db_name: Optional[str] = None,
) -> Dict[str, Any]:
    start_time = time.perf_counter()
    conn = None
    cursor = None
    try:
        conn = get_db(db_name)
        cursor = conn.cursor(dictionary=True)
        rows: List[Dict[str, Any]] = []
        columns: List[str] = []
        affected_rows = 0

        if multi:
            for result in cursor.execute(query, multi=True):
                if result.with_rows:
                    raw_rows = result.fetchall()
                    rows = [serialize_row(r) for r in raw_rows]
                    if result.description:
                        columns = [desc[0] for desc in result.description]
                affected_rows += result.rowcount
        else:
            cursor.execute(query)
            affected_rows = cursor.rowcount
            if is_select or cursor.description is not None:
                columns = [desc[0] for desc in cursor.description]
                raw_rows = cursor.fetchall()
                rows = [serialize_row(r) for r in raw_rows]

        conn.commit()
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "status": 200,
            "success": True,
            "query": query,
            "affected_rows": affected_rows,
            "columns": columns,
            "rows": rows,
            "duration_ms": duration_ms,
            "message": "Запрос успешно выполнен",
        }
    except mysql.connector.Error as err:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "status": err.errno,
            "success": False,
            "query": query,
            "duration_ms": duration_ms,
            "message": f"Ошибка [{err.errno}]: {err.msg}",
        }
    except Exception as e:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "status": 500,
            "success": False,
            "query": query,
            "duration_ms": duration_ms,
            "message": f"Системная ошибка: {str(e)}",
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def get_resource_path(relative_path: str) -> str:
    if hasattr(sys, "_MEIPASS"):
        return str(os.path.join(sys._MEIPASS, relative_path))
    return str(os.path.join(os.path.abspath("."), relative_path))


app = FastAPI(title="MySQL Object Manager")
app.mount("/static", StaticFiles(directory=get_resource_path("static")), name="static")
templates = Jinja2Templates(directory=get_resource_path("templates"))


@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"active_database": DB_CONFIG.get("database") or ""},
    )


# --- БАЗЫ ДАННЫХ (DATABASES) ---
@app.get("/databases")
async def list_databases():
    res = execute_sql("SHOW DATABASES;", is_select=True)
    if not res["success"]:
        return res
    dbs = [row["Database"] for row in res["rows"]] if res["rows"] else []
    return {
        "status": 200,
        "success": True,
        "databases": dbs,
        "active_database": DB_CONFIG.get("database"),
    }


@app.post("/databases/select")
async def select_database(payload: SelectDatabasePayload):
    clean_db = clean_identifier(payload.database)
    res = execute_sql(f"USE `{clean_db}`;", db_name=clean_db)
    if not res["success"]:
        return res
    DB_CONFIG["database"] = clean_db
    return {
        "status": 200,
        "success": True,
        "active_database": clean_db,
        "message": f"Активная база данных: `{clean_db}`",
    }


@app.post("/databases")
async def create_database(payload: CreateDatabasePayload):
    clean_db = clean_identifier(payload.database_name)
    charset = payload.charset or "utf8mb4"
    collation = payload.collation or "utf8mb4_unicode_ci"
    query = f"CREATE DATABASE `{clean_db}` CHARACTER SET {charset} COLLATE {collation};"
    res = execute_sql(query)
    if res["success"]:
        res["message"] = f"База данных `{clean_db}` успешно создана"
        res["created_database"] = clean_db
        if not DB_CONFIG.get("database"):
            DB_CONFIG["database"] = clean_db
    return res


@app.post("/databases/drop")
async def drop_database(payload: SelectDatabasePayload):
    clean_db = clean_identifier(payload.database)
    query = f"DROP DATABASE `{clean_db}`;"
    res = execute_sql(query)
    if res["success"]:
        res["message"] = f"База данных `{clean_db}` успешно удалена"
        if DB_CONFIG.get("database") == clean_db:
            DB_CONFIG["database"] = None
    return res


@app.get("/databases/{db_name}/tree")
async def database_tree(db_name: str):
    clean_db = clean_identifier(db_name)
    # Таблицы (BASE TABLE)
    t_res = execute_sql(
        f"SHOW FULL TABLES FROM `{clean_db}` WHERE Table_type = 'BASE TABLE';",
        is_select=True,
        db_name=clean_db,
    )
    tables = [row[t_res["columns"][0]] for row in t_res["rows"]] if t_res.get("success") and t_res.get("rows") else []

    # Представления (VIEW)
    v_res = execute_sql(
        f"SHOW FULL TABLES FROM `{clean_db}` WHERE Table_type = 'VIEW';",
        is_select=True,
        db_name=clean_db,
    )
    views = [row[v_res["columns"][0]] for row in v_res["rows"]] if v_res.get("success") and v_res.get("rows") else []

    # Процедуры
    p_res = execute_sql(
        f"SHOW PROCEDURE STATUS WHERE Db = '{clean_db}';",
        is_select=True,
        db_name=clean_db,
    )
    procedures = [row["Name"] for row in p_res["rows"]] if p_res.get("success") and p_res.get("rows") else []

    # Триггеры
    trg_res = execute_sql(
        f"SHOW TRIGGERS FROM `{clean_db}`;",
        is_select=True,
        db_name=clean_db,
    )
    triggers = [row["Trigger"] for row in trg_res["rows"]] if trg_res.get("success") and trg_res.get("rows") else []

    return {
        "status": 200,
        "success": True,
        "database": clean_db,
        "tables": tables,
        "views": views,
        "procedures": procedures,
        "triggers": triggers,
    }


# --- ТАБЛИЦЫ: ДАННЫЕ И СХЕМА ---
@app.get("/databases/{db_name}/tables/{table_name}/data")
async def table_data_endpoint(db_name: str, table_name: str, limit: int = 100, offset: int = 0):
    clean_db = clean_identifier(db_name)
    clean_tbl = clean_identifier(table_name)
    limit = max(1, min(limit, 1000))
    offset = max(0, offset)

    cnt_res = execute_sql(
        f"SELECT COUNT(*) AS total_count FROM `{clean_db}`.`{clean_tbl}`;",
        is_select=True,
        db_name=clean_db,
    )
    total_count = (
        cnt_res["rows"][0]["total_count"]
        if cnt_res.get("success") and cnt_res.get("rows")
        else 0
    )

    query = f"SELECT * FROM `{clean_db}`.`{clean_tbl}` LIMIT {limit} OFFSET {offset};"
    res = execute_sql(query, is_select=True, db_name=clean_db)
    if res["success"]:
        res["total_count"] = total_count
        res["limit"] = limit
        res["offset"] = offset
        res["message"] = f"Данные `{clean_db}`.`{clean_tbl}`: показано {len(res.get('rows', []))} из {total_count} строк"
    return res


@app.get("/databases/{db_name}/tables/{table_name}/schema")
async def table_schema_endpoint(db_name: str, table_name: str):
    clean_db = clean_identifier(db_name)
    clean_tbl = clean_identifier(table_name)
    res = execute_sql(f"DESCRIBE `{clean_db}`.`{clean_tbl}`;", is_select=True, db_name=clean_db)
    if res["success"]:
        res["message"] = f"Структура таблицы `{clean_db}`.`{clean_tbl}`"
    return res


# Обратная совместимость для /tables
@app.get("/tables")
async def list_tables():
    curr_db = DB_CONFIG.get("database")
    if not curr_db:
        return {"status": 400, "success": False, "message": "База данных не выбрана", "tables": []}
    return await database_tree(curr_db)


@app.get("/tables/{table_name}/schema")
async def table_schema_legacy(table_name: str):
    curr_db = DB_CONFIG.get("database")
    if not curr_db:
        return {"status": 400, "success": False, "message": "База данных не выбрана"}
    return await table_schema_endpoint(curr_db, table_name)


# --- ПРЕДСТАВЛЕНИЯ (VIEW) ---
@app.get("/databases/{db_name}/views/{view_name}/data")
async def view_data_endpoint(db_name: str, view_name: str, limit: int = 100):
    clean_db = clean_identifier(db_name)
    clean_v = clean_identifier(view_name)
    limit = max(1, min(limit, 1000))
    query = f"SELECT * FROM `{clean_db}`.`{clean_v}` LIMIT {limit};"
    res = execute_sql(query, is_select=True, db_name=clean_db)
    if res["success"]:
        res["message"] = f"Данные представления `{clean_db}`.`{clean_v}` ({len(res.get('rows', []))} строк)"
    return res


@app.get("/databases/{db_name}/views/{view_name}/definition")
async def view_definition_endpoint(db_name: str, view_name: str):
    clean_db = clean_identifier(db_name)
    clean_v = clean_identifier(view_name)
    res = execute_sql(f"SHOW CREATE VIEW `{clean_db}`.`{clean_v}`;", is_select=True, db_name=clean_db)
    if res["success"]:
        res["message"] = f"Определение VIEW `{clean_db}`.`{clean_v}`"
    return res


# --- ПРОЦЕДУРЫ ---
@app.get("/databases/{db_name}/procedures/{proc_name}/definition")
async def proc_definition_endpoint(db_name: str, proc_name: str):
    clean_db = clean_identifier(db_name)
    clean_p = clean_identifier(proc_name)
    res = execute_sql(f"SHOW CREATE PROCEDURE `{clean_db}`.`{clean_p}`;", is_select=True, db_name=clean_db)
    if res["success"]:
        res["message"] = f"Определение процедуры `{clean_db}`.`{clean_p}`"
    return res


# --- ТРИГГЕРЫ ---
@app.get("/databases/{db_name}/triggers/{trg_name}/definition")
async def trigger_definition_endpoint(db_name: str, trg_name: str):
    clean_db = clean_identifier(db_name)
    clean_t = clean_identifier(trg_name)
    res = execute_sql(f"SHOW CREATE TRIGGER `{clean_t}`;", is_select=True, db_name=clean_db)
    if res["success"]:
        res["message"] = f"Определение триггера `{clean_db}`.`{clean_t}`"
    return res


# --- DDL ---
@app.post("/ddl")
async def ddl_endpoint(payload: DDLPayload):
    cmd = payload.command.upper()
    target_db = clean_identifier(payload.database) if payload.database else DB_CONFIG.get("database")
    if not target_db:
        return {"status": 400, "success": False, "message": "Не указана целевая база данных"}
    table = payload.table_name

    if cmd == "CREATE_TABLE":
        if not payload.columns or not payload.types:
            return {"status": 400, "success": False, "message": "Укажите столбцы и типы"}

        cols = [c.strip() for c in payload.columns.split(",") if c.strip()]
        types = [t.strip() for t in payload.types.split(",") if t.strip()]

        if len(cols) != len(types):
            return {
                "status": 400,
                "success": False,
                "message": f"Количество колонок ({len(cols)}) не совпадает с типами ({len(types)})",
            }

        col_defs = []
        for col, col_type in zip(cols, types):
            col_clean = clean_identifier(col)
            col_defs.append(f"`{col_clean}` {col_type}")

        query = f"CREATE TABLE `{target_db}`.`{table}` (\n  " + ",\n  ".join(col_defs) + "\n);"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Таблица `{target_db}`.`{table}` успешно создана"
        return res

    elif cmd == "ALTER_TABLE":
        action = (payload.alter_action or "").upper()
        if action == "ADD":
            if not payload.column_name or not payload.column_type:
                return {"status": 400, "success": False, "message": "Укажите имя и тип нового столбца"}
            col_clean = clean_identifier(payload.column_name)
            query = f"ALTER TABLE `{target_db}`.`{table}` ADD COLUMN `{col_clean}` {payload.column_type};"
        elif action == "MODIFY":
            if not payload.column_name or not payload.column_type:
                return {"status": 400, "success": False, "message": "Укажите имя и новый тип столбца"}
            col_clean = clean_identifier(payload.column_name)
            query = f"ALTER TABLE `{target_db}`.`{table}` MODIFY COLUMN `{col_clean}` {payload.column_type};"
        elif action == "DROP_COLUMN":
            if not payload.column_name:
                return {"status": 400, "success": False, "message": "Укажите имя удаляемого столбца"}
            col_clean = clean_identifier(payload.column_name)
            query = f"ALTER TABLE `{target_db}`.`{table}` DROP COLUMN `{col_clean}`;"
        elif action == "RENAME_COLUMN":
            if not payload.column_name or not payload.new_column_name:
                return {"status": 400, "success": False, "message": "Укажите текущее и новое имя столбца"}
            old_c = clean_identifier(payload.column_name)
            new_c = clean_identifier(payload.new_column_name)
            query = f"ALTER TABLE `{target_db}`.`{table}` RENAME COLUMN `{old_c}` TO `{new_c}`;"
        elif action == "RENAME_TABLE":
            if not payload.new_table_name:
                return {"status": 400, "success": False, "message": "Укажите новое имя таблицы"}
            new_t = clean_identifier(payload.new_table_name)
            query = f"ALTER TABLE `{target_db}`.`{table}` RENAME TO `{target_db}`.`{new_t}`;"
        else:
            return {"status": 400, "success": False, "message": f"Неизвестное действие: {action}"}

        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Таблица `{target_db}`.`{table}` успешно изменена ({action})"
        return res

    elif cmd == "DROP_TABLE":
        query = f"DROP TABLE `{target_db}`.`{table}`;"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Таблица `{target_db}`.`{table}` удалена"
        return res

    elif cmd == "TRUNCATE_TABLE":
        query = f"TRUNCATE TABLE `{target_db}`.`{table}`;"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Таблица `{target_db}`.`{table}` очищена"
        return res

    return {"status": 404, "success": False, "message": f"Команда DDL '{cmd}' не поддерживается"}


# --- DML ---
@app.post("/dml")
async def dml_endpoint(payload: DMLPayload):
    cmd = payload.command.upper()
    target_db = clean_identifier(payload.database) if payload.database else DB_CONFIG.get("database")
    if not target_db:
        return {"status": 400, "success": False, "message": "Не указана целевая база данных"}
    table = payload.table_name

    if cmd == "SELECT":
        columns = payload.columns.strip() if payload.columns else "*"
        query = f"SELECT {columns} FROM `{target_db}`.`{table}`"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        if payload.limit and payload.limit > 0:
            query += f" LIMIT {payload.limit}"
        query += ";"
        return execute_sql(query, is_select=True, db_name=target_db)

    elif cmd == "INSERT":
        if not payload.values or not payload.values.strip():
            return {"status": 400, "success": False, "message": "Укажите значения (VALUES)"}

        cols_clause = f"({payload.columns.strip()}) " if payload.columns and payload.columns.strip() != "*" else ""
        query = f"INSERT INTO `{target_db}`.`{table}` {cols_clause}VALUES ({payload.values.strip()});"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Запись добавлена в `{target_db}`.`{table}`"
        return res

    elif cmd == "UPDATE":
        if not payload.set_clause or not payload.set_clause.strip():
            return {"status": 400, "success": False, "message": "Укажите выражение SET"}

        query = f"UPDATE `{target_db}`.`{table}` SET {payload.set_clause.strip()}"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        query += ";"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Обновлено строк в `{target_db}`.`{table}`: {res.get('affected_rows', 0)}"
        return res

    elif cmd == "DELETE":
        query = f"DELETE FROM `{target_db}`.`{table}`"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        query += ";"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Удалено строк из `{target_db}`.`{table}`: {res.get('affected_rows', 0)}"
        return res

    return {"status": 404, "success": False, "message": f"Команда DML '{cmd}' не поддерживается"}


# --- ИНДЕКСЫ ---
@app.post("/indexes")
async def indexes_endpoint(payload: IndexPayload):
    cmd = payload.command.upper()
    target_db = clean_identifier(payload.database) if payload.database else DB_CONFIG.get("database")
    if not target_db:
        return {"status": 400, "success": False, "message": "Не указана целевая база данных"}
    table = payload.table_name

    if cmd == "CREATE_INDEX":
        if not payload.index_name or not payload.columns:
            return {"status": 400, "success": False, "message": "Укажите имя индекса и столбцы"}
        idx_clean = clean_identifier(payload.index_name)
        cols = [f"`{clean_identifier(c)}`" for c in payload.columns.split(",") if c.strip()]
        unique_clause = "UNIQUE " if payload.unique else ""
        query = f"CREATE {unique_clause}INDEX `{idx_clean}` ON `{target_db}`.`{table}` ({', '.join(cols)});"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Индекс `{idx_clean}` успешно создан на `{target_db}`.`{table}`"
        return res

    elif cmd == "DROP_INDEX":
        if not payload.index_name:
            return {"status": 400, "success": False, "message": "Укажите имя удаляемого индекса"}
        idx_clean = clean_identifier(payload.index_name)
        query = f"DROP INDEX `{idx_clean}` ON `{target_db}`.`{table}`;"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Индекс `{idx_clean}` удален из `{target_db}`.`{table}`"
        return res

    elif cmd == "SHOW_INDEX":
        query = f"SHOW INDEX FROM `{target_db}`.`{table}`;"
        return execute_sql(query, is_select=True, db_name=target_db)

    return {"status": 404, "success": False, "message": f"Команда индексов '{cmd}' не поддерживается"}


# --- ТРИГГЕРЫ ---
@app.post("/triggers")
async def triggers_endpoint(payload: TriggerPayload):
    cmd = payload.command.upper()
    target_db = clean_identifier(payload.database) if payload.database else DB_CONFIG.get("database")
    if not target_db:
        return {"status": 400, "success": False, "message": "Не указана целевая база данных"}

    if cmd == "CREATE_TRIGGER":
        if not payload.trigger_name or not payload.table_name or not payload.statement:
            return {"status": 400, "success": False, "message": "Заполните имя триггера, таблицу и тело триггера"}
        trg_clean = clean_identifier(payload.trigger_name)
        tbl_clean = clean_identifier(payload.table_name)
        timing = (payload.timing or "BEFORE").upper()
        event = (payload.event or "INSERT").upper()
        statement = payload.statement.strip()

        query = f"CREATE TRIGGER `{target_db}`.`{trg_clean}` {timing} {event} ON `{target_db}`.`{tbl_clean}` FOR EACH ROW {statement};"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Триггер `{trg_clean}` успешно создан на таблице `{tbl_clean}`"
        return res

    elif cmd == "DROP_TRIGGER":
        if not payload.trigger_name:
            return {"status": 400, "success": False, "message": "Укажите имя триггера для удаления"}
        trg_clean = clean_identifier(payload.trigger_name)
        query = f"DROP TRIGGER `{target_db}`.`{trg_clean}`;"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Триггер `{trg_clean}` удален из `{target_db}`"
        return res

    elif cmd == "SHOW_TRIGGERS":
        query = f"SHOW TRIGGERS FROM `{target_db}`;"
        return execute_sql(query, is_select=True, db_name=target_db)

    return {"status": 404, "success": False, "message": f"Команда триггеров '{cmd}' не поддерживается"}


# --- ХРАНИМЫЕ ПРОЦЕДУРЫ ---
@app.post("/procedures")
async def procedures_endpoint(payload: ProcedurePayload):
    cmd = payload.command.upper()
    target_db = clean_identifier(payload.database) if payload.database else DB_CONFIG.get("database")
    if not target_db:
        return {"status": 400, "success": False, "message": "Не указана целевая база данных"}

    if cmd == "CREATE_PROCEDURE":
        if not payload.procedure_name or not payload.body:
            return {"status": 400, "success": False, "message": "Укажите имя и тело процедуры"}
        proc_clean = clean_identifier(payload.procedure_name)
        params = payload.parameters.strip() if payload.parameters else ""
        body = payload.body.strip()
        query = f"CREATE PROCEDURE `{target_db}`.`{proc_clean}`({params})\n{body};"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Процедура `{proc_clean}` успешно создана в `{target_db}`"
        return res

    elif cmd == "CALL_PROCEDURE":
        if not payload.procedure_name:
            return {"status": 400, "success": False, "message": "Укажите имя процедуры"}
        proc_clean = clean_identifier(payload.procedure_name)
        args = payload.call_args.strip() if payload.call_args else ""
        query = f"CALL `{target_db}`.`{proc_clean}`({args});"
        res = execute_sql(query, is_select=True, db_name=target_db)
        if res["success"] and not res["rows"]:
            res["message"] = f"Процедура `{target_db}`.`{proc_clean}` успешно выполнена"
        return res

    elif cmd == "DROP_PROCEDURE":
        if not payload.procedure_name:
            return {"status": 400, "success": False, "message": "Укажите имя процедуры для удаления"}
        proc_clean = clean_identifier(payload.procedure_name)
        query = f"DROP PROCEDURE `{target_db}`.`{proc_clean}`;"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Процедура `{proc_clean}` удалена из `{target_db}`"
        return res

    elif cmd == "SHOW_PROCEDURES":
        query = f"SHOW PROCEDURE STATUS WHERE Db = '{target_db}';"
        return execute_sql(query, is_select=True, db_name=target_db)

    return {"status": 404, "success": False, "message": f"Команда процедур '{cmd}' не поддерживается"}


# --- ПРЕДСТАВЛЕНИЯ (VIEWS) ---
@app.post("/views")
async def views_endpoint(payload: ViewPayload):
    cmd = payload.command.upper()
    target_db = clean_identifier(payload.database) if payload.database else DB_CONFIG.get("database")
    if not target_db:
        return {"status": 400, "success": False, "message": "Не указана целевая база данных"}

    if cmd == "CREATE_VIEW":
        if not payload.view_name or not payload.select_query:
            return {"status": 400, "success": False, "message": "Укажите имя представления и SELECT-запрос"}
        view_clean = clean_identifier(payload.view_name)
        query = f"CREATE VIEW `{target_db}`.`{view_clean}` AS {payload.select_query.strip().rstrip(';')};"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Представление `{target_db}`.`{view_clean}` создано"
        return res

    elif cmd == "DROP_VIEW":
        if not payload.view_name:
            return {"status": 400, "success": False, "message": "Укажите имя представления для удаления"}
        view_clean = clean_identifier(payload.view_name)
        query = f"DROP VIEW `{target_db}`.`{view_clean}`;"
        res = execute_sql(query, db_name=target_db)
        if res["success"]:
            res["message"] = f"Представление `{view_clean}` удалено из `{target_db}`"
        return res

    elif cmd == "SHOW_VIEWS":
        query = f"SHOW FULL TABLES FROM `{target_db}` WHERE Table_type = 'VIEW';"
        return execute_sql(query, is_select=True, db_name=target_db)

    return {"status": 404, "success": False, "message": f"Команда VIEW '{cmd}' не поддерживается"}


# --- RAW SQL ---
@app.post("/raw-sql")
async def raw_sql_endpoint(payload: RawSQLPayload):
    query = payload.query.strip()
    if not query:
        return {"status": 400, "success": False, "message": "Запрос пуст"}
    target_db = clean_identifier(payload.database) if payload.database else DB_CONFIG.get("database")
    is_select = query.upper().startswith(("SELECT", "SHOW", "DESCRIBE", "EXPLAIN"))
    return execute_sql(query, is_select=is_select, multi=True, db_name=target_db)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    DEFAULT_HOST = "127.0.0.1"
    DEFAULT_PORT = 3306
    DEFAULT_USER = "root"

    try:
        host_input = input(Fore.GREEN + f"Введите хост БД [{DEFAULT_HOST}]: " + Fore.WHITE).strip()
        db_host = host_input if host_input else DEFAULT_HOST

        port_input = input(Fore.GREEN + f"Введите порт БД [{DEFAULT_PORT}]: " + Fore.WHITE).strip()
        db_port = int(port_input) if port_input else DEFAULT_PORT

        user_input = input(Fore.GREEN + f"Введите пользователя [{DEFAULT_USER}]: " + Fore.WHITE).strip()
        db_user = user_input if user_input else DEFAULT_USER

        db_pass = input(Fore.GREEN + "Введите пароль (или оставьте пустым): " + Fore.WHITE).strip()
        
    except (KeyboardInterrupt, EOFError):
        print(Fore.RED + "\nВыход из программы..." + Fore.RESET)
        sys.exit(0)

    DB_CONFIG["host"] = db_host
    DB_CONFIG["port"] = db_port
    DB_CONFIG["user"] = db_user
    DB_CONFIG["password"] = db_pass

    print(Fore.CYAN + f"\nПроверка подключения к MySQL ({db_host}:{db_port})..." + Fore.RESET)
    try:
        test_conn = get_db(None)
        cur = test_conn.cursor()
        cur.execute("SHOW DATABASES;")
        available_dbs = [row[0] for row in cur.fetchall()]
        cur.close()
        test_conn.close()
        print(Fore.GREEN + f"[OK] Подключение к MySQL успешно установлено! Доступно баз данных: {len(available_dbs)}" + Fore.RESET)
        
    except Exception as e:
        print(Fore.RED + f"[ERROR] Ошибка подключения к базе данных: {e}" + Fore.RESET)
        try:
            input(Fore.YELLOW + "\nНажмите Enter для выхода..." + Fore.RESET)
        except Exception:
            pass
        sys.exit(1)

    print(Fore.GREEN + "\nЗапуск веб-сервера на http://127.0.0.1:8000" + Fore.RESET)
    try:
        webbrowser.open("http://127.0.0.1:8000")
    except Exception:
        pass

    try:
        uvicorn.run(app, host="127.0.0.1", port=8000)
    except KeyboardInterrupt:
        print(Fore.RED + "\nСервер остановлен." + Fore.RESET)
