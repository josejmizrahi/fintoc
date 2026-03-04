"""
API de Notificaciones.
"""

from fastapi import APIRouter, Query
from typing import Optional

router = APIRouter(prefix="/notifications", tags=["Notificaciones"])


def _get_service():
    from app.services.notification_service import NotificationService
    return NotificationService()


@router.get("/")
def list_notifications(
    company_id: Optional[int] = None,
    unread_only: bool = False,
    limit: int = Query(default=50, le=200),
):
    """Lista notificaciones."""
    return _get_service().get_notifications(company_id=company_id, unread_only=unread_only, limit=limit)


@router.get("/unread-count")
def unread_count(company_id: Optional[int] = None):
    """Cantidad de notificaciones no leídas."""
    return {"unread": _get_service().get_unread_count(company_id=company_id)}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int):
    """Marca una notificación como leída."""
    return _get_service().mark_as_read(notification_id)


@router.post("/mark-all-read")
def mark_all_read(company_id: Optional[int] = None):
    """Marca todas como leídas."""
    return _get_service().mark_all_read(company_id=company_id)
