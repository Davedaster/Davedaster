import { useEffect, useState } from 'react';

const SUPPORT_EMAIL = 'deliveries@bathroompanelsdirect.co.uk';

function buildSupportEmailHref(trackingUrl: string) {
  const subject = 'Delivery tracking enquiry';
  const body = [
    'Hi Bathroom Panels Direct,',
    '',
    'I need help with my delivery tracking.',
    '',
    'Order number:',
    '',
    `Tracking link: ${trackingUrl}`,
  ].join('\n');

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function buildSafePlaceAction() {
  if (typeof window === 'undefined') {
    return '';
  }

  const path = window.location.pathname.replace(/\/$/, '');

  return `${path}/safe-place${window.location.search}`;
}

function safePlaceSavedMessage() {
  if (typeof window === 'undefined') {
    return null;
  }

  const status = new URLSearchParams(window.location.search).get('instructions');

  if (status === 'saved') {
    return 'Delivery instructions saved for the driver.';
  }

  if (status === 'closed') {
    return 'This delivery has already been updated, so instructions can no longer be changed here.';
  }

  if (status === 'missing') {
    return 'Please choose a safe place before saving.';
  }

  return null;
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
  const [trackingUrl, setTrackingUrl] = useState('');
  const [safePlaceAction, setSafePlaceAction] = useState('');
  const [safePlaceMessage, setSafePlaceMessage] = useState<string | null>(null);
  const [safePlaceOption, setSafePlaceOption] = useState('porch');

  useEffect(() => {
    setTrackingUrl(window.location.href);
    setSafePlaceAction(buildSafePlaceAction());
    setSafePlaceMessage(safePlaceSavedMessage());
  }, []);

  async function handleCopyTrackingLink() {
    try {
      await copyCurrentTrackingLink();
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2500);
    } catch {
      setCopyState('failed');
    }
  }

  const copyFeedback = copyState === 'copied'
    ? 'Tracking link copied'
    : copyState === 'failed'
      ? 'Copy failed'
      : 'Copy tracking link';

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
          href={buildSupportEmailHref(trackingUrl)}
          aria-label={`Email delivery support at ${SUPPORT_EMAIL}`}
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
          aria-live='polite'
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
          {copyFeedback}
        </button>
      </div>

      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #BFDDF8' }}>
        <h3 style={{ margin: '0 0 8px' }}>Not going to be in?</h3>
        <p style={{ margin: '0 0 12px', color: '#667085', fontSize: 14 }}>
          Deliveries cannot be rearranged from this page. If nobody is available, our driver will use these instructions and leave your order in a suitable safe place where possible.
        </p>
        {safePlaceMessage ? (
          <p style={{ margin: '0 0 12px', color: '#16a34a', fontSize: 14, fontWeight: 800 }}>
            {safePlaceMessage}
          </p>
        ) : null}
        <form method='post' action={safePlaceAction}>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={{ display: 'block', marginBottom: 6, color: '#323841', fontWeight: 700 }}>Safe place</span>
            <select
              name='safePlaceOption'
              value={safePlaceOption}
              onChange={(event) => setSafePlaceOption(event.currentTarget.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #BFDDF8', borderRadius: 12, background: '#ffffff', color: '#323841' }}
            >
              <option value='porch'>Leave in porch</option>
              <option value='side_gate'>Leave behind side gate</option>
              <option value='shed'>Leave in shed or outbuilding</option>
              <option value='neighbour'>Leave with neighbour</option>
              <option value='other'>Other safe place</option>
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', marginBottom: 6, color: '#323841', fontWeight: 700 }}>Extra instructions</span>
            <textarea
              name='safePlaceDetails'
              rows={3}
              maxLength={500}
              placeholder={safePlaceOption === 'neighbour' ? 'Example: leave with number 12 if they are home' : 'Example: brown gate on the left, leave behind bins'}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #BFDDF8', borderRadius: 12, resize: 'vertical', color: '#323841' }}
            />
          </label>
          <button
            type='submit'
            disabled={!safePlaceAction}
            style={{ border: '1px solid #509AE6', background: '#509AE6', color: '#ffffff', padding: '10px 14px', borderRadius: 999, fontWeight: 700, cursor: safePlaceAction ? 'pointer' : 'not-allowed', opacity: safePlaceAction ? 1 : 0.6 }}
          >
            Save delivery instructions
          </button>
        </form>
      </div>
    </div>
  );
}
