"""
Servicio de autenticación JWT.
Maneja registro, login, hashing de contraseñas y generación/validación de tokens.

Uses stdlib hmac/hashlib for JWT (HS256) to avoid cryptography C extension issues.
Uses hashlib.pbkdf2 for password hashing (no external deps).
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session_factory

# ── Password hashing (PBKDF2-SHA256, stdlib) ──

PBKDF2_ITERATIONS = 260_000  # OWASP recommendation


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    salt_b64 = base64.b64encode(salt).decode()
    dk_b64 = base64.b64encode(dk).decode()
    return f"pbkdf2:sha256:{PBKDF2_ITERATIONS}${salt_b64}${dk_b64}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        header, salt_b64, dk_b64 = hashed_password.split("$")
        _, algo, iterations_str = header.split(":")
        iterations = int(iterations_str)
        salt = base64.b64decode(salt_b64)
        expected_dk = base64.b64decode(dk_b64)
        dk = hashlib.pbkdf2_hmac(algo, plain_password.encode(), salt, iterations)
        return hmac.compare_digest(dk, expected_dk)
    except Exception:
        return False


# ── JWT Tokens (HS256, stdlib) ──

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_access_token(
    data: dict, expires_delta: Optional[timedelta] = None
) -> str:
    settings = get_settings()
    header = {"alg": "HS256", "typ": "JWT"}
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload["exp"] = int(expire.timestamp())
    payload["iat"] = int(datetime.now(timezone.utc).timestamp())

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(
        settings.secret_key.encode(), signing_input.encode(), hashlib.sha256
    ).digest()
    sig_b64 = _b64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_access_token(token: str) -> Optional[dict]:
    settings = get_settings()
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None

        header_b64, payload_b64, sig_b64 = parts

        # Verify signature
        signing_input = f"{header_b64}.{payload_b64}"
        expected_sig = hmac.new(
            settings.secret_key.encode(), signing_input.encode(), hashlib.sha256
        ).digest()
        actual_sig = _b64url_decode(sig_b64)

        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

        # Decode payload
        payload = json.loads(_b64url_decode(payload_b64))

        # Check expiration
        exp = payload.get("exp")
        if exp and datetime.now(timezone.utc).timestamp() > exp:
            return None

        return payload
    except Exception:
        return None


# ── User operations ──


def register_user(
    db: Session,
    email: str,
    password: str,
    name: str,
    company_name: str,
    rfc: str,
    role: str = "admin",
):
    """Register a new user and their company (tenant)."""
    from app.database import User, Company

    # Check if email already exists
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise ValueError("Ya existe un usuario con este correo electrónico")

    # Find or create company
    company = db.query(Company).filter(Company.rfc == rfc).first()
    if not company:
        company = Company(name=company_name, rfc=rfc)
        db.add(company)
        db.flush()

    # Create user
    user = User(
        email=email,
        password_hash=hash_password(password),
        name=name,
        role=role,
        company_id=company.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return user, company


def authenticate_user(db: Session, email: str, password: str):
    """Authenticate user by email and password."""
    from app.database import User

    user = db.query(User).filter(User.email == email).first()
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    if not user.is_active:
        return None
    return user


def get_user_by_id(db: Session, user_id: int):
    """Get user by ID."""
    from app.database import User

    return db.query(User).filter(User.id == user_id).first()
