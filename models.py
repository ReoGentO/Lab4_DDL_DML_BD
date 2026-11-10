import re
from typing import Optional

from pydantic import BaseModel, field_validator


class DDLPayload(BaseModel):
    command: str
    table_name: str
    # Для CREATE_TABLE
    columns: Optional[str] = None
    types: Optional[str] = None
    # Для ALTER_TABLE
    alter_action: Optional[str] = None
    column_name: Optional[str] = None
    column_type: Optional[str] = None
    new_column_name: Optional[str] = None
    new_table_name: Optional[str] = None

    @field_validator("table_name")
    def validate_table_name(cls, v: str) -> str:
        clean = v.strip()
        if not re.match(r"^[a-zA-Z_а-яА-ЯёЁ][a-zA-Z0-9_а-яА-ЯёЁ]*$", clean):
            raise ValueError("Недопустимое имя таблицы")
        return clean


class DMLPayload(BaseModel):
    command: str  # SELECT, INSERT, UPDATE, DELETE
    table_name: str
    columns: Optional[str] = "*"
    values: Optional[str] = None
    where: Optional[str] = None
    set_clause: Optional[str] = None
    limit: Optional[int] = 100

    @field_validator("table_name")
    def validate_table_name(cls, v: str) -> str:
        clean = v.strip()
        if not re.match(r"^[a-zA-Z_а-яА-ЯёЁ][a-zA-Z0-9_а-яА-ЯёЁ]*$", clean):
            raise ValueError("Недопустимое имя таблицы")
        return clean


class RawSQLPayload(BaseModel):
    query: str
