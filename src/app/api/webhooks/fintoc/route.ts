import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, update, insert } from "@/lib/db";
import { verifyFintocWebhookSignature } from "@/lib/fintoc";

/**
 * Fintoc Webhook Handler
 * Receives events from Fintoc for:
 * - payment_intent.succeeded / payment_intent.failed (Payment Intents)
 * - transfer.outbound.succeeded / transfer.outbound.failed (Outbound Transfers / SPEI)
 * - transfer.inbound.succeeded (Incoming SPEI to dedicated CLABE)
 * - account.movement_created / movement.created (Bank movements)
 * - checkout_session.completed / checkout_session.payment_succeeded (Collections)
 * - subscription.activated / subscription.canceled (Recurring)
 *
 * See: https://docs.fintoc.com/docs/webhooks
 */

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("fintoc-signature") || "";

  let event: {
    id: string;
    type: string;
    data: Record<string, unknown>;
    created_at?: string;
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  if (!hasDB()) {
    return NextResponse.json({ received: true, warning: "No DB configured" });
  }

  // Find integration by webhook secret to validate & identify company
  const { data: integrations } = await query("integrations", { match: { provider: "fintoc" } });
  let companyId: number | null = null;

  for (const int of integrations || []) {
    const config = int.config as Record<string, string> | null;
    const webhookSecret = config?.webhookSecret;
    if (webhookSecret && webhookSecret !== "••••••••") {
      if (verifyFintocWebhookSignature(rawBody, signature, webhookSecret)) {
        companyId = int.company_id as number;
        break;
      }
    }
  }

  // If no signature match, try to identify by metadata
  if (!companyId && event.data?.metadata) {
    const meta = event.data.metadata as Record<string, string>;
    if (meta.company_id) companyId = Number(meta.company_id);
  }

  if (!companyId) {
    return NextResponse.json({ received: true, warning: "Company not identified" });
  }

  // Log webhook event for audit trail
  try {
    await insert("webhook_events", {
      company_id: companyId,
      provider: "fintoc",
      event_type: event.type,
      event_id: event.id || null,
      payload: event.data,
    });
  } catch { /* duplicate event_id — already processed */ }

  try {
    switch (event.type) {
      // ── Payment Intents ──

      case "payment_intent.succeeded": {
        const piId = event.data.id as string;
        if (piId) {
          await update(
            "payments",
            { status: "confirmed", updated_at: new Date().toISOString() },
            { fintoc_payment_intent_id: piId, company_id: companyId },
          );
        }
        break;
      }

      case "payment_intent.failed": {
        const piId = event.data.id as string;
        if (piId) {
          await update(
            "payments",
            { status: "failed", updated_at: new Date().toISOString() },
            { fintoc_payment_intent_id: piId, company_id: companyId },
          );
        }
        break;
      }

      // ── Outbound Transfers (SPEI dispersions) ──

      case "transfer.outbound.succeeded": {
        const transferId = event.data.id as string;
        const meta = (event.data.metadata || {}) as Record<string, string>;
        const settledAt = (event.data.settled_at as string) || new Date().toISOString();

        if (transferId) {
          // Update payment by fintoc_transfer_id or by metadata.payment_id
          const matchField = meta.payment_id
            ? { id: Number(meta.payment_id), company_id: companyId }
            : { fintoc_transfer_id: transferId, company_id: companyId };

          await update("payments", {
            status: "confirmed",
            fintoc_transfer_id: transferId,
            executed_at: settledAt,
            updated_at: new Date().toISOString(),
          }, matchField);

          // Dual-write: also record in bank_movements
          try {
            await insert("bank_movements", {
              company_id: companyId,
              fintoc_id: transferId,
              amount: -(Number(event.data.amount) || 0) / 100,
              currency: (event.data.currency as string)?.toUpperCase() || "MXN",
              description: meta.reference || (event.data.description as string) || "",
              post_date: settledAt,
              type: "debit",
              reference_id: meta.reference || null,
              counterpart_name: (event.data.counterparty as Record<string, unknown>)?.holder_name as string || meta.partner_name || null,
              counterpart_account: (event.data.counterparty as Record<string, unknown>)?.account_number as string || null,
            });
          } catch { /* duplicate fintoc_id */ }
        }
        break;
      }

      case "transfer.outbound.failed": {
        const transferId = event.data.id as string;
        const meta = (event.data.metadata || {}) as Record<string, string>;

        if (transferId) {
          const matchField = meta.payment_id
            ? { id: Number(meta.payment_id), company_id: companyId }
            : { fintoc_transfer_id: transferId, company_id: companyId };

          await update("payments", {
            status: "failed",
            fintoc_transfer_id: transferId,
            updated_at: new Date().toISOString(),
          }, matchField);
        }
        break;
      }

      // ── Inbound Transfers (SPEI received on dedicated CLABE) ──

      case "transfer.inbound.succeeded": {
        const transferId = event.data.id as string;
        const amount = Number(event.data.amount) || 0;
        const settledAt = (event.data.settled_at as string) || new Date().toISOString();
        const accountNumberId = event.data.account_number_id as string || null;
        const senderAccount = (event.data.sender_account as Record<string, unknown>)?.number as string || null;
        const senderName = (event.data.sender_account as Record<string, unknown>)?.holder_name as string || "";

        // Identify customer by fintoc_account_number_id
        let partnerName = senderName;
        if (accountNumberId) {
          const { data: customer } = await query("customers", {
            match: { company_id: companyId, fintoc_account_number_id: accountNumberId },
            single: true,
          });
          if (customer) {
            partnerName = (customer.name as string) || senderName;
          }
        }

        // Dual-write: bank_movement
        let bankMovementId: number | null = null;
        try {
          const { data: bm } = await insert("bank_movements", {
            company_id: companyId,
            fintoc_id: transferId,
            amount: Math.abs(amount) / 100,
            currency: (event.data.currency as string)?.toUpperCase() || "MXN",
            description: (event.data.description as string) || "",
            post_date: settledAt,
            type: "credit",
            reference_id: (event.data.reference_id as string) || null,
            sender_account: senderAccount,
            counterpart_name: senderName,
            fintoc_account_number_id: accountNumberId,
          });
          bankMovementId = bm?.[0]?.id || null;
        } catch { /* duplicate fintoc_id */ }

        // Create inbound payment
        await insert("payments", {
          company_id: companyId,
          direction: "inbound",
          status: "confirmed",
          amount: Math.abs(amount) / 100,
          currency: "MXN",
          partner_name: partnerName,
          fintoc_transfer_id: transferId,
          executed_at: settledAt,
          source: "fintoc",
          clabe_origin: senderAccount,
          bank_movement_id: bankMovementId,
          reference_id: (event.data.reference_id as string) || `SPEI-${transferId?.slice(-8) || Date.now()}`,
        });
        break;
      }

      // ── Bank Movements (generic) ──

      case "account.movement_created":
      case "movement.created": {
        const movement = event.data;
        const fintocId = (movement.id as string) || null;
        const amount = Number(movement.amount) || 0;

        try {
          await insert("bank_movements", {
            company_id: companyId,
            fintoc_id: fintocId,
            amount: Math.abs(amount) / 100,
            currency: (movement.currency as string) || "MXN",
            description: (movement.description as string) || "",
            post_date: (movement.post_date as string) || new Date().toISOString(),
            type: amount >= 0 ? "credit" : "debit",
            reference_id: (movement.reference_id as string) || null,
            sender_account: (movement.sender_account as Record<string, string>)?.number || null,
          });
        } catch { /* duplicate fintoc_id */ }
        break;
      }

      // ── Checkout Sessions (Collections) ──

      case "checkout_session.completed":
      case "checkout_session.payment_succeeded": {
        const meta = (event.data.metadata || {}) as Record<string, string>;
        if (meta.partner_id) {
          await insert("payments", {
            company_id: companyId,
            direction: "inbound",
            status: "confirmed",
            amount: Number(event.data.amount) / 100 || 0,
            currency: "MXN",
            partner_name: meta.partner_name || "",
            reference_id: `CS-${event.data.id || Date.now()}`,
            source: "fintoc",
          });
        }
        break;
      }

      // ── Subscriptions ──

      case "subscription.activated": {
        // Log only — subscription management is handled via dashboard
        break;
      }

      case "subscription.canceled": {
        // Log only
        break;
      }

      case "subscription_intent.succeeded": {
        const meta = (event.data.metadata || {}) as Record<string, string>;
        if (meta.partner_id || meta.company_id) {
          await insert("payments", {
            company_id: companyId,
            direction: "inbound",
            status: "confirmed",
            amount: Number(event.data.amount) / 100 || 0,
            currency: "MXN",
            partner_name: meta.partner_name || "",
            reference_id: `SUB-${event.data.id || Date.now()}`,
            source: "fintoc",
          });
        }
        break;
      }

      default:
        // Unknown event type — accept silently (already logged in webhook_events)
        break;
    }

    // Mark webhook event as processed
    if (event.id) {
      await update("webhook_events", { processed: true }, { event_id: event.id, company_id: companyId }).catch(() => {});
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
    // Mark as failed
    if (event.id) {
      await update("webhook_events", {
        processed: false,
        error_message: err instanceof Error ? err.message : "Processing error",
      }, { event_id: event.id, company_id: companyId }).catch(() => {});
    }
    return NextResponse.json({ received: true, error: "Processing error" }, { status: 500 });
  }

  return NextResponse.json({ received: true, event_type: event.type });
}
