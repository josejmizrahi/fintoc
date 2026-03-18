import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <h2 className="text-xl font-semibold">Pagina no encontrada</h2>
      <p className="text-muted-foreground text-center max-w-md">
        La pagina que buscas no existe o fue movida.
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Volver al inicio
      </Link>
    </div>
  );
}
