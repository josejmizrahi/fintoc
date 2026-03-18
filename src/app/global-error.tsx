'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Algo salió mal</h2>
        <p>Ocurrió un error inesperado.</p>
        <button
          onClick={() => reset()}
          style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '6px', border: '1px solid #ccc', background: '#fff' }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
