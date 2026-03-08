"use client";

import { Payment } from "@/types";
import { formatMoney, formatDateTime } from "@/lib/utils/format";

import { StatusBadge } from "@/components/shared/status-badge";
import { DetailPanel } from "@/components/shared/detail-panel";
import { Timeline, type TimelineEvent } from "@/components/shared/timeline";

export function PaymentDetailPanel({
  payment,
  isOpen,
  onClose,
}: {
  payment: Payment | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!payment) return null;

  const timelineEvents: TimelineEvent[] = [];

  if (payment.created_at) {
    timelineEvents.push({
      date: payment.created_at,
      label: "Pago creado",
      description: `Monto: ${formatMoney(payment.amount)}`,
      active: payment.status === "pending" || payment.status === "pending_approval",
    });
  }

  if (
    payment.status === "confirmed" ||
    payment.status === "processing" ||
    payment.status === "failed"
  ) {
    timelineEvents.push({
      date: payment.executed_at || payment.created_at || new Date().toISOString(),
      label: "Pago ejecutado",
      description: payment.fintoc_transfer_id
        ? `Transfer ID: ${payment.fintoc_transfer_id}`
        : "Enviado via SPEI",
      active: payment.status === "processing",
    });
  }

  if (payment.status === "confirmed") {
    timelineEvents.push({
      date: payment.executed_at || payment.created_at || new Date().toISOString(),
      label: "Pago confirmado",
      description: "Confirmado por Fintoc",
      active: true,
    });
  }

  if (payment.status === "failed" || payment.status === "rejected") {
    timelineEvents.push({
      date: payment.executed_at || payment.created_at || new Date().toISOString(),
      label:
        payment.status === "rejected" ? "Pago rechazado" : "Pago fallido",
      description: "El pago no pudo completarse",
      active: true,
    });
  }

  return (
    <DetailPanel
      isOpen={isOpen}
      onClose={onClose}
      title={`Pago #${payment.id}`}
      tabs={["Detalle", "Timeline", "Audit Log"]}
    >
      {/* Tab: Detalle */}
      <div className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Proveedor</p>
            <p className="text-sm font-medium">
              {payment.partner_name || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">RFC</p>
            <p className="text-sm font-medium font-mono">
              {payment.partner_rfc || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Monto</p>
            <p className="text-sm font-medium font-mono">
              {formatMoney(payment.amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estado</p>
            <StatusBadge status={payment.status} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">CLABE destino</p>
            <p className="text-sm font-mono">
              {payment.clabe_destination || "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Referencia</p>
            <p className="text-sm">{payment.reference_id || "-"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fecha creacion</p>
            <p className="text-sm">
              {payment.created_at
                ? formatDateTime(payment.created_at)
                : "-"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fecha ejecucion</p>
            <p className="text-sm">
              {payment.executed_at
                ? formatDateTime(payment.executed_at)
                : "-"}
            </p>
          </div>
        </div>

        {payment.fintoc_transfer_id && (
          <div>
            <p className="text-xs text-muted-foreground">Fintoc Transfer ID</p>
            <p className="text-sm font-mono">{payment.fintoc_transfer_id}</p>
          </div>
        )}

        {payment.fintoc_payment_intent_id && (
          <div>
            <p className="text-xs text-muted-foreground">
              Fintoc Payment Intent ID
            </p>
            <p className="text-sm font-mono">
              {payment.fintoc_payment_intent_id}
            </p>
          </div>
        )}

        {payment.cfdi_uuid && (
          <div>
            <p className="text-xs text-muted-foreground">CFDI UUID</p>
            <p className="text-sm font-mono">{payment.cfdi_uuid}</p>
          </div>
        )}

        {payment.odoo_id && (
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Odoo ID</p>
              <p className="text-sm">{payment.odoo_id}</p>
            </div>
            {payment.odoo_state && (
              <div>
                <p className="text-xs text-muted-foreground">Odoo Estado</p>
                <p className="text-sm">{payment.odoo_state}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tab: Timeline */}
      <div className="pt-4">
        {timelineEvents.length > 0 ? (
          <Timeline events={timelineEvents} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin eventos registrados.
          </p>
        )}
      </div>

      {/* Tab: Audit Log */}
      <div className="pt-4">
        <div className="space-y-3">
          {payment.created_at && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Pago creado</p>
                <p className="text-xs text-muted-foreground">
                  {payment.partner_name} - {formatMoney(payment.amount)}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(payment.created_at)}
              </span>
            </div>
          )}
          {payment.executed_at && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Pago ejecutado</p>
                <p className="text-xs text-muted-foreground">
                  Estado: {payment.status}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatDateTime(payment.executed_at)}
              </span>
            </div>
          )}
          {payment.jws_signed && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Firma JWS aplicada</p>
                <p className="text-xs text-muted-foreground">
                  Pago firmado digitalmente
                </p>
              </div>
            </div>
          )}
          {payment.complemento_emitido && (
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <p className="text-sm font-medium">Complemento de pago emitido</p>
                {payment.complemento_uuid && (
                  <p className="text-xs text-muted-foreground font-mono">
                    UUID: {payment.complemento_uuid}
                  </p>
                )}
              </div>
            </div>
          )}
          {!payment.created_at && !payment.executed_at && (
            <p className="text-sm text-muted-foreground">
              Sin registros de auditoria.
            </p>
          )}
        </div>
      </div>
    </DetailPanel>
  );
}
