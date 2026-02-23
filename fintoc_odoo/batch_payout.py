"""
Lee un CSV con columnas: clabe, amount_mxn, reference_id, comment
Envía todos los pagos SPEI de forma masiva.

CSV ejemplo (pagos_batch.csv):
  clabe,amount_mxn,reference_id,comment
  012345678901234567,15000.00,FAC-2026-0042,Pago proveedor Aceros SA
  646180157047452829,8500.50,FAC-2026-0043,Pago proveedor Textiles MX
"""
import uuid

import pandas as pd

from fintoc_client import FintocManager

fintoc = FintocManager()

df = pd.read_csv("pagos_batch.csv")
print(f"Procesando {len(df)} pagos...")

resultados = []
for _, row in df.iterrows():
    try:
        result = fintoc.send_payout(
            clabe_destino=str(row["clabe"]),
            amount_mxn=float(row["amount_mxn"]),
            comment=str(row.get("comment", "Pago Quimibond")),
            reference_id=str(row["reference_id"]),
            idempotency_key=str(uuid.uuid4()),
        )
        print(f"  [OK] {row['reference_id']} → {result['status']}")
        resultados.append({**row, **result, "error": ""})
    except Exception as e:
        print(f"  [ERROR] {row['reference_id']} → {e}")
        resultados.append({**row, "transfer_id": "", "status": "error", "error": str(e)})

pd.DataFrame(resultados).to_csv("pagos_batch_resultado.csv", index=False)
print("Resultados guardados en pagos_batch_resultado.csv")
