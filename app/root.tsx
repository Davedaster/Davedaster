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
      </body>
    </html>
  );
}
