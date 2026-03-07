import { z } from "zod";
import { createPaymentSchema } from "@/lib/utils/validation";

export type PaymentFormValues = z.infer<typeof createPaymentSchema>;

export type TabKey = "todos" | "pendientes" | "ejecutados" | "programados" | "fallidos";

export const TAB_STATUS_MAP: Record<TabKey, string | undefined> = {
  todos: undefined,
  pendientes: "pending,pending_approval",
  ejecutados: "confirmed",
  programados: "scheduled",
  fallidos: "failed,rejected",
};
