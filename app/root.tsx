import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

const planningPanelStyles = `
  details:has(> summary[style*="list-style"] h3) {
    border: 1px solid #d0d5dd;
    border-radius: 12px;
    padding: 12px;
  }

  details:has(> summary[style*="list-style"] h3) > summary p {
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
          textNode.nodeValue = textNode.nodeValue.replace('Return to base after last drop', 'Return to base');
        }
      });
    };

    const observer = new MutationObserver(tidyPlanningLabels);

    document.addEventListener('DOMContentLoaded', tidyPlanningLabels);
    window.addEventListener('pageshow', tidyPlanningLabels);

    if (document.body) {
      tidyPlanningLabels();
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
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
