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

  body.bpd-map-scroll-locked {
    position: fixed;
    left: 0;
    right: 0;
    width: 100%;
    overflow: hidden;
    touch-action: none;
  }

  .bpd-tomtom-map,
  .bpd-tomtom-map * {
    overscroll-behavior: contain;
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
    let touchingMap = false;
    let lockedScrollY = 0;

    const isMapTouch = (target) => Boolean(target?.closest?.('.bpd-tomtom-map'));

    const lockPageForMap = () => {
      if (document.body.classList.contains('bpd-map-scroll-locked')) {
        return;
      }

      lockedScrollY = window.scrollY || window.pageYOffset || 0;
      document.body.dataset.bpdMapScrollY = String(lockedScrollY);
      document.body.style.top = '-' + lockedScrollY + 'px';
      document.body.classList.add('bpd-map-scroll-locked');
      document.documentElement.style.overscrollBehaviorY = 'none';
      document.body.style.overscrollBehaviorY = 'none';
    };

    const unlockPageForMap = () => {
      if (!document.body.classList.contains('bpd-map-scroll-locked')) {
        return;
      }

      const restoreY = Number(document.body.dataset.bpdMapScrollY || lockedScrollY || 0);
      document.body.classList.remove('bpd-map-scroll-locked');
      document.body.style.top = '';
      document.body.style.overscrollBehaviorY = '';
      document.documentElement.style.overscrollBehaviorY = '';
      delete document.body.dataset.bpdMapScrollY;
      window.scrollTo(0, Number.isFinite(restoreY) ? restoreY : 0);
    };

    const blockMapPullRefresh = (event) => {
      if (!touchingMap && !isMapTouch(event.target)) {
        return;
      }

      touchingMap = true;
      lockPageForMap();

      if (event.cancelable) {
        event.preventDefault();
      }
    };

    document.addEventListener('touchstart', (event) => {
      touchingMap = isMapTouch(event.target);

      if (touchingMap) {
        lockPageForMap();

        if (event.cancelable) {
          event.preventDefault();
        }
      }
    }, { passive: false, capture: true });

    document.addEventListener('touchmove', blockMapPullRefresh, { passive: false, capture: true });

    document.addEventListener('touchend', () => {
      touchingMap = false;
      unlockPageForMap();
    }, { passive: true, capture: true });

    document.addEventListener('touchcancel', () => {
      touchingMap = false;
      unlockPageForMap();
    }, { passive: true, capture: true });

    window.addEventListener('blur', () => {
      touchingMap = false;
      unlockPageForMap();
    });

    const tidyCustomerTracking = () => {
      if (!window.location.pathname.startsWith('/apps/track/')) {
        return;
      }

      const trackingTextNodes = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();

      while (node) {
        trackingTextNodes.push(node);
        node = walker.nextNode();
      }

      const pageText = document.body?.innerText || '';
      const isLive = pageText.includes('Live tracking active') && pageText.includes('You are next');
      const isEnded = pageText.includes('Tracking ended') || pageText.includes('Delivery completed') || pageText.includes('Delivery attempted');

      trackingTextNodes.forEach((textNode) => {
        if (!isLive && textNode.nodeValue?.includes('Tracking active')) {
          textNode.nodeValue = textNode.nodeValue.replaceAll('Tracking active', 'Tracking not live yet');
        }

        if (!isLive && textNode.nodeValue?.includes('Route active')) {
          textNode.nodeValue = textNode.nodeValue.replaceAll('Route active', 'Route active, tracking not live yet');
        }

        if (!isLive && textNode.nodeValue?.includes('Activates when next')) {
          textNode.nodeValue = textNode.nodeValue.replaceAll('Activates when next', 'Tracking locked');
        }
      });

      if (isLive || isEnded) {
        return;
      }

      document.querySelectorAll('span').forEach((span) => {
        if (span.textContent?.trim() !== 'Map view') {
          return;
        }

        const mapBox = span.closest('div[style*="min-height: 360"]');

        if (!mapBox || mapBox.getAttribute('data-bpd-tracking-locked') === 'true') {
          return;
        }

        mapBox.setAttribute('data-bpd-tracking-locked', 'true');
        mapBox.innerHTML = '<div style="display:grid;place-items:center;min-height:360px;padding:24px;text-align:center;background:#f8fafc;border-radius:14px;"><div><div style="width:54px;height:54px;border-radius:50%;background:#e5e7eb;display:grid;place-items:center;margin:0 auto 12px;font-size:22px;font-weight:800;color:#667085;">•</div><h2 style="margin:0 0 8px;font-size:20px;color:#323841;">Live tracking is not active yet</h2><p style="margin:0;color:#667085;max-width:420px;">For privacy, the map will only appear when your delivery is the next active drop.</p></div></div>';
      });
    };

    const tidyPlanningLabels = () => {
      document.querySelectorAll('details summary h4').forEach((heading) => {
        const summary = heading.closest('summary');
        const line = summary?.querySelector('p');

        if (line?.textContent?.trim() === 'United Kingdom') {
          line.textContent = '';
        }
      });

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      let node = walker.nextNode();

      while (node) {
        textNodes.push(node);
        node = walker.nextNode();
      }

      textNodes.forEach((textNode) => {
        if (textNode.nodeValue?.includes('Return to base after last drop')) {
          textNode.nodeValue = textNode.nodeValue.replaceAll('Return to base after last drop', 'Return to base');
        }
      });

      tidyCustomerTracking();
    };

    const startObserver = () => {
      if (!document.body) {
        return;
      }

      tidyPlanningLabels();
      new MutationObserver(tidyPlanningLabels).observe(document.body, { childList: true, subtree: true, characterData: true });

      let runs = 0;
      const interval = window.setInterval(() => {
        tidyPlanningLabels();
        runs += 1;

        if (runs > 40) {
          window.clearInterval(interval);
        }
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
