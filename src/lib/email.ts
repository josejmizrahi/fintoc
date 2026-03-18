import { Resend } from 'resend';

// ---------------------------------------------------------------------------
// Resend Email Client — Quimibond transactional emails
// ---------------------------------------------------------------------------

const FROM_DEFAULT = 'Quimibond <no-reply@quimibond.com>';
const FROM_COBROS = 'Cobranza Quimibond <cobros@quimibond.com>';
const FROM_PAGOS = 'Pagos Quimibond <pagos@quimibond.com>';

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

// ---------------------------------------------------------------------------
// Base send
// ---------------------------------------------------------------------------

interface SendOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

export async function sendEmail(options: SendOptions): Promise<boolean> {
  const resend = getResend();
  if (!resend) {
    console.warn('[email] RESEND_API_KEY not configured — email not sent');
    return false;
  }

  try {
    await resend.emails.send({
      from: options.from || FROM_DEFAULT,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      reply_to: options.replyTo,
    });
    return true;
  } catch (err) {
    console.error('[email] Failed to send:', err instanceof Error ? err.message : err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Template: base layout
// ---------------------------------------------------------------------------

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
<tr><td style="background:#18181b;padding:24px 32px">
<span style="color:#fff;font-size:20px;font-weight:700">Quimibond</span>
</td></tr>
<tr><td style="padding:32px">
${content}
</td></tr>
<tr><td style="padding:16px 32px;background:#fafafa;text-align:center;font-size:12px;color:#71717a">
Quimibond — Plataforma financiera para empresas en Mexico
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Template: Recordatorio de cobranza
// ---------------------------------------------------------------------------

export async function sendCollectionReminder(opts: {
  to: string;
  customerName: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string;
  companyName: string;
  customMessage?: string;
}): Promise<boolean> {
  const formattedAmount = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(opts.amount);

  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#18181b">Recordatorio de pago</h2>
    <p style="color:#3f3f46;line-height:1.6">Estimado/a <strong>${opts.customerName}</strong>,</p>
    <p style="color:#3f3f46;line-height:1.6">
      Le recordamos que tiene un saldo pendiente por la factura <strong>${opts.invoiceNumber}</strong>.
    </p>
    <table style="width:100%;margin:24px 0;border-collapse:collapse">
      <tr><td style="padding:12px;background:#f4f4f5;border-radius:8px 8px 0 0;font-size:14px;color:#71717a">Monto pendiente</td>
          <td style="padding:12px;background:#f4f4f5;border-radius:8px 8px 0 0;text-align:right;font-size:18px;font-weight:700;color:#18181b">${formattedAmount}</td></tr>
      <tr><td style="padding:12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a">Fecha de vencimiento</td>
          <td style="padding:12px;border-bottom:1px solid #e4e4e7;text-align:right;font-size:14px;color:#18181b">${opts.dueDate}</td></tr>
      <tr><td style="padding:12px;font-size:14px;color:#71717a">Factura</td>
          <td style="padding:12px;text-align:right;font-size:14px;color:#18181b">${opts.invoiceNumber}</td></tr>
    </table>
    ${opts.customMessage ? `<p style="color:#3f3f46;line-height:1.6">${opts.customMessage}</p>` : ''}
    <p style="color:#3f3f46;line-height:1.6">Agradecemos su pronta atencion.</p>
    <p style="color:#71717a;font-size:14px;margin-top:24px">Atentamente,<br><strong>${opts.companyName}</strong></p>
  `);

  return sendEmail({
    to: opts.to,
    subject: `Recordatorio de pago — Factura ${opts.invoiceNumber}`,
    html,
    text: `Recordatorio de pago: Factura ${opts.invoiceNumber} por ${formattedAmount}. Vencimiento: ${opts.dueDate}`,
    from: FROM_COBROS,
  });
}

// ---------------------------------------------------------------------------
// Template: Pago ejecutado
// ---------------------------------------------------------------------------

export async function sendPaymentConfirmation(opts: {
  to: string;
  vendorName: string;
  amount: number;
  reference: string;
  concept: string;
  companyName: string;
}): Promise<boolean> {
  const formattedAmount = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(opts.amount);

  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#18181b">Pago SPEI enviado</h2>
    <p style="color:#3f3f46;line-height:1.6">Se ha ejecutado un pago exitosamente.</p>
    <table style="width:100%;margin:24px 0;border-collapse:collapse">
      <tr><td style="padding:12px;background:#f0fdf4;border-radius:8px 8px 0 0;font-size:14px;color:#71717a">Monto</td>
          <td style="padding:12px;background:#f0fdf4;border-radius:8px 8px 0 0;text-align:right;font-size:18px;font-weight:700;color:#166534">${formattedAmount}</td></tr>
      <tr><td style="padding:12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a">Beneficiario</td>
          <td style="padding:12px;border-bottom:1px solid #e4e4e7;text-align:right;font-size:14px">${opts.vendorName}</td></tr>
      <tr><td style="padding:12px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#71717a">Concepto</td>
          <td style="padding:12px;border-bottom:1px solid #e4e4e7;text-align:right;font-size:14px">${opts.concept}</td></tr>
      <tr><td style="padding:12px;font-size:14px;color:#71717a">Referencia</td>
          <td style="padding:12px;text-align:right;font-size:14px">${opts.reference}</td></tr>
    </table>
    <p style="color:#71717a;font-size:13px">Enviado por <strong>${opts.companyName}</strong> via Quimibond</p>
  `);

  return sendEmail({
    to: opts.to,
    subject: `Pago SPEI enviado — ${formattedAmount} a ${opts.vendorName}`,
    html,
    text: `Pago SPEI enviado: ${formattedAmount} a ${opts.vendorName}. Concepto: ${opts.concept}. Ref: ${opts.reference}`,
    from: FROM_PAGOS,
  });
}

// ---------------------------------------------------------------------------
// Template: Aprobacion pendiente
// ---------------------------------------------------------------------------

export async function sendApprovalRequest(opts: {
  to: string;
  approverName: string;
  entityType: string;
  amount: number;
  requestedBy: string;
  description: string;
  approveUrl: string;
}): Promise<boolean> {
  const formattedAmount = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(opts.amount);

  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#18181b">Aprobacion requerida</h2>
    <p style="color:#3f3f46;line-height:1.6">Hola <strong>${opts.approverName}</strong>,</p>
    <p style="color:#3f3f46;line-height:1.6">
      <strong>${opts.requestedBy}</strong> solicita tu aprobacion para un ${opts.entityType}.
    </p>
    <table style="width:100%;margin:24px 0;border-collapse:collapse">
      <tr><td style="padding:12px;background:#fef3c7;border-radius:8px 8px 0 0;font-size:14px;color:#71717a">Monto</td>
          <td style="padding:12px;background:#fef3c7;border-radius:8px 8px 0 0;text-align:right;font-size:18px;font-weight:700;color:#92400e">${formattedAmount}</td></tr>
      <tr><td style="padding:12px;font-size:14px;color:#71717a">Descripcion</td>
          <td style="padding:12px;text-align:right;font-size:14px">${opts.description}</td></tr>
    </table>
    <div style="text-align:center;margin:32px 0">
      <a href="${opts.approveUrl}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">
        Revisar solicitud
      </a>
    </div>
  `);

  return sendEmail({
    to: opts.to,
    subject: `Aprobacion requerida — ${opts.entityType} por ${formattedAmount}`,
    html,
    text: `Aprobacion requerida: ${opts.entityType} por ${formattedAmount}. Solicitado por ${opts.requestedBy}. Revisa en: ${opts.approveUrl}`,
  });
}

// ---------------------------------------------------------------------------
// Template: Factura vencida (overdue alert)
// ---------------------------------------------------------------------------

export async function sendOverdueAlert(opts: {
  to: string;
  userName: string;
  overdueCount: number;
  totalAmount: number;
  companyName: string;
}): Promise<boolean> {
  const formattedAmount = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(opts.totalAmount);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://fintoc.vercel.app';

  const html = baseLayout(`
    <h2 style="margin:0 0 16px;color:#18181b">Facturas vencidas</h2>
    <p style="color:#3f3f46;line-height:1.6">Hola <strong>${opts.userName}</strong>,</p>
    <p style="color:#3f3f46;line-height:1.6">
      Tienes <strong style="color:#dc2626">${opts.overdueCount} factura${opts.overdueCount > 1 ? 's' : ''} vencida${opts.overdueCount > 1 ? 's' : ''}</strong>
      por un total de <strong style="color:#dc2626">${formattedAmount}</strong>.
    </p>
    <div style="text-align:center;margin:32px 0">
      <a href="${appUrl}/cobranza" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">
        Ver facturas vencidas
      </a>
    </div>
    <p style="color:#71717a;font-size:13px">${opts.companyName} — Quimibond</p>
  `);

  return sendEmail({
    to: opts.to,
    subject: `${opts.overdueCount} factura${opts.overdueCount > 1 ? 's' : ''} vencida${opts.overdueCount > 1 ? 's' : ''} — ${formattedAmount}`,
    html,
    text: `Tienes ${opts.overdueCount} facturas vencidas por ${formattedAmount}. Revisa en ${appUrl}/cobranza`,
  });
}
