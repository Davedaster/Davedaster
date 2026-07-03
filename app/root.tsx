import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

const planningPanelStyles = `
  html,
  body {
    overscroll-behavior-y: none;
  }

  .bpd-tomtom-map,
  .bpd-tomtom-map * {
    overscroll-behavior: contain;
  }

  .bpd-tomtom-map {
    isolation: isolate;
  }

  .bpd-tomtom-popup .mapboxgl-popup-content:not([data-bpd-tooltip-ready="true"]) {
    opacity: 1;
  }

  .bpd-tomtom-popup .mapboxgl-popup-content[data-bpd-tooltip-ready="true"] {
    opacity: 1;
  }

  .bpd-fulfil-date {
    font-weight: 800;
  }

  .bpd-fulfil-dot {
    font-size: 11px;
    margin-right: 4px;
  }

  .bpd-fulfil-date-green {
    color: #16a34a;
  }

  .bpd-fulfil-date-orange {
    color: #f97316;
  }

  .bpd-fulfil-date-red {
    color: #b42318;
  }

  .bpd-fulfil-date-grey {
    color: #667085;
  }

  .bpd-admin-toast-stack {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 99999;
    display: grid;
    gap: 10px;
    width: min(420px, calc(100vw - 36px));
    pointer-events: none;
  }

  .bpd-admin-toast {
    border-radius: 16px;
    box-shadow: 0 14px 34px rgba(15, 23, 42, 0.18);
    padding: 13px 14px;
    opacity: 1;
    transform: translateY(0);
    transition: opacity 700ms ease, transform 700ms ease;
    pointer-events: auto;
  }

  .bpd-admin-toast[data-leaving="true"] {
    opacity: 0;
    transform: translateY(8px);
  }

  .bpd-admin-toast-success {
    border: 1px solid #bbf7d0;
    background: #ecfdf3;
    color: #166534;
  }

  .bpd-admin-toast-info {
    border: 1px solid #b9d8ff;
    background: #eff6ff;
    color: #1d4ed8;
  }

  .bpd-admin-toast-critical {
    border: 1px solid #fecdca;
    background: #fff7f5;
    color: #b42318;
  }

  .bpd-admin-toast-title {
    margin: 0;
    font-weight: 900;
    font-size: 14px;
  }

  .bpd-admin-toast-detail {
    margin: 5px 0 0;
    font-weight: 700;
    font-size: 13px;
    line-height: 1.35;
    color: #323841;
  }

  details:has(> summary[style*="list-style"] h3) {
    border: 1px solid #d0d5dd;
    border-radius: 12px;
    padding: 12px;
  }

  details:has(> summary[style*="list-style"] h3) > summary p,
  details:has(> summary[style*="list-style"] h4) > summary p {
    display: none;
  }

  details:has(> summary[style*="list-style"] h3) > summary span,
  details:has(> summary[style*="list-style"] h4) > summary span {
    min-width: 82px;
    text-align: center;
  }

  details[open]:has(> summary[style*="list-style"] h3) > summary span,
  details[open]:has(> summary[style*="list-style"] h4) > summary span {
    font-size: 0 !important;
  }

  details[open]:has(> summary[style*="list-style"] h3) > summary span::after,
  details[open]:has(> summary[style*="list-style"] h4) > summary span::after {
    content: "Close";
    font-size: 13px;
  }
`;

const planningPanelScript = `
  (() => {
    const bpdEscapeHtml = (value) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

    const getToastStack = () => {
      let stack = document.querySelector('.bpd-admin-toast-stack');
      if (stack) return stack;
      stack = document.createElement('div');
      stack.className = 'bpd-admin-toast-stack';
      document.body.appendChild(stack);
      return stack;
    };

    const showAdminToast = (title, detail, tone = 'success') => {
      if (!document.body) return;
      const toast = document.createElement('div');
      toast.className = 'bpd-admin-toast bpd-admin-toast-' + tone;
      toast.innerHTML = '<p class="bpd-admin-toast-title">' + bpdEscapeHtml(title) + '</p>' + (detail ? '<p class="bpd-admin-toast-detail">' + bpdEscapeHtml(detail) + '</p>' : '');
      getToastStack().appendChild(toast);
      window.setTimeout(() => toast.dataset.leaving = 'true', 5200);
      window.setTimeout(() => toast.remove(), 6000);
    };

    const saveDraftToastPayloadFromForm = (form) => {
      const formData = new FormData(form);
      if (formData.get('intent') !== 'saveRoute') return null;
      const selectedIds = String(formData.get('selectedOrderIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
      if (!selectedIds.length) return null;
      const routeName = String(formData.get('routeName') || '').trim() || 'Draft route';
      return {
        title: 'Draft route saved',
        detail: routeName + ' · ' + selectedIds.length + ' stop' + (selectedIds.length === 1 ? '' : 's'),
      };
    };

    const watchDraftRouteSubmit = () => {
      document.addEventListener('submit', (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const payload = saveDraftToastPayloadFromForm(form);
        if (!payload) return;
        try {
          window.sessionStorage.setItem('bpdDraftRouteToast', JSON.stringify(payload));
        } catch {
          // Toast storage is a nice to have only.
        }
        showAdminToast('Saving draft route', payload.detail, 'info');
      }, true);
    };

    const showStoredDraftRouteToast = () => {
      if (!window.location.pathname.startsWith('/app/routes')) return;
      let payload = null;
      try {
        const rawPayload = window.sessionStorage.getItem('bpdDraftRouteToast');
        if (rawPayload) payload = JSON.parse(rawPayload);
        window.sessionStorage.removeItem('bpdDraftRouteToast');
      } catch {
        payload = null;
      }
      if (!payload?.title) return;
      showAdminToast(payload.title, payload.detail || 'The route has been saved and is ready to publish.', 'success');
    };

    const monthIndex = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const dateOnly = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const parseTooltipDate = (value) => {
      const match = String(value).trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
      if (!match) return null;
      const month = monthIndex[match[2].toLowerCase()];
      if (typeof month !== 'number') return null;
      return new Date(Number(match[3]), month, Number(match[1]));
    };

    const isWorkingDay = (date) => {
      const day = date.getDay();
      return day !== 0 && day !== 6;
    };

    const workingDaysLeft = (dueDate) => {
      const today = dateOnly(new Date());
      const due = dateOnly(dueDate);
      if (due < today) {
        let overdueDays = 0;
        const cursor = new Date(due);
        while (cursor < today) {
          if (isWorkingDay(cursor)) overdueDays += 1;
          cursor.setDate(cursor.getDate() + 1);
        }
        return -overdueDays;
      }
      let count = 0;
      const cursor = new Date(today);
      cursor.setDate(cursor.getDate() + 1);
      while (cursor <= due) {
        if (isWorkingDay(cursor)) count += 1;
        cursor.setDate(cursor.getDate() + 1);
      }
      return count;
    };

    const fulfilDateTone = (dateText) => {
      const dueDate = parseTooltipDate(dateText);
      if (!dueDate) return 'grey';
      const daysLeft = workingDaysLeft(dueDate);
      if (daysLeft >= 4) return 'green';
      if (daysLeft >= 2) return 'orange';
      return 'red';
    };

    const markTooltipReady = () => {
      document.querySelectorAll('.bpd-tomtom-popup .mapboxgl-popup-content').forEach((content) => {
        if (content instanceof HTMLElement) content.dataset.bpdTooltipReady = 'true';
      });
    };

    const updateFulfilmentTooltipColours = () => {
      document.querySelectorAll('.bpd-tooltip-line, .mapboxgl-popup-content div').forEach((line) => {
        if (!(line instanceof HTMLElement)) return;
        const rawText = line.textContent?.trim() || '';
        const cleanText = rawText.replace(/^[^A-Za-z0-9]*\s*/, '').trim();
        if (!cleanText.toLowerCase().startsWith('fulfil by:')) return;
        const dateText = cleanText.replace(/^fulfil by:\s*/i, '').trim();
        const tone = fulfilDateTone(dateText);
        if (line.dataset.bpdFulfilStyled === tone && line.dataset.bpdFulfilDate === dateText) return;
        line.dataset.bpdFulfilStyled = tone;
        line.dataset.bpdFulfilDate = dateText;
        line.innerHTML = '<span class="bpd-fulfil-dot bpd-fulfil-date-' + tone + '">●</span> Fulfil by: <span class="bpd-fulfil-date bpd-fulfil-date-' + tone + '">' + bpdEscapeHtml(dateText) + '</span>';
      });
      markTooltipReady();
    };

    const tidyCustomerTracking = () => {
      if (!window.location.pathname.startsWith('/apps/track/')) return;
      const pageText = document.body?.innerText || '';
      const isLive = pageText.includes('Live tracking active') && pageText.includes('You are next');
      const isEnded = pageText.includes('Tracking ended') || pageText.includes('Delivery completed') || pageText.includes('Delivery attempted');
      if (isLive || isEnded) return;
      document.querySelectorAll('span').forEach((span) => {
        if (span.textContent?.trim() !== 'Map view') return;
        const mapBox = span.closest('div[style*="min-height: 360"]');
        if (!mapBox || mapBox.getAttribute('data-bpd-tracking-locked') === 'true') return;
        mapBox.setAttribute('data-bpd-tracking-locked', 'true');
        mapBox.innerHTML = '<div style="display:grid;place-items:center;min-height:360px;padding:24px;text-align:center;background:#f8fafc;border-radius:14px;"><div><div style="width:54px;height:54px;border-radius:50%;background:#e5e7eb;display:grid;place-items:center;margin:0 auto 12px;font-size:22px;font-weight:800;color:#667085;">•</div><h2 style="margin:0 0 8px;font-size:20px;color:#323841;">Live tracking is not active yet</h2><p style="margin:0;color:#667085;max-width:420px;">For privacy, the map will only appear when your delivery is the next active drop.</p></div></div>';
      });
    };

    const tidyPlanningLabels = () => {
      document.querySelectorAll('details summary h4').forEach((heading) => {
        const summary = heading.closest('summary');
        const line = summary?.querySelector('p');
        if (line?.textContent?.trim() === 'United Kingdom') line.textContent = '';
      });

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue?.includes('Return to base after last drop')) {
          node.nodeValue = node.nodeValue.replaceAll('Return to base after last drop', 'Return to base');
        }
        node = walker.nextNode();
      }

      updateFulfilmentTooltipColours();
      tidyCustomerTracking();
      showStoredDraftRouteToast();
    };

    const startObserver = () => {
      if (!document.body) return;
      tidyPlanningLabels();
      watchDraftRouteSubmit();
      new MutationObserver(tidyPlanningLabels).observe(document.body, { childList: true, subtree: true, characterData: true });
      let runs = 0;
      const interval = window.setInterval(() => {
        tidyPlanningLabels();
        runs += 1;
        if (runs > 80) window.clearInterval(interval);
      }, 50);
    };

    document.addEventListener('mouseover', () => window.requestAnimationFrame(updateFulfilmentTooltipColours), true);
    document.addEventListener('mousemove', () => window.requestAnimationFrame(updateFulfilmentTooltipColours), true);
    document.addEventListener('touchstart', () => window.requestAnimationFrame(updateFulfilmentTooltipColours), true);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
      startObserver();
    }
    window.addEventListener('pageshow', () => {
      tidyPlanningLabels();
      showStoredDraftRouteToast();
    });
  })();
`;

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <style dangerouslySetInnerHTML={{ __html: planningPanelStyles }} />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: planningPanelScript }} />
      </body>
    </html>
  );
}
