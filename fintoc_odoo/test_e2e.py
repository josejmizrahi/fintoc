"""
Prueba end-to-end en modo test (Fintoc sk_test_XXX):

1. Simula un cobro entrante a una CLABE virtual (necesitas account_number_id de Fintoc).
2. Espera y lista pagos recientes del diario Fintoc en Odoo.
3. Verifica que al menos un pago tenga Complemento de Pago (UUID) y estado SAT.

Nota: El webhook debe haber procesado el cobro (servidor corriendo o simulación
en dashboard Fintoc). Si el webhook no está activo, el pago se simula pero no
se registrará en Odoo hasta que llegue el evento.

Uso:
  python test_e2e.py [--account-number-id acno_XXX] [--amount 100]
"""
import argparse
import time

from fintoc_client import FintocManager
from odoo_client import OdooClient

fintoc = FintocManager()
odoo = OdooClient()


def main():
    parser = argparse.ArgumentParser(description="Test E2E: simular cobro → Odoo → Complemento de Pago")
    parser.add_argument("--account-number-id", default=None, help="ID de CLABE en Fintoc (acno_XXX)")
    parser.add_argument("--amount", type=float, default=100.0, help="Monto a simular en MXN")
    parser.add_argument("--no-simulate", action="store_true", help="Solo verificar pagos en Odoo, no simular")
    args = parser.parse_args()

    if not args.no_simulate:
        account_number_id = args.account_number_id
        if not account_number_id:
            clabes = fintoc.list_all_clabes()
            if not clabes:
                print("No hay CLABEs. Ejecuta setup_clabes.py primero.")
                return
            acno = clabes[0]
            account_number_id = acno.id
            print(f"Usando primera CLABE: {account_number_id} ({getattr(acno, 'number', '')})")
        print(f"Simulando cobro de ${args.amount} MXN...")
        try:
            result = fintoc.simulate_inbound(
                account_number_id=account_number_id,
                amount_mxn=args.amount,
                comment="Prueba E2E",
            )
            print(f"  Simulación: {result}")
        except Exception as e:
            print(f"  Error en simulación (¿modo test?): {e}")
        print("Esperando 15 s para que el webhook procese...")
        time.sleep(15)

    # Pagos Fintoc en Odoo (últimos 3 días)
    payments = odoo.get_payments_fintoc(days=3)
    print(f"\nPagos Fintoc en Odoo (últimos 3 días): {len(payments)}")
    for p in payments[:10]:
        status = odoo.get_payment_cfdi_status(p["id"])
        uuid_ok = "Sí" if (status and status.get("uuid")) else "No"
        sat_ok = (status and status.get("sat_status") == "valid") or False
        print(f"  {p.get('name')} | {p.get('date')} | ${p.get('amount')} | UUID: {uuid_ok} | SAT: {status.get('sat_status') if status else 'N/A'}")
        if status and status.get("uuid") and not sat_ok:
            try:
                odoo.update_sat_status(p["id"], model="account.payment")
                status2 = odoo.get_payment_cfdi_status(p["id"])
                print(f"    → Actualizado SAT: {status2.get('sat_status') if status2 else 'N/A'}")
            except Exception as e:
                print(f"    → update_sat_status: {e}")

    print("\nListo. Revisa Odoo para ver el Complemento de Pago en el pago.")


if __name__ == "__main__":
    main()
