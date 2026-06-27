type TrackingActionCardProps = {
  title: string;
  description: string;
  buttonLabel: string;
  onClick?: () => void;
};

export function TrackingActionCard({
  title,
  description,
  buttonLabel,
  onClick,
}: TrackingActionCardProps) {
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 18,
        padding: 18,
        boxShadow: '0 8px 24px rgba(50,56,65,0.08)',
        border: '1px solid #e5e7eb',
      }}
    >
      <h3 style={{ margin: '0 0 8px' }}>{title}</h3>
      <p style={{ margin: '0 0 14px', color: '#667085' }}>{description}</p>
      <button
        type='button'
        onClick={onClick}
        style={{
          border: '1px solid #509AE6',
          background: '#509AE6',
          color: '#ffffff',
          borderRadius: 999,
          padding: '10px 14px',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
