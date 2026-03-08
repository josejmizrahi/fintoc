'use client';

export default function InvoicesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="text-destructive text-sm">{error.message}</p>
      <button onClick={reset} className="text-sm underline">
        Reintentar
      </button>
    </div>
  );
}
