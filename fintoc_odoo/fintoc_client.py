"""
Operaciones Fintoc para Quimibond:
- Crear/listar CLABEs virtuales por cliente
- Recibir transferencias (inbound)
- Enviar transferencias (outbound)
- Verificar CLABEs de proveedores
"""
from config import fintoc_client, FINTOC_ACCOUNT_ID


class FintocManager:
    def __init__(self):
        self.client = fintoc_client
        self.account_id = FINTOC_ACCOUNT_ID

    # ── CLABEs virtuales (una por cliente) ────────────────────

    def create_clabe_for_customer(self, odoo_partner_id: int, partner_name: str) -> dict:
        """
        Crea una CLABE virtual única para un cliente de Quimibond.
        Guarda el odoo_partner_id en metadata para conciliación automática.
        """
        acno = self.client.v2.account_numbers.create(
            account_id=self.account_id,
            metadata={
                "odoo_partner_id": str(odoo_partner_id),
                "partner_name": partner_name,
            },
        )
        return {
            "clabe": acno.number,
            "account_number_id": acno.id,
            "odoo_partner_id": odoo_partner_id,
            "partner_name": partner_name,
        }

    def list_all_clabes(self) -> list:
        """Lista todas las CLABEs virtuales creadas."""
        return list(self.client.v2.account_numbers.list(account_id=self.account_id))

    def get_clabe_by_partner(self, odoo_partner_id: int) -> str | None:
        """Busca la CLABE de un cliente por su ID de Odoo."""
        for acno in self.list_all_clabes():
            if acno.metadata.get("odoo_partner_id") == str(odoo_partner_id):
                return acno.number
        return None

    # ── Transferencias salientes (pagar proveedores) ───────────

    def send_payout(
        self,
        clabe_destino: str,
        amount_mxn: float,
        comment: str,
        reference_id: str,
        idempotency_key: str,
    ) -> dict:
        """
        Envía pago SPEI a un proveedor.
        amount_mxn: en pesos (ej: 5900.50) — se convierte a centavos internamente.
        """
        amount_centavos = int(round(amount_mxn * 100))
        transfer = self.client.v2.transfers.create(
            idempotency_key=idempotency_key,
            amount=amount_centavos,
            currency="MXN",
            account_id=self.account_id,
            comment=comment,
            reference_id=reference_id,
            counterparty={"account_number": clabe_destino},
            metadata={"reference_id": reference_id},
        )
        return {
            "transfer_id": transfer.id,
            "status": transfer.status,
            "tracking_key": transfer.tracking_key,
            "receipt_url": transfer.receipt_url,
        }

    # ── Verificar CLABE antes de pagar ────────────────────────

    def verify_clabe(self, clabe: str) -> dict:
        """
        Envía $0.01 MXN para verificar titular de la CLABE.
        Resultado llega vía webhook account_verification.succeeded.
        """
        verification = self.client.v2.account_verifications.create(
            account_number=clabe,
        )
        return {
            "verification_id": verification.id,
            "status": verification.status,
        }

    # ── Simular pago entrante (solo test mode) ─────────────────

    def simulate_inbound(
        self,
        account_number_id: str,
        amount_mxn: float,
        comment: str = "Pago simulado",
    ) -> dict:
        """Solo para pruebas. Simula un SPEI entrante a una CLABE virtual."""
        result = self.client.v2.simulate.receive_transfer(
            account_number_id=account_number_id,
            amount=int(round(amount_mxn * 100)),
            currency="MXN",
            comment=comment,
        )
        return {"transfer_id": result.id, "status": result.status}
