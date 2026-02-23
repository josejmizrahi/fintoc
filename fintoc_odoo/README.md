# Fintoc ↔ Odoo — Quimibond

Integración para cobros y pagos SPEI automáticos entre Fintoc y Odoo 19.

## Instalación

### 1. Generar llaves JWS (una sola vez)

```bash
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
```

Subir `public_key.pem` en **app.fintoc.com → Settings → JWS Keys**.

### 2. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 3. Configurar variables de entorno

Copiar `.env` y llenar con datos reales de:
- **app.fintoc.com**: API Keys + Webhook Secret + Account ID
- **Odoo**: URL + DB + usuario + contraseña

### 4. Alta inicial de CLABEs (ejecutar UNA VEZ)

```bash
python setup_clabes.py
```

Crea una CLABE virtual por cada cliente en Odoo y las guarda en `clabes_quimibond.csv`.

**Dar esta CLABE a cada cliente para que la use cuando pague por SPEI.**

### 5. Iniciar servidor de webhooks

```bash
python webhook_server.py
```

El servidor escucha en el puerto 8001. Debe estar accesible en HTTPS desde internet.

Registrar la URL en **app.fintoc.com → Webhooks → New Endpoint**:
- **URL:** `https://tu-servidor.quimibond.com/fintoc/webhook`
- **Eventos:** `transfer.inbound.succeeded`, `transfer.outbound.succeeded`, `transfer.outbound.rejected`, `account_verification.succeeded`

### 6. Pagar proveedor (pago individual)

```bash
python send_payout.py --clabe 012345678901234567 --amount 50000 --ref FAC-2026-0042
```

### 7. Dispersión masiva

Llenar `pagos_batch.csv` con los pagos y ejecutar:

```bash
python batch_payout.py
```

### 8. Verificar CLABE de proveedor

```bash
python verify_clabe.py --clabe 012345678901234567
```

### 9. Sincronizar clientes nuevos

```bash
python sync_customers.py
```

## Configuración en Odoo

1. Crear un **Diario contable** llamado "Fintoc SPEI" (tipo: Banco)
2. Asignar a ese diario la cuenta bancaria de Fintoc
3. `odoo_client.py` busca automáticamente el diario por nombre "fintoc"

## Pruebas en modo test

Para probar sin mover dinero real, usar `sk_test_XXX` como `FINTOC_SECRET_KEY`.

Simular un cobro entrante:

```python
from fintoc_client import FintocManager
fintoc = FintocManager()
fintoc.simulate_inbound(account_number_id="acno_XXX", amount_mxn=5000.00)
```

## Notas importantes

- **Montos:** Fintoc usa centavos (enteros). `$5,900.50 MXN = 590050`. Los scripts ya hacen la conversión.
- **Idempotencia:** Siempre usar un UUID único como `idempotency_key` en pagos salientes. Si el request falla y se reintenta, Fintoc no duplica el pago.
- **Webhooks:** Fintoc puede enviar el mismo evento más de una vez. El servidor tiene deduplicación por `event_id`. En producción reemplazar el `set` en memoria por una tabla en Odoo o Redis.
- **HTTPS:** Fintoc NO envía webhooks a URLs HTTP. Usar nginx como reverse proxy con Let's Encrypt, o ngrok para pruebas locales.
