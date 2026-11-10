import os
import re
import sys
from typing import Any, Dict, List

import mysql.connector
import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from models import DDLPayload, DMLPayload, RawSQLPayload

if sys.platform == "win32":
    try:
        import colorama
        colorama.init()
    except ImportError:
        pass

DB_CONFIG = {
    "database": "Воейков",
    "host": "mysql-8.4",
    "user": "root",
    "password": "",
    "charset": "utf8mb4",
    "collation": "utf8mb4_unicode_ci",
}


def get_db():
    return mysql.connector.connect(**DB_CONFIG)


def execute_sql(query: str, is_select: bool = False) -> Dict[str, Any]:
    conn = None
    cursor = None
    try:
        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(query)
        rows: List[Dict[str, Any]] = []
        columns: List[str] = []
        affected_rows = cursor.rowcount

        if is_select or cursor.description is not None:
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()

        conn.commit()
        return {
            "status": 200,
            "success": True,
            "query": query,
            "affected_rows": affected_rows,
            "columns": columns,
            "rows": rows,
            "message": "Запрос успешно выполнен",
        }
    except mysql.connector.Error as err:
        return {
            "status": err.errno,
            "success": False,
            "query": query,
            "message": f"Ошибка [{err.errno}]: {err.msg}",
        }
    except Exception as e:
        return {
            "status": 500,
            "success": False,
            "query": query,
            "message": f"Системная ошибка: {str(e)}",
        }
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def get_resource_path(relative_path):
    if hasattr(sys, "_MEIPASS"):
        return str(os.path.join(sys._MEIPASS, relative_path))
    return str(os.path.join(os.path.abspath("."), relative_path))
app = FastAPI(title="Лабораторная 4")
app.mount("/static", StaticFiles(directory=get_resource_path("static")), name="static")
templates = Jinja2Templates(directory=get_resource_path("templates"))


@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse(name="index.html", request={"request": request})


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
                "message": f"Количество колонок ({len(cols)}) не совпадает с количеством типов ({len(types)})",
            }

        col_defs = []
        for col, col_type in zip(cols, types):
            if not re.match(r"^[a-zA-Z_а-яА-ЯёЁ][a-zA-Z0-9_а-яА-ЯёЁ]*$", col):
                return {"status": 400, "success": False, "message": f"Недопустимое имя колонки: {col}"}
            col_defs.append(f"`{col}` {col_type}")

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
            query = f"ALTER TABLE `{table}` ADD COLUMN `{payload.column_name}` {payload.column_type};"

        elif action == "MODIFY":
            if not payload.column_name or not payload.column_type:
                return {"status": 400, "success": False, "message": "Укажите имя столбца и его новый тип"}
            query = f"ALTER TABLE `{table}` MODIFY COLUMN `{payload.column_name}` {payload.column_type};"

        elif action == "DROP_COLUMN":
            if not payload.column_name:
                return {"status": 400, "success": False, "message": "Укажите имя удаляемого столбца"}
            query = f"ALTER TABLE `{table}` DROP COLUMN `{payload.column_name}`;"

        elif action == "RENAME_COLUMN":
            if not payload.column_name or not payload.new_column_name:
                return {"status": 400, "success": False, "message": "Укажите текущее и новое имя столбца"}
            query = f"ALTER TABLE `{table}` RENAME COLUMN `{payload.column_name}` TO `{payload.new_column_name}`;"

        elif action == "RENAME_TABLE":
            if not payload.new_table_name:
                return {"status": 400, "success": False, "message": "Укажите новое имя таблицы"}
            query = f"ALTER TABLE `{table}` RENAME TO `{payload.new_table_name}`;"

        else:
            return {"status": 400, "success": False, "message": f"Неизвестное действие ALTER: {action}"}

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
            return {"status": 400, "success": False, "message": "Укажите значения для вставки"}

        columns_clause = f"({payload.columns.strip()}) " if payload.columns and payload.columns.strip() and payload.columns.strip() != "*" else ""
        query = f"INSERT INTO `{table}` {columns_clause}VALUES ({payload.values.strip()});"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Запись успешно добавлена в `{table}`"
        return res

    elif cmd == "UPDATE":
        if not payload.set_clause or not payload.set_clause.strip():
            return {"status": 400, "success": False, "message": "Укажите выражение SET (например, price = 100)"}

        query = f"UPDATE `{table}` SET {payload.set_clause.strip()}"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        query += ";"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Обновлено строк в `{table}`: {res.get('affected_rows', 0)}"
        return res

    elif cmd == "DELETE":
        query = f"DELETE FROM `{table}`"
        if payload.where and payload.where.strip():
            query += f" WHERE {payload.where.strip()}"
        query += ";"
        res = execute_sql(query)
        if res["success"]:
            res["message"] = f"Удалено строк из `{table}`: {res.get('affected_rows', 0)}"
        return res

    return {"status": 404, "success": False, "message": f"Команда DML '{cmd}' не поддерживается"}


@app.post("/raw-sql")
async def raw_sql_endpoint(payload: RawSQLPayload):
    query = payload.query.strip()
    if not query:
        return {"status": 400, "success": False, "message": "Запрос пуст"}
    is_select = query.upper().startswith(("SELECT", "SHOW", "DESCRIBE", "EXPLAIN"))
    return execute_sql(query, is_select=is_select)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
