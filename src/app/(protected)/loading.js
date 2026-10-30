export default function Loading() {
  return (
    <div role="status" style={{ padding: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="spinner-border spinner-border-sm text-primary" aria-hidden="true" />
      <span>Loading page…</span>
    </div>
  );
}
