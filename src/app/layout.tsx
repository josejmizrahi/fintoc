import type { Metadata } from 'next';
import { Providers } from '@/components/layout/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quimibond - Plataforma Financiera',
  description:
    'Plataforma de pagos, cobranza y gestion financiera para empresas en Mexico. Integracion con Fintoc, Odoo y SAT.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
