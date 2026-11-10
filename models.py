import re
from typing import Optional
from pydantic import BaseModel, field_validator


def clean_identifier(v: str) -> str:
    clean = v.strip()
    if not re.match(r"^[a-zA-Z_а-яА-ЯёЁ][a-zA-Z0-9_а-яА-ЯёЁ]*$", clean):
        raise ValueError(f"Недопустимое имя: '{clean}'")
    return clean


class DDLPayload(BaseModel):
    command: str
    table_name: str
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
    index_name: Optional[str] = None
    columns: Optional[str] = None
    unique: bool = False

    @field_validator("table_name")
    def validate_table(cls, v: str) -> str:
        return clean_identifier(v)


class TriggerPayload(BaseModel):
    command: str  # CREATE_TRIGGER, DROP_TRIGGER, SHOW_TRIGGERS
    trigger_name: Optional[str] = None
    table_name: Optional[str] = None
    timing: Optional[str] = "BEFORE"  # BEFORE, AFTER
    event: Optional[str] = "INSERT"   # INSERT, UPDATE, DELETE
    statement: Optional[str] = None


class ProcedurePayload(BaseModel):
    command: str  # CREATE_PROCEDURE, CALL_PROCEDURE, DROP_PROCEDURE, SHOW_PROCEDURES
    procedure_name: Optional[str] = None
    parameters: Optional[str] = ""
    body: Optional[str] = None
    call_args: Optional[str] = ""


class ViewPayload(BaseModel):
    command: str  # CREATE_VIEW, DROP_VIEW, SHOW_VIEWS
    view_name: Optional[str] = None
    select_query: Optional[str] = None


class RawSQLPayload(BaseModel):
    query: str
