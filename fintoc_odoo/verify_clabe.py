"""
Uso: python verify_clabe.py --clabe 012345678901234567

Verifica el titular de una CLABE enviando $0.01 MXN.
El resultado completo llega vía webhook (account_verification.succeeded).
"""
import argparse

from fintoc_client import FintocManager

parser = argparse.ArgumentParser(description="Verificar CLABE de proveedor vía Fintoc")
parser.add_argument("--clabe", required=True, help="CLABE a verificar (18 dígitos)")
args = parser.parse_args()

fintoc = FintocManager()

print(f"Verificando CLABE {args.clabe}...")
result = fintoc.verify_clabe(args.clabe)
print(f"Resultado: {result}")
print("El resultado completo llegará vía webhook (account_verification.succeeded).")
