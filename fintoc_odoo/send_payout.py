"""
Uso: python send_payout.py --clabe 012345678901234567 --amount 50000 --ref FAC-2026-0123
"""
import argparse
import uuid

from fintoc_client import FintocManager

parser = argparse.ArgumentParser(description="Pago SPEI a proveedor vía Fintoc")
parser.add_argument("--clabe", required=True, help="CLABE del proveedor")
parser.add_argument("--amount", type=float, required=True, help="Monto en pesos MXN")
parser.add_argument("--ref", required=True, help="Referencia (número de factura)")
parser.add_argument("--comment", default="Pago Quimibond", help="Comentario SPEI")
args = parser.parse_args()

fintoc = FintocManager()

print(f"Enviando ${args.amount:.2f} MXN a {args.clabe} | Ref: {args.ref}")
result = fintoc.send_payout(
    clabe_destino=args.clabe,
    amount_mxn=args.amount,
    comment=args.comment,
    reference_id=args.ref,
    idempotency_key=str(uuid.uuid4()),
)
print(f"Resultado: {result}")
