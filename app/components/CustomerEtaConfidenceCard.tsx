type CustomerEtaConfidenceCardProps = {
  routeStatus: string;
  isNextDrop: boolean;
  stopsBeforeCustomer: number;
  estimatedSlot: string;
};

function confidenceCopy({
  routeStatus,
  isNextDrop,
  stopsBeforeCustomer,
  estimatedSlot,
}: CustomerEtaConfidenceCardProps) {
  if (routeStatus !== 'OUT_FOR_DELIVERY') {
    return {
      eyebrow: 'Delivery planned',
      title: 'Your delivery slot',
      message: `We expect to be with you ${estimatedSlot}.`,
      highlight: 'We will update this page when the route starts.',
    };
  }

  if (isNextDrop || stopsBeforeCustomer === 0) {
    return {
      eyebrow: 'Driver nearby',
      title: 'You are next',
      message: 'Your delivery is the next stop on this route.',
      highlight: 'Please keep your phone nearby and make sure access is clear.',
    };
  }

  if (stopsBeforeCustomer === 1) {
    return {
      eyebrow: 'Nearly there',
      title: '1 drop before yours',
      message: 'The driver has one delivery to complete before heading to you.',
      highlight: `Expected delivery window: ${estimatedSlot}.`,
    };
  }

  return {
    eyebrow: 'Route in progress',
    title: `${stopsBeforeCustomer} drops before yours`,
    message: 'The driver is working through the route and your delivery is coming up.',
    highlight: `Expected delivery window: ${estimatedSlot}.`,
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
    </div>
  );
}
