import re
from typing import Optional
from pydantic import BaseModel, field_validator


def clean_identifier(v: str) -> str:
    clean = v.strip().strip("`")
    if not re.match(r"^[a-zA-Z0-9_а-яА-ЯёЁ\-]+$", clean):
        raise ValueError(f"Недопустимое имя: '{clean}'")
    return clean


class CreateDatabasePayload(BaseModel):
    database_name: str
    charset: Optional[str] = "utf8mb4"
    collation: Optional[str] = "utf8mb4_unicode_ci"

    @field_validator("database_name")
    def validate_db_name(cls, v: str) -> str:
        return clean_identifier(v)


class SelectDatabasePayload(BaseModel):
    database: str

    @field_validator("database")
    def validate_db(cls, v: str) -> str:
        return clean_identifier(v)


class DDLPayload(BaseModel):
    command: str
    table_name: str
    database: Optional[str] = None
    columns: Optional[str] = None
    types: Optional[str] = None
    alter_action: Optional[str] = None
    column_name: Optional[str] = None
    column_type: Optional[str] = None
    new_column_name: Optional[str] = None
    new_table_name: Optional[str] = None

    @field_validator("table_name")
    def validate_table(cls, v: str) -> str:
        return clean_identifier(v)


class DMLPayload(BaseModel):
    command: str  # SELECT, INSERT, UPDATE, DELETE
    table_name: str
    database: Optional[str] = None
    columns: Optional[str] = "*"
    values: Optional[str] = None
    where: Optional[str] = None
    set_clause: Optional[str] = None
    limit: Optional[int] = 100

    @field_validator("table_name")
    def validate_table(cls, v: str) -> str:
        return clean_identifier(v)


class IndexPayload(BaseModel):
    command: str  # CREATE_INDEX, DROP_INDEX, SHOW_INDEX
    table_name: str
    database: Optional[str] = None
    index_name: Optional[str] = None
    columns: Optional[str] = None
    unique: bool = False

    @field_validator("table_name")
    def validate_table(cls, v: str) -> str:
        return clean_identifier(v)


class TriggerPayload(BaseModel):
    command: str  # CREATE_TRIGGER, DROP_TRIGGER, SHOW_TRIGGERS
    database: Optional[str] = None
    trigger_name: Optional[str] = None
    table_name: Optional[str] = None
    timing: Optional[str] = "BEFORE"  # BEFORE, AFTER
    event: Optional[str] = "INSERT"   # INSERT, UPDATE, DELETE
    statement: Optional[str] = None


class ProcedurePayload(BaseModel):
    command: str  # CREATE_PROCEDURE, CALL_PROCEDURE, DROP_PROCEDURE, SHOW_PROCEDURES
    database: Optional[str] = None
    procedure_name: Optional[str] = None
    parameters: Optional[str] = ""
    body: Optional[str] = None
    call_args: Optional[str] = ""


class ViewPayload(BaseModel):
    command: str  # CREATE_VIEW, DROP_VIEW, SHOW_VIEWS
    database: Optional[str] = None
    view_name: Optional[str] = None
    select_query: Optional[str] = None


class RawSQLPayload(BaseModel):
    query: str
    database: Optional[str] = None
