"""
API de autenticación: registro, login, perfil.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["Autenticación"])


# ── Schemas ──


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=5)
    password: str = Field(..., min_length=6)
    name: str = Field(..., min_length=1)
    company_name: str = Field(..., min_length=1)
    rfc: str = Field(..., min_length=12, max_length=13)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict
    tenant: dict


class UserProfile(BaseModel):
    id: int
    email: str
    name: str
    role: str
    company_id: int
    company_name: str
    company_rfc: str


# ── Endpoints ──


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    """Registrar nuevo usuario y empresa."""
    from app.services.auth_service import register_user, create_access_token

    try:
        user, company = register_user(
            db=db,
            email=data.email,
            password=data.password,
            name=data.name,
            company_name=data.company_name,
            rfc=data.rfc.upper(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    token = create_access_token(
        data={"sub": str(user.id), "company_id": str(company.id), "role": user.role}
    )

    return TokenResponse(
        access_token=token,
        user={
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        },
        tenant={
            "id": str(company.id),
            "name": company.name,
            "rfc": company.rfc,
        },
    )


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """Iniciar sesión con email y contraseña."""
    from app.services.auth_service import authenticate_user, create_access_token
    from app.database import Company

    user = authenticate_user(db, data.email, data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    company = db.query(Company).filter(Company.id == user.company_id).first()

    token = create_access_token(
        data={"sub": str(user.id), "company_id": str(company.id) if company else "", "role": user.role}
    )

    return TokenResponse(
        access_token=token,
        user={
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        },
        tenant={
            "id": str(company.id) if company else "",
            "name": company.name if company else "",
            "rfc": company.rfc if company else "",
        },
    )


@router.get("/me", response_model=UserProfile)
def get_me(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Obtener perfil del usuario autenticado."""
    from app.database import Company

    company = db.query(Company).filter(Company.id == current_user.company_id).first()

    return UserProfile(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        role=current_user.role,
        company_id=current_user.company_id,
        company_name=company.name if company else "",
        company_rfc=company.rfc if company else "",
    )
