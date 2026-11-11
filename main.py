import os
import re
import sys
import time
from typing import Any, Dict, List

import mysql.connector
import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from colorama import just_fix_windows_console, Fore

from models import (
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
    "host": None,
    "user": None,
    "password": None,
    "charset": "utf8mb4",
    "collation": "utf8mb4_unicode_ci",
}


def get_db():
    return mysql.connector.connect(**DB_CONFIG)


def execute_sql(query: str, is_select: bool = False, multi: bool = False) -> Dict[str, Any]:
    start_time = time.perf_counter()
    conn = None
    cursor = None
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        rows: List[Dict[str, Any]] = []
        columns: List[str] = []
        affected_rows = 0

        if multi:
            for result in cursor.execute(query, multi=True):
                if result.with_rows:
                    rows = result.fetchall()
                    if result.description:
                        columns = [desc[0] for desc in result.description]
                affected_rows += result.rowcount
        else:
            cursor.execute(query)
            affected_rows = cursor.rowcount
            if is_select or cursor.description is not None:
                columns = [desc[0] for desc in cursor.description]
                rows = cursor.fetchall()

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


app = FastAPI(title="Lab5")
app.mount("/static", StaticFiles(directory=get_resource_path("static")), name="static")
templates = Jinja2Templates(directory=get_resource_path("templates"))


@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse(name="index.html", request={"request": request})


@app.get("/tables")
async def list_tables():
    res = execute_sql("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE';", is_select=True)
    if not res["success"]:
        return res
    tables = [row[res["columns"][0]] for row in res["rows"]] if res["rows"] else []
    return {"status": 200, "success": True, "tables": tables}


@app.get("/tables/{table_name}/schema")
async def table_schema(table_name: str):
    clean = clean_identifier(table_name)
    return execute_sql(f"DESCRIBE `{clean}`;", is_select=True)


# --- DDL ---
@app.post("/ddl")
async def ddl_endpoint(payload: DDLPayload):
    cmd = payload.command.upper()
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

        query = f"CREATE TABLE `{table}` (\n  " + ",\n  ".join(col_defs) + "\n);"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Таблица `{table}` успешно создана"
        return res

    elif cmd == "ALTER_TABLE":
        action = (payload.alter_action or "").upper()
        if action == "ADD":
            if not payload.column_name or not payload.column_type:
                return {"status": 400, "success": False, "message": "Укажите имя и тип нового столбца"}
            col_clean = clean_identifier(payload.column_name)
            query = f"ALTER TABLE `{table}` ADD COLUMN `{col_clean}` {payload.column_type};"
        elif action == "MODIFY":
            if not payload.column_name or not payload.column_type:
                return {"status": 400, "success": False, "message": "Укажите имя и новый тип столбца"}
            col_clean = clean_identifier(payload.column_name)
            query = f"ALTER TABLE `{table}` MODIFY COLUMN `{col_clean}` {payload.column_type};"
        elif action == "DROP_COLUMN":
            if not payload.column_name:
                return {"status": 400, "success": False, "message": "Укажите имя удаляемого столбца"}
            col_clean = clean_identifier(payload.column_name)
            query = f"ALTER TABLE `{table}` DROP COLUMN `{col_clean}`;"
        elif action == "RENAME_COLUMN":
            if not payload.column_name or not payload.new_column_name:
                return {"status": 400, "success": False, "message": "Укажите текущее и новое имя столбца"}
            old_c = clean_identifier(payload.column_name)
            new_c = clean_identifier(payload.new_column_name)
            query = f"ALTER TABLE `{table}` RENAME COLUMN `{old_c}` TO `{new_c}`;"
        elif action == "RENAME_TABLE":
            if not payload.new_table_name:
                return {"status": 400, "success": False, "message": "Укажите новое имя таблицы"}
            new_t = clean_identifier(payload.new_table_name)
            query = f"ALTER TABLE `{table}` RENAME TO `{new_t}`;"
        else:
            return {"status": 400, "success": False, "message": f"Неизвестное действие: {action}"}

        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Таблица `{table}` успешно изменена ({action})"
        return res

    elif cmd == "DROP_TABLE":
        query = f"DROP TABLE `{table}`;"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Таблица `{table}` удалена"
        return res

    elif cmd == "TRUNCATE_TABLE":
        query = f"TRUNCATE TABLE `{table}`;"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Таблица `{table}` очищена"
        return res

    return {"status": 404, "success": False, "message": f"Команда DDL '{cmd}' не поддерживается"}


# --- DML ---
@app.post("/dml")
async def dml_endpoint(payload: DMLPayload):
    cmd = payload.command.upper()
    table = payload.table_name

    if cmd == "SELECT":
        columns = payload.columns.strip() if payload.columns else "*"
        query = f"SELECT {columns} FROM `{table}`"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        if payload.limit and payload.limit > 0:
            query += f" LIMIT {payload.limit}"
        query += ";"
        return execute_sql(query, is_select=True)

    elif cmd == "INSERT":
        if not payload.values or not payload.values.strip():
            return {"status": 400, "success": False, "message": "Укажите значения (VALUES)"}

        cols_clause = f"({payload.columns.strip()}) " if payload.columns and payload.columns.strip() != "*" else ""
        query = f"INSERT INTO `{table}` {cols_clause}VALUES ({payload.values.strip()});"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Запись добавлена в `{table}`"
        return res

    elif cmd == "UPDATE":
        if not payload.set_clause or not payload.set_clause.strip():
            return {"status": 400, "success": False, "message": "Укажите выражение SET"}

        query = f"UPDATE `{table}` SET {payload.set_clause.strip()}"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        query += ";"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Обновлено строк: {res.get('affected_rows', 0)}"
        return res

    elif cmd == "DELETE":
        query = f"DELETE FROM `{table}`"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        query += ";"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Удалено строк: {res.get('affected_rows', 0)}"
        return res

    return {"status": 404, "success": False, "message": f"Команда DML '{cmd}' не поддерживается"}


# --- ИНДЕКСЫ ---
@app.post("/indexes")
async def indexes_endpoint(payload: IndexPayload):
    cmd = payload.command.upper()
    table = payload.table_name

    if cmd == "CREATE_INDEX":
        if not payload.index_name or not payload.columns:
            return {"status": 400, "success": False, "message": "Укажите имя индекса и столбцы"}
        idx_clean = clean_identifier(payload.index_name)
        cols = [f"`{clean_identifier(c)}`" for c in payload.columns.split(",") if c.strip()]
        unique_clause = "UNIQUE " if payload.unique else ""
        query = f"CREATE {unique_clause}INDEX `{idx_clean}` ON `{table}` ({', '.join(cols)});"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Индекс `{idx_clean}` успешно создан на `{table}`"
        return res

    elif cmd == "DROP_INDEX":
        if not payload.index_name:
            return {"status": 400, "success": False, "message": "Укажите имя удаляемого индекса"}
        idx_clean = clean_identifier(payload.index_name)
        query = f"DROP INDEX `{idx_clean}` ON `{table}`;"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Индекс `{idx_clean}` удален из `{table}`"
        return res

    elif cmd == "SHOW_INDEX":
        query = f"SHOW INDEX FROM `{table}`;"
        return execute_sql(query, is_select=True)

    return {"status": 404, "success": False, "message": f"Команда индексов '{cmd}' не поддерживается"}


# --- ТРИГГЕРЫ ---
@app.post("/triggers")
async def triggers_endpoint(payload: TriggerPayload):
    cmd = payload.command.upper()

    if cmd == "CREATE_TRIGGER":
        if not payload.trigger_name or not payload.table_name or not payload.statement:
            return {"status": 400, "success": False, "message": "Заполните имя триггера, таблицу и тело триггера"}
        trg_clean = clean_identifier(payload.trigger_name)
        tbl_clean = clean_identifier(payload.table_name)
        timing = (payload.timing or "BEFORE").upper()
        event = (payload.event or "INSERT").upper()
        statement = payload.statement.strip()

        query = f"CREATE TRIGGER `{trg_clean}` {timing} {event} ON `{tbl_clean}` FOR EACH ROW {statement};"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Триггер `{trg_clean}` успешно создан на таблице `{tbl_clean}`"
        return res

    elif cmd == "DROP_TRIGGER":
        if not payload.trigger_name:
            return {"status": 400, "success": False, "message": "Укажите имя триггера для удаления"}
        trg_clean = clean_identifier(payload.trigger_name)
        query = f"DROP TRIGGER `{trg_clean}`;"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Триггер `{trg_clean}` удален"
        return res

    elif cmd == "SHOW_TRIGGERS":
        query = f"SHOW TRIGGERS FROM `{DB_CONFIG['database']}`;"
        return execute_sql(query, is_select=True)

    return {"status": 404, "success": False, "message": f"Команда триггеров '{cmd}' не поддерживается"}


# --- ХРАНИМЫЕ ПРОЦЕДУРЫ ---
@app.post("/procedures")
async def procedures_endpoint(payload: ProcedurePayload):
    cmd = payload.command.upper()

    if cmd == "CREATE_PROCEDURE":
        if not payload.procedure_name or not payload.body:
            return {"status": 400, "success": False, "message": "Укажите имя и тело процедуры"}
        proc_clean = clean_identifier(payload.procedure_name)
        params = payload.parameters.strip() if payload.parameters else ""
        body = payload.body.strip()
        query = f"CREATE PROCEDURE `{proc_clean}`({params})\n{body};"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Процедура `{proc_clean}` успешно создана"
        return res

    elif cmd == "CALL_PROCEDURE":
        if not payload.procedure_name:
            return {"status": 400, "success": False, "message": "Укажите имя процедуры"}
        proc_clean = clean_identifier(payload.procedure_name)
        args = payload.call_args.strip() if payload.call_args else ""
        query = f"CALL `{proc_clean}`({args});"
        res = execute_sql(query, is_select=True)
        if res["success"] and not res["rows"]:
            res["message"] = f"Процедура `{proc_clean}` выполнена"
        return res

    elif cmd == "DROP_PROCEDURE":
        if not payload.procedure_name:
            return {"status": 400, "success": False, "message": "Укажите имя процедуры для удаления"}
        proc_clean = clean_identifier(payload.procedure_name)
        query = f"DROP PROCEDURE `{proc_clean}`;"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Процедура `{proc_clean}` удалена"
        return res

    elif cmd == "SHOW_PROCEDURES":
        query = f"SHOW PROCEDURE STATUS WHERE Db = '{DB_CONFIG['database']}';"
        return execute_sql(query, is_select=True)

    return {"status": 404, "success": False, "message": f"Команда процедур '{cmd}' не поддерживается"}


# --- ПРЕДСТАВЛЕНИЯ (VIEWS) ---
@app.post("/views")
async def views_endpoint(payload: ViewPayload):
    cmd = payload.command.upper()

    if cmd == "CREATE_VIEW":
        if not payload.view_name or not payload.select_query:
            return {"status": 400, "success": False, "message": "Укажите имя представления и SELECT-запрос"}
        view_clean = clean_identifier(payload.view_name)
        query = f"CREATE VIEW `{view_clean}` AS {payload.select_query.strip().rstrip(';')};"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Представление `{view_clean}` создано"
        return res

    elif cmd == "DROP_VIEW":
        if not payload.view_name:
            return {"status": 400, "success": False, "message": "Укажите имя представления для удаления"}
        view_clean = clean_identifier(payload.view_name)
        query = f"DROP VIEW `{view_clean}`;"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Представление `{view_clean}` удалено"
        return res

    elif cmd == "SHOW_VIEWS":
        query = "SHOW FULL TABLES WHERE Table_type = 'VIEW';"
        return execute_sql(query, is_select=True)

    return {"status": 404, "success": False, "message": f"Команда VIEW '{cmd}' не поддерживается"}


# --- RAW SQL ---
@app.post("/raw-sql")
async def raw_sql_endpoint(payload: RawSQLPayload):
    query = payload.query.strip()
    if not query:
        return {"status": 400, "success": False, "message": "Запрос пуст"}
    is_select = query.upper().startswith(("SELECT", "SHOW", "DESCRIBE", "EXPLAIN"))
    return execute_sql(query, is_select=is_select, multi=True)


if __name__ == "__main__":
    db_host, db_user, db_pass, db_name = None, None, None, None
    try:
        db_host = str(input(Fore.GREEN + "Введите название хоста или его айпи:" + Fore.WHITE + " "))
        db_user = str(input(Fore.GREEN + "Введите имя пользователя:" + Fore.WHITE + " "))
        db_pass = str(input(Fore.GREEN + "Введите пароль или оставьте пустым:" + Fore.WHITE + " "))
        db_name = str(input(Fore.GREEN + "Введите имя базы данных:" + Fore.WHITE + " "))
    except KeyboardInterrupt:
        print(Fore.RED + "\nПока :(" + Fore.RESET)
        time.sleep(1)
    if db_host and db_user and db_pass and db_name:
        DB_CONFIG['host'] = db_host
        DB_CONFIG['user'] = db_user
        DB_CONFIG['password'] = db_pass
        DB_CONFIG['database'] = db_name
        uvicorn.run(app, host="127.0.0.1", port=8000)
