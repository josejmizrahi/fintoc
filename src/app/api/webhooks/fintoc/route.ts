import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, update, insert } from "@/lib/db";
import crypto from "crypto";

/**
 * Fintoc Webhook Handler
 * Receives events from Fintoc for payment_intents, movements, and link updates.
 * See: https://docs.fintoc.com/docs/webhooks
 */

function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

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
      if (verifySignature(rawBody, signature, webhookSecret)) {
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
    // Accept but can't process without company context
    return NextResponse.json({ received: true, warning: "Company not identified" });
  }

  try {
    switch (event.type) {
      // Payment intent completed — mark payment as confirmed
      case "payment_intent.succeeded": {
        const piId = event.data.id as string;
        if (piId) {
          await update(
            "payments",
            { status: "confirmed", updated_at: new Date().toISOString() },
            { fintoc_payment_intent_id: piId, company_id: companyId }
          );
        }
        break;
      }

      // Payment intent failed
      case "payment_intent.failed": {
        const piId = event.data.id as string;
        if (piId) {
          await update(
            "payments",
            { status: "failed", updated_at: new Date().toISOString() },
            { fintoc_payment_intent_id: piId, company_id: companyId }
          );
        }
        break;
      }

      // New movement detected on linked account
      case "account.movement_created":
      case "movement.created": {
        const movement = event.data;
        await insert("bank_movements", {
          company_id: companyId,
          fintoc_id: (movement.id as string) || null,
          amount: Number(movement.amount) || 0,
          currency: (movement.currency as string) || "MXN",
          description: (movement.description as string) || "",
          post_date: (movement.post_date as string) || new Date().toISOString(),
          type: Number(movement.amount) >= 0 ? "credit" : "debit",
          reference_id: (movement.reference_id as string) || null,
          sender_account: (movement.sender_account as Record<string, string>)?.number || null,
        });
        break;
      }

      // Checkout session completed — mark collection as paid
      case "checkout_session.completed":
      case "checkout_session.payment_succeeded": {
        const meta = (event.data.metadata || {}) as Record<string, string>;
        if (meta.partner_id) {
          // Record the incoming payment
          await insert("payments", {
            company_id: companyId,
            direction: "inbound",
            status: "confirmed",
            amount: Number(event.data.amount) / 100 || 0,
            currency: "MXN",
            partner_name: meta.partner_name || "",
            reference_id: `CS-${event.data.id || Date.now()}`,
          });
        }
        break;
      }

      default:
        // Unknown event type — accept silently
        break;
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
    return NextResponse.json({ received: true, error: "Processing error" }, { status: 500 });
  }

  return NextResponse.json({ received: true, event_type: event.type });
}
