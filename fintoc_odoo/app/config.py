"""
Configuración centralizada para toda la plataforma.
Carga variables de entorno y provee clientes inicializados.
"""

import os
from pathlib import Path
from functools import lru_cache

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings

load_dotenv()


class Settings(BaseSettings):
    # ── Fintoc ──
    fintoc_secret_key: str = Field(default="", alias="FINTOC_SECRET_KEY")
    fintoc_public_key: str = Field(default="", alias="FINTOC_PUBLIC_KEY")
    fintoc_webhook_secret: str = Field(default="", alias="FINTOC_WEBHOOK_SECRET")
    fintoc_account_id: str = Field(default="", alias="FINTOC_ACCOUNT_ID")
    jws_private_key_path: str = Field(default="", alias="JWS_PRIVATE_KEY_PATH")

    # ── Odoo ──
    odoo_url: str = Field(default="", alias="ODOO_URL")
    odoo_database: str = Field(default="", alias="ODOO_DATABASE")
    odoo_username: str = Field(default="", alias="ODOO_USERNAME")
    odoo_password: str = Field(default="", alias="ODOO_PASSWORD")

    # ── App ──
    app_name: str = Field(default="Payana-Fintoc", alias="APP_NAME")
    app_port: int = Field(default=8001, alias="APP_PORT")
    webhook_path: str = Field(default="/fintoc/webhook", alias="WEBHOOK_PATH")
    base_url: str = Field(default="http://localhost:8001", alias="BASE_URL")
    secret_key: str = Field(default="change-me-in-production", alias="SECRET_KEY")
    debug: bool = Field(default=False, alias="DEBUG")

    # ── Database ──
    database_url: str = Field(
        default="sqlite:///./payana_fintoc.db", alias="DATABASE_URL"
    )

    # ── SAT ──
    sat_wsdl_url: str = Field(
        default="https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?WSDL",
        alias="SAT_WSDL_URL",
    )

    # ── Notifications ──
    smtp_host: str = Field(default="", alias="SMTP_HOST")
    smtp_port: int = Field(default=587, alias="SMTP_PORT")
    smtp_user: str = Field(default="", alias="SMTP_USER")
    smtp_password: str = Field(default="", alias="SMTP_PASSWORD")
    notification_email_from: str = Field(default="", alias="NOTIFICATION_EMAIL_FROM")
    slack_webhook_url: str = Field(default="", alias="SLACK_WEBHOOK_URL")

    # ── Multi-empresa ──
    default_company_id: int = Field(default=1, alias="DEFAULT_COMPANY_ID")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        populate_by_name = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()
