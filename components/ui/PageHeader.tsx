export default function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{title}</h1>
          {subtitle && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4, margin: 0 }}>{subtitle}</p>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
      </div>
    </div>
  );
}
