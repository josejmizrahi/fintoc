"""
Ejecutar UNA VEZ para crear una CLABE virtual en Fintoc por cada cliente en Odoo.
Guarda el resultado en clabes_quimibond.csv para referencia.
"""
import csv

from fintoc_client import FintocManager
from odoo_client import OdooClient

odoo = OdooClient()
fintoc = FintocManager()

print("Obteniendo clientes de Odoo...")
customers = odoo.get_all_customers()
print(f"  → {len(customers)} clientes encontrados")

results = []
for customer in customers:
    partner_id = customer["id"]
    name = customer["name"]

    existing = fintoc.get_clabe_by_partner(partner_id)
    if existing:
        print(f"  [SKIP] {name} ya tiene CLABE: {existing}")
        results.append({"partner_id": partner_id, "name": name, "clabe": existing, "status": "existing"})
        continue

    result = fintoc.create_clabe_for_customer(partner_id, name)
    print(f"  [OK] {name} → CLABE: {result['clabe']}")
    results.append({"partner_id": partner_id, "name": name, "clabe": result["clabe"], "status": "created"})

with open("clabes_quimibond.csv", "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["partner_id", "name", "clabe", "status"])
    writer.writeheader()
    writer.writerows(results)

print(f"\nListo. CLABEs guardadas en clabes_quimibond.csv")
