import { NextRequest, NextResponse } from "next/server";
import { hasDB, query, update, insert } from "@/lib/db";
import { validateSyntageWebhook } from "@/lib/syntage";

/**
 * Syntage Webhook Handler
 * Receives events from Syntage (sat.ws) for:
 * - credential.updated: FIEL/CIEC status change
 * - extraction.updated: Extraction job completed/failed
 * - invoice.created: New CFDI detected
 * - invoice.updated: CFDI status change (e.g. cancelled)
 *
 * Signature: HMAC-SHA256 in X-Syntage-Signature header ("t=<ts>,s=<sig>")
 * See: https://docs.syntage.com/webhooks
 */

interface SyntageWebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  created_at?: string;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-syntage-signature") || "";

  let event: SyntageWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ detail: "Invalid JSON" }, { status: 400 });
  }

  if (!hasDB()) {
    return NextResponse.json({ received: true, warning: "No DB configured" });
  }

  // Find Syntage integration to validate signature & identify company
  const { data: integrations } = await query("integrations", {
    match: { provider: "sat" },
  });

  let companyId: number | null = null;

  for (const int of integrations || []) {
    const config = int.config as Record<string, string> | null;
    const webhookSecret = config?.syntageWebhookSecret;
    if (webhookSecret) {
      if (validateSyntageWebhook(rawBody, signature, webhookSecret)) {
        companyId = int.company_id as number;
        break;
      }
    }
  }

  // If no signature match but only one SAT integration, accept it
  if (!companyId && integrations?.length === 1) {
    companyId = integrations[0].company_id as number;
  }

  if (!companyId) {
    return NextResponse.json({ received: true, warning: "Company not identified" });
  }

  // Log webhook event
  try {
    await insert("webhook_events", {
      company_id: companyId,
      provider: "syntage",
      event_type: event.type,
      event_id: event.id || null,
      payload: event.data,
    });
  } catch { /* duplicate event_id */ }

  try {
    switch (event.type) {
      // ── Credential status changes ──
      case "credential.updated": {
        const credentialId = event.data.id as string;
        const status = event.data.status as string;
        if (credentialId) {
          // Update local integration config with credential status
          const { data: ints } = await query("integrations", {
            match: { provider: "sat", company_id: companyId },
            single: true,
          });
          if (ints) {
            const config = (ints.config || {}) as Record<string, unknown>;
            await update(
              "integrations",
              {
                config: {
                  ...config,
                  credentialStatus: status,
                  credentialId,
                  lastCredentialUpdate: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              },
              { provider: "sat", company_id: companyId },
            );
          }
        }
        break;
      }

      // ── Extraction completed/failed ──
      case "extraction.updated": {
        const extractionId = event.data.id as string;
        const status = event.data.status as string;

        // If extraction succeeded, trigger a sync to pull new data
        if (status === "success" && extractionId) {
          // Create a sync log entry so frontend shows activity
          await insert("sync_logs", {
            company_id: companyId,
            provider: "sat",
            sync_type: "webhook_extraction",
            status: "success",
            total_items: 0,
            processed_items: 0,
            details: {
              extraction_id: extractionId,
              extraction_status: status,
              triggered_by: "webhook",
            },
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          });
        }
        break;
      }

      // ── New invoice detected ──
      case "invoice.created": {
        const invoiceUuid = event.data.uuid as string;
        const rfc = event.data.rfc as string;

        if (invoiceUuid) {
          // Check if we already have this CFDI
          const { data: existing } = await query("invoices", {
            match: { uuid: invoiceUuid, company_id: companyId },
            single: true,
          });

          if (!existing) {
            // Insert basic record — full sync will fill in details
            await insert("invoices", {
              company_id: companyId,
              uuid: invoiceUuid,
              source: "syntage",
              rfc_emisor: (event.data.issuer_rfc as string) || rfc || null,
              rfc_receptor: (event.data.receiver_rfc as string) || null,
              total: event.data.total != null ? Number(event.data.total) : null,
              currency: (event.data.currency as string) || "MXN",
              status: (event.data.sat_status as string) || "vigente",
              type: (event.data.type as string) || "income",
              issued_at: (event.data.issued_at as string) || new Date().toISOString(),
              created_at: new Date().toISOString(),
            });
          }
        }
        break;
      }

      // ── Invoice status update (e.g. cancellation) ──
      case "invoice.updated": {
        const invoiceUuid = event.data.uuid as string;
        const satStatus = event.data.sat_status as string;

        if (invoiceUuid && satStatus) {
          await update(
            "invoices",
            {
              status: satStatus,
              updated_at: new Date().toISOString(),
            },
            { uuid: invoiceUuid, company_id: companyId },
          );
        }
        break;
      }

      default:
        // Unknown event — already logged in webhook_events
        break;
    }

    // Mark as processed
    if (event.id) {
      await update("webhook_events", { processed: true }, {
        event_id: event.id,
        company_id: companyId,
      }).catch(() => {});
    }
  } catch (err) {
    console.error("Syntage webhook processing error:", err);
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
