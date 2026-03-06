"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

declare global {
  interface Window {
    Fintoc?: {
      create: (config: Record<string, unknown>) => {
        open: () => void;
        destroy: () => void;
      };
    };
  }
}

interface FintocWidgetProps {
  publicKey: string;
  onLinkToken: (linkToken: string) => void;
  holderType?: "business" | "individual";
}

/**
 * Fintoc Widget button for connecting fiscal data (invoices/SAT).
 * Opens the Fintoc widget, receives an exchange token on success,
 * and exchanges it for a link_token via our backend.
 */
export function FintocWidget({ publicKey, onLinkToken, holderType = "business" }: FintocWidgetProps) {
  const [loading, setLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const widgetRef = useRef<{ open: () => void; destroy: () => void } | null>(null);

  // Load Fintoc SDK script
  useEffect(() => {
    if (window.Fintoc) { setSdkReady(true); return; }
    const existing = document.querySelector('script[src="https://js.fintoc.com/v1/"]');
    if (existing) {
      existing.addEventListener("load", () => setSdkReady(true));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.fintoc.com/v1/";
    script.async = true;
    script.onload = () => setSdkReady(true);
    script.onerror = () => toast.error("Error al cargar el SDK de Fintoc");
    document.head.appendChild(script);
    return () => { widgetRef.current?.destroy(); };
  }, []);

  async function handleOpen() {
    if (!window.Fintoc) {
      toast.error("SDK de Fintoc no disponible");
      return;
    }
    if (!publicKey) {
      toast.error("Configura primero tu Public Key de Fintoc");
      return;
    }

    setLoading(true);

    try {
      widgetRef.current?.destroy();
    } catch { /* ignore */ }

    widgetRef.current = window.Fintoc.create({
      publicKey,
      product: "invoices",
      holderType,
      country: "mx",
      onSuccess: async (linkIntent: Record<string, unknown>) => {
        const exchangeToken = (linkIntent.exchangeToken as string) || (linkIntent.exchange_token as string);
        if (!exchangeToken) {
          toast.error("No se recibio exchange token de Fintoc");
          setLoading(false);
          return;
        }
        try {
          const result = await api.fintoc.exchange(exchangeToken);
          if (result.link_token) {
            onLinkToken(result.link_token);
            toast.success("Cuenta fiscal conectada exitosamente");
          } else {
            toast.warning("Token intercambiado pero no se recibio link_token");
          }
        } catch (err: unknown) {
          toast.error((err instanceof Error ? err.message : null) || "Error al intercambiar token");
        }
        setLoading(false);
      },
      onExit: () => {
        setLoading(false);
      },
    });

    widgetRef.current.open();
  }

  return (
    <Button
      variant="outline"
      onClick={handleOpen}
      disabled={loading || !sdkReady || !publicKey}
    >
      {loading ? (
        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
      ) : null}
      {loading ? "Conectando..." : "Conectar cuenta fiscal"}
    </Button>
  );
}
