import { useState } from 'react';

const SUPPORT_EMAIL = 'deliveries@bathroompanelsdirect.co.uk';

function buildSupportEmailHref() {
  const subject = 'Delivery tracking enquiry';
  const body = [
    'Hi Bathroom Panels Direct,',
    '',
    'I need help with my delivery tracking.',
    '',
    'Order number:',
    '',
    `Tracking link: ${typeof window === 'undefined' ? '' : window.location.href}`,
  ].join('\n');

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyCurrentTrackingLink() {
  if (typeof window === 'undefined') {
    return;
  }

  const trackingUrl = window.location.href;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(trackingUrl);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = trackingUrl;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'absolute';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

export function CustomerSupportCard() {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function handleCopyTrackingLink() {
    try {
      await copyCurrentTrackingLink();
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2500);
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div
      style={{
        background: '#EEF6FF',
        border: '1px solid #BFDDF8',
        borderRadius: 18,
        padding: 18,
      }}
    >
      <p style={{ margin: '0 0 6px', color: '#509AE6', fontWeight: 800 }}>
        Need help?
      </p>
      <h3 style={{ margin: '0 0 10px' }}>Customer support</h3>
      <p style={{ margin: '0 0 8px', color: '#667085' }}>
        Our delivery team is here to help with delivery updates and tracking enquiries.
      </p>
      <p style={{ margin: '0 0 8px', color: '#667085', fontSize: 14 }}>
        Support email: <strong style={{ color: '#323841' }}>{SUPPORT_EMAIL}</strong>
      </p>
      <p style={{ margin: '0 0 14px', color: '#667085', fontSize: 14 }}>
        Please include your order number if you know it.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <a
          href={buildSupportEmailHref()}
          style={{
            background: '#509AE6',
            color: '#ffffff',
            textDecoration: 'none',
            padding: '10px 14px',
            borderRadius: 999,
            fontWeight: 700,
          }}
        >
          Email support
        </a>

        <button
          type='button'
          onClick={() => void handleCopyTrackingLink()}
          style={{
            border: '1px solid #509AE6',
            background: '#ffffff',
            color: '#509AE6',
            padding: '10px 14px',
            borderRadius: 999,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {copyState === 'copied' ? 'Tracking link copied' : copyState === 'failed' ? 'Copy failed' : 'Copy tracking link'}
        </button>
      </div>
    </div>
  );
}
