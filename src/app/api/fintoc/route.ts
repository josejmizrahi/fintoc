import { createHandler } from '@/lib/middleware/route-handler';
import { withAuth } from '@/lib/middleware/auth';
import { ApiError } from '@/lib/utils/errors';
import { hasDB, query, update } from '@/lib/db';
import {
  createTransfer,
  verifyCLABE,
  createAccountNumber,
  getAccountNumber,
} from '@/lib/integrations/fintoc';

/**
 * POST /api/fintoc
 * Handles Fintoc operations:
 * - action: "outbound-transfer" — Send SPEI payment
 * - action: "verify-clabe" — Verify CLABE ownership via micro-deposit
 * - action: "create-account-number" — Create dedicated CLABE for customer
 * - action: "get-account-number" — Get account number details
 */
export const POST = createHandler(async (req) => {
  return withAuth(async (_req, ctx) => {
    if (!hasDB()) throw new ApiError('INTERNAL_ERROR', 'DB no configurada', 500);

    const body = await req.json();
    const { action } = body as { action: string };

    const { data: integration } = await query('integrations', {
      match: { company_id: ctx.company_id, provider: 'fintoc' },
      single: true,
    });
    const config = (integration?.config || {}) as Record<string, string>;
    const secretKey = config.secretKey;

    if (!secretKey || secretKey === '••••••••') {
      throw new ApiError('INTEGRATION_NOT_CONFIGURED', 'Fintoc no esta configurado. Agrega tu Secret Key en Configuracion.', 422);
    }

    switch (action) {
      case 'outbound-transfer': {
        const { payment_id, clabe, amount, holder_name: _holder_name, reference_id, metadata } = body as {
          payment_id?: number;
          clabe: string;
          amount: number;
          holder_name?: string;
          reference_id?: string;
          metadata?: Record<string, string>;
        };

        if (!clabe || !amount) {
          throw new ApiError('VALIDATION_ERROR', 'CLABE y monto son requeridos', 400);
        }
        if (!/^\d{18}$/.test(clabe)) {
          throw new ApiError('VALIDATION_ERROR', 'CLABE debe tener 18 digitos', 400);
        }

        const amountCents = Math.round(amount * 100);
        const concept = reference_id || (payment_id ? `PAY-${payment_id}` : `Pago`);
        const transfer = await createTransfer(
          {
            amount: amountCents,
            currency: 'MXN',
            destination_account: { number: clabe },
            concept,
            reference_id: reference_id || (payment_id ? `PAY-${payment_id}` : undefined),
            metadata: {
              company_id: String(ctx.company_id),
              ...(payment_id ? { payment_id: String(payment_id) } : {}),
              ...metadata,
            },
          },
          secretKey,
          payment_id ? `pay-${payment_id}` : undefined
        );

        if (payment_id) {
          await update('payments', {
            status: 'processing',
            fintoc_transfer_id: transfer.id,
            updated_at: new Date().toISOString(),
          }, { id: payment_id, company_id: ctx.company_id });
        }

        return Response.json({
          data: {
            message: 'Transferencia SPEI enviada',
            transfer_id: transfer.id,
            status: transfer.status,
          },
        });
      }

      case 'verify-clabe': {
        const { vendor_id, clabe } = body as { vendor_id?: number; clabe: string };

        if (!clabe || !/^\d{18}$/.test(clabe)) {
          throw new ApiError('VALIDATION_ERROR', 'CLABE invalida (18 digitos requeridos)', 400);
        }

        const data = await verifyCLABE(clabe, secretKey) as { holder_name?: string; account_holder?: string; institution?: { name?: string } };
        const holderName = data?.holder_name ?? data?.account_holder ?? null;
        const bankName = data?.institution?.name ?? null;

        if (vendor_id && holderName) {
          await update('vendors', {
            clabe_verified: true,
            clabe_holder_name: holderName,
          }, { id: vendor_id, company_id: ctx.company_id });
        }

        return Response.json({
          data: {
            message: 'CLABE verificada exitosamente',
            holder_name: holderName,
            bank: bankName,
            verified: true,
          },
        });
      }

      case 'create-account-number': {
        const { customer_id } = body as { customer_id: number };
        if (!customer_id) {
          throw new ApiError('VALIDATION_ERROR', 'customer_id requerido', 400);
        }

        const { data: customer } = await query('customers', {
          match: { id: customer_id, company_id: ctx.company_id },
          single: true,
        });
        if (!customer) {
          throw new ApiError('NOT_FOUND', 'Cliente no encontrado', 404);
        }

        const cust = customer as Record<string, unknown>;
        if (cust.fintoc_account_number_id) {
          return Response.json({
            data: {
              message: 'El cliente ya tiene una CLABE dedicada',
              clabe: cust.fintoc_clabe,
              account_number_id: cust.fintoc_account_number_id,
            },
          });
        }

        const result = await createAccountNumber(
          (cust.name as string) || '',
          `CLABE dedicada cliente ${customer_id}`,
          undefined,
          secretKey,
          {
            company_id: String(ctx.company_id),
            customer_id: String(customer_id),
            customer_name: (cust.name as string) || '',
          }
        );

        await update('customers', {
          fintoc_account_number_id: result.id,
          fintoc_clabe: result.number,
        }, { id: customer_id, company_id: ctx.company_id });

        return Response.json({
          data: {
            message: 'CLABE dedicada creada para el cliente',
            account_number_id: result.id,
            clabe: result.number,
          },
        });
      }

      case 'get-account-number': {
        const { account_number_id } = body as { account_number_id: string };
        if (!account_number_id) {
          throw new ApiError('VALIDATION_ERROR', 'account_number_id requerido', 400);
        }

        const data = await getAccountNumber(account_number_id, secretKey);
        return Response.json({ data });
      }

      default:
        throw new ApiError('VALIDATION_ERROR', 'Accion invalida', 400);
    }
  })(req, { params: Promise.resolve({}) });
}, { rateLimit: 'write' });
