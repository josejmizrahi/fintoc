"""
Sincroniza clientes de Odoo con CLABEs virtuales en Fintoc.

Ejecutar periódicamente (cron) para:
- Crear CLABEs para clientes nuevos en Odoo que aún no tienen una
- Reportar CLABEs huérfanas (cliente eliminado en Odoo)
"""
import csv

from fintoc_client import FintocManager
from odoo_client import OdooClient

odoo = OdooClient()
fintoc = FintocManager()


def sync():
    print("=== Sincronización Odoo → Fintoc ===\n")

    customers = odoo.get_all_customers()
    existing_clabes = fintoc.list_all_clabes()

    partner_ids_with_clabe = set()
    for acno in existing_clabes:
        pid = acno.metadata.get("odoo_partner_id")
        if pid:
            partner_ids_with_clabe.add(int(pid))

    new_clabes = []
    for customer in customers:
        partner_id = customer["id"]
        name = customer["name"]

        if partner_id in partner_ids_with_clabe:
            continue

        print(f"  [NUEVO] Creando CLABE para {name} (ID: {partner_id})...")
        result = fintoc.create_clabe_for_customer(partner_id, name)
        print(f"    → CLABE: {result['clabe']}")
        new_clabes.append({"partner_id": partner_id, "name": name, "clabe": result["clabe"]})

    if new_clabes:
        with open("clabes_nuevas.csv", "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["partner_id", "name", "clabe"])
            writer.writeheader()
            writer.writerows(new_clabes)
        print(f"\n{len(new_clabes)} CLABEs nuevas creadas. Guardadas en clabes_nuevas.csv")
    else:
        print("\nTodos los clientes ya tienen CLABE asignada.")

    odoo_ids = {c["id"] for c in customers}
    orphans = [
        acno for acno in existing_clabes
        if acno.metadata.get("odoo_partner_id")
        and int(acno.metadata["odoo_partner_id"]) not in odoo_ids
    ]
    if orphans:
        print(f"\n[AVISO] {len(orphans)} CLABEs huérfanas (cliente no existe en Odoo):")
        for acno in orphans:
            print(f"  - CLABE {acno.number} | partner_id={acno.metadata.get('odoo_partner_id')}")


if __name__ == "__main__":
    sync()
