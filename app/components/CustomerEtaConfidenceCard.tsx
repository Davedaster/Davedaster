type CustomerEtaConfidenceCardProps = {
  routeStatus: string;
  isNextDrop: boolean;
  stopsBeforeCustomer: number;
  estimatedSlot: string;
};

function normaliseStopsBeforeCustomer(stopsBeforeCustomer: number) {
  return Math.max(0, Number.isFinite(stopsBeforeCustomer) ? stopsBeforeCustomer : 0);
}

function confidenceCopy({
  routeStatus,
  isNextDrop,
  stopsBeforeCustomer,
  estimatedSlot,
}: CustomerEtaConfidenceCardProps) {
  const deliveriesBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (routeStatus !== 'OUT_FOR_DELIVERY') {
    return {
      eyebrow: 'Delivery planned',
      title: 'Your delivery slot',
      message: `We expect to be with you ${estimatedSlot}.`,
      highlight: 'We will update this page with live route progress once the driver starts their route.',
    };
  }

  if (isNextDrop || deliveriesBefore === 0) {
    return {
      eyebrow: 'Driver nearby',
      title: 'You are next',
      message: 'Your delivery is the next stop on the route.',
      highlight: 'Please keep your phone nearby and ensure access is available for the driver.',
    };
  }

  if (deliveriesBefore === 1) {
    return {
      eyebrow: 'Nearly there',
      title: '1 delivery before yours',
      message: 'There is just one delivery remaining before the driver heads to you.',
      highlight: `Estimated arrival: ${estimatedSlot}.`,
    };
  }

  return {
    eyebrow: 'Route in progress',
    title: `${deliveriesBefore} deliveries before yours`,
    message: 'Your delivery is progressing through the route and getting closer.',
    highlight: `Estimated arrival: ${estimatedSlot}.`,
  };
}

export function CustomerEtaConfidenceCard(props: CustomerEtaConfidenceCardProps) {
  const copy = confidenceCopy(props);

  return (
    <div
      style={{
        marginBottom: 18,
        background: '#EEF6FF',
        border: '1px solid #BFDDF8',
        borderRadius: 18,
        padding: 18,
        boxShadow: '0 8px 24px rgba(50,56,65,0.08)',
      }}
    >
      <p style={{ margin: '0 0 6px', color: '#509AE6', fontWeight: 800, letterSpacing: 0.4 }}>
        {copy.eyebrow}
      </p>
      <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{copy.title}</h2>
      <p style={{ margin: '0 0 12px', color: '#323841', fontWeight: 700 }}>{copy.message}</p>
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #BFDDF8',
          color: '#323841',
          borderRadius: 14,
          padding: 12,
          fontWeight: 700,
        }}
      >
        {copy.highlight}
      </div>
      <p style={{ margin: '10px 0 0', color: '#667085', fontSize: 13 }}>
        Times are estimates and may change slightly due to traffic, access, or earlier deliveries.
      </p>
    </div>
  );
}
