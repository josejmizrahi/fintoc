import os
from dotenv import load_dotenv
from fintoc import Fintoc

load_dotenv()

FINTOC_SECRET_KEY = os.environ["FINTOC_SECRET_KEY"]
FINTOC_WEBHOOK_SECRET = os.environ["FINTOC_WEBHOOK_SECRET"]
FINTOC_ACCOUNT_ID = os.environ["FINTOC_ACCOUNT_ID"]
JWS_PRIVATE_KEY_PATH = os.environ["JWS_PRIVATE_KEY_PATH"]

ODOO_URL = os.environ["ODOO_URL"]
ODOO_DB = os.environ["ODOO_DB"]
ODOO_USER = os.environ["ODOO_USER"]
ODOO_PASSWORD = os.environ["ODOO_PASSWORD"]

fintoc_client = Fintoc(FINTOC_SECRET_KEY, jws_private_key=JWS_PRIVATE_KEY_PATH)
