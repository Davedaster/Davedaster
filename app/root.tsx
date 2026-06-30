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

  .bpd-fulfil-date {
    font-weight: 800;
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

    const monthIndex = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const dateOnly = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const parseTooltipDate = (value) => {
      const match = String(value).trim().match(/^(\\d{1,2})\\s+([A-Za-z]{3})\\s+(\\d{4})$/);
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

    const updateFulfilmentTooltipColours = () => {
      document.querySelectorAll('.bpd-tooltip-line, .mapboxgl-popup-content div').forEach((line) => {
        if (!(line instanceof HTMLElement) || line.dataset.bpdFulfilStyled === 'true') return;
        const rawText = line.textContent?.trim() || '';
        const cleanText = rawText.replace(/^[^A-Za-z0-9]*\\s*/, '').trim();
        if (!cleanText.toLowerCase().startsWith('fulfil by:')) return;
        const dateText = cleanText.replace(/^fulfil by:\\s*/i, '').trim();
        const tone = fulfilDateTone(dateText);
        line.dataset.bpdFulfilStyled = 'true';
        line.innerHTML = 'Fulfil by: <span class="bpd-fulfil-date bpd-fulfil-date-' + tone + '">' + bpdEscapeHtml(dateText) + '</span>';
      });
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
    };

    const startObserver = () => {
      if (!document.body) return;
      tidyPlanningLabels();
      new MutationObserver(tidyPlanningLabels).observe(document.body, { childList: true, subtree: true, characterData: true });
      let runs = 0;
      const interval = window.setInterval(() => {
        tidyPlanningLabels();
        runs += 1;
        if (runs > 80) window.clearInterval(interval);
      }, 250);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
      startObserver();
    }
    window.addEventListener('pageshow', tidyPlanningLabels);
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
