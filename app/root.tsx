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
    overscroll-behavior: none;
  }

  body.bpd-map-scroll-locked {
    position: fixed;
    left: 0;
    right: 0;
    width: 100%;
    overflow: hidden;
    touch-action: none;
  }

  html.bpd-map-scroll-locked-html {
    overflow: hidden !important;
    overscroll-behavior: none !important;
  }

  .bpd-scroll-container-locked {
    overflow: hidden !important;
    overscroll-behavior: contain !important;
    touch-action: none !important;
  }

  .bpd-tomtom-map,
  .bpd-tomtom-map * {
    overscroll-behavior: contain;
  }

  .bpd-tomtom-map {
    contain: layout paint;
    isolation: isolate;
    transform: translateZ(0);
  }

  .bpd-tomtom-map .mapboxgl-map,
  .bpd-tomtom-map .mapboxgl-canvas-container,
  .bpd-tomtom-map .mapboxgl-canvas {
    overscroll-behavior: contain !important;
  }

  .bpd-tomtom-popup .mapboxgl-popup-content {
    opacity: 0;
  }

  .bpd-tomtom-popup .mapboxgl-popup-content[data-bpd-tooltip-ready="true"] {
    opacity: 1;
  }

  .bpd-fulfil-date { font-weight: 800; }
  .bpd-fulfil-date-green { color: #16a34a; }
  .bpd-fulfil-date-orange { color: #f97316; }
  .bpd-fulfil-date-red { color: #b42318; }
  .bpd-fulfil-date-grey { color: #667085; }

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
    let unlockTimer = null;
    let lastMapMoveAt = 0;
    const lockedScrollContainers = [];

    const isMapEvent = (target) => Boolean(target?.closest?.('.bpd-tomtom-map'));
    const shouldUseMobileMapLock = () => window.matchMedia?.('(max-width: 800px), (pointer: coarse)')?.matches === true;

    const cancelScheduledUnlock = () => {
      if (unlockTimer) {
        window.clearTimeout(unlockTimer);
        unlockTimer = null;
      }
    };

    const lockScrollableElement = (element) => {
      if (!element || element.dataset?.bpdScrollLocked === 'true') return;
      const style = window.getComputedStyle(element);
      const canScroll = element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2;
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY + style.overflowX);
      if (!canScroll || !scrollable || element.closest?.('.bpd-tomtom-map')) return;
      lockedScrollContainers.push({ element, overflow: element.style.overflow, overflowY: element.style.overflowY, overflowX: element.style.overflowX, overscrollBehavior: element.style.overscrollBehavior, touchAction: element.style.touchAction, scrollTop: element.scrollTop, scrollLeft: element.scrollLeft });
      element.dataset.bpdScrollLocked = 'true';
      element.classList.add('bpd-scroll-container-locked');
      element.style.overflow = 'hidden';
      element.style.overflowY = 'hidden';
      element.style.overflowX = 'hidden';
      element.style.overscrollBehavior = 'contain';
      element.style.touchAction = 'none';
    };

    const lockScrollableContainers = (target) => {
      let element = target?.parentElement;
      while (element && element !== document.body && element !== document.documentElement) {
        lockScrollableElement(element);
        element = element.parentElement;
      }
      document.querySelectorAll('[style*="overflow"], .Polaris-Frame, .Polaris-Page, main, section').forEach(lockScrollableElement);
    };

    const unlockScrollableContainers = () => {
      while (lockedScrollContainers.length) {
        const lock = lockedScrollContainers.pop();
        if (!lock?.element) continue;
        lock.element.classList.remove('bpd-scroll-container-locked');
        lock.element.style.overflow = lock.overflow;
        lock.element.style.overflowY = lock.overflowY;
        lock.element.style.overflowX = lock.overflowX;
        lock.element.style.overscrollBehavior = lock.overscrollBehavior;
        lock.element.style.touchAction = lock.touchAction;
        lock.element.scrollTop = lock.scrollTop;
        lock.element.scrollLeft = lock.scrollLeft;
        delete lock.element.dataset.bpdScrollLocked;
      }
    };

    const lockPageForMap = (target) => {
      if (!shouldUseMobileMapLock()) return;
      cancelScheduledUnlock();
      if (!document.body.classList.contains('bpd-map-scroll-locked')) {
        lockedScrollY = window.scrollY || window.pageYOffset || 0;
        document.body.dataset.bpdMapScrollY = String(lockedScrollY);
        document.body.style.top = '-' + lockedScrollY + 'px';
        document.body.classList.add('bpd-map-scroll-locked');
        document.documentElement.classList.add('bpd-map-scroll-locked-html');
      }
      lockScrollableContainers(target);
    };

    const unlockPageForMapNow = () => {
      cancelScheduledUnlock();
      unlockScrollableContainers();
      document.documentElement.classList.remove('bpd-map-scroll-locked-html');
      if (!document.body.classList.contains('bpd-map-scroll-locked')) return;
      const restoreY = Number(document.body.dataset.bpdMapScrollY || lockedScrollY || 0);
      document.body.classList.remove('bpd-map-scroll-locked');
      document.body.style.top = '';
      delete document.body.dataset.bpdMapScrollY;
      window.scrollTo(0, Number.isFinite(restoreY) ? restoreY : 0);
    };

    const scheduleMapUnlock = () => {
      if (!shouldUseMobileMapLock()) return;
      cancelScheduledUnlock();
      const movedRecently = Date.now() - lastMapMoveAt < 350;
      unlockTimer = window.setTimeout(unlockPageForMapNow, movedRecently ? 1400 : 650);
    };

    const blockMapPullRefresh = (event) => {
      if (!touchingMap && !isMapEvent(event.target)) return;
      touchingMap = true;
      lastMapMoveAt = Date.now();
      if (shouldUseMobileMapLock()) lockPageForMap(event.target);
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };

    const containDesktopMapGesture = (event) => {
      if (!isMapEvent(event.target)) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const containSafariGesture = (event) => {
      if (!isMapEvent(event.target)) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    document.addEventListener('wheel', containDesktopMapGesture, { passive: false, capture: true });
    document.addEventListener('gesturestart', containSafariGesture, { passive: false, capture: true });
    document.addEventListener('gesturechange', containSafariGesture, { passive: false, capture: true });
    document.addEventListener('gestureend', containSafariGesture, { passive: false, capture: true });

    document.addEventListener('touchstart', (event) => {
      touchingMap = isMapEvent(event.target);
      if (touchingMap) {
        lastMapMoveAt = Date.now();
        if (shouldUseMobileMapLock()) lockPageForMap(event.target);
      }
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', blockMapPullRefresh, { passive: false, capture: true });
    document.addEventListener('touchend', () => { if (touchingMap) { touchingMap = false; scheduleMapUnlock(); return; } touchingMap = false; }, { passive: true, capture: true });
    document.addEventListener('touchcancel', () => { touchingMap = false; scheduleMapUnlock(); }, { passive: true, capture: true });
    window.addEventListener('blur', () => { touchingMap = false; unlockPageForMapNow(); });

    const bpdEscapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const monthIndex = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const dateOnly = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

    const parseTooltipDate = (value) => {
      const match = String(value).trim().match(/^(\\d{1,2})\\s+([A-Za-z]{3})\\s+(\\d{4})$/);
      if (!match) return null;
      const month = monthIndex[match[2].toLowerCase()];
      if (typeof month !== 'number') return null;
      return new Date(Number(match[3]), month, Number(match[1]));
    };

    const isWorkingDay = (date) => ![0, 6].includes(date.getDay());

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
        if (!(line instanceof HTMLElement) || line.dataset.bpdFulfilStyled === 'true') return;
        const rawText = line.textContent?.trim() || '';
        const cleanText = rawText.replace(/^[^A-Za-z0-9]*\\s*/, '').trim();
        if (!cleanText.toLowerCase().startsWith('fulfil by:')) return;
        const dateText = cleanText.replace(/^fulfil by:\\s*/i, '').trim();
        const tone = fulfilDateTone(dateText);
        line.dataset.bpdFulfilStyled = 'true';
        line.innerHTML = 'Fulfil by: <span class="bpd-fulfil-date bpd-fulfil-date-' + tone + '">' + bpdEscapeHtml(dateText) + '</span>';
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
        if (node.nodeValue?.includes('Return to base after last drop')) node.nodeValue = node.nodeValue.replaceAll('Return to base after last drop', 'Return to base');
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
      const interval = window.setInterval(() => { tidyPlanningLabels(); runs += 1; if (runs > 80) window.clearInterval(interval); }, 250);
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    else startObserver();
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
