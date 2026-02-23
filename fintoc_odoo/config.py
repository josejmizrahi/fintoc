import os
from dotenv import load_dotenv
from fintoc import Fintoc

load_dotenv()

FINTOC_SECRET_KEY = os.environ["FINTOC_SECRET_KEY"]
FINTOC_PUBLIC_KEY = os.environ["FINTOC_PUBLIC_KEY"]
FINTOC_WEBHOOK_SECRET = os.environ.get("FINTOC_WEBHOOK_SECRET", "")
FINTOC_ACCOUNT_ID = os.environ.get("FINTOC_ACCOUNT_ID", "")
JWS_PRIVATE_KEY_PATH = os.environ.get("JWS_PRIVATE_KEY_PATH", "")

ODOO_URL = os.environ["ODOO_URL"]
ODOO_DB = os.environ["ODOO_DATABASE"]
ODOO_USER = os.environ["ODOO_USERNAME"]
ODOO_PASSWORD = os.environ["ODOO_PASSWORD"]

if JWS_PRIVATE_KEY_PATH and os.path.exists(JWS_PRIVATE_KEY_PATH):
    fintoc_client = Fintoc(FINTOC_SECRET_KEY, jws_private_key=JWS_PRIVATE_KEY_PATH)
else:
    fintoc_client = Fintoc(FINTOC_SECRET_KEY)
