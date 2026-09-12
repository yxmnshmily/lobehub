import { SpeedInsights } from '@vercel/speed-insights/next';
import type { Viewport } from 'next';
import { type ReactNode, Suspense } from 'react';

import Analytics from '@/components/Analytics';

const inVercel = process.env.VERCEL === '1';

/*
 * First-paint placeholder for the site header. The header is injected by
 * site-shell.js after boot, so without this every server-rendered page shows
 * full-height content for a beat and then pushes it down. Mirrors the
 * placeholder in index.html (the SPA entry).
 */
const BOOT_HEADER_CSS = `#boot-header{position:fixed;z-index:2;inset-block-start:0;inset-inline:0;box-sizing:border-box;height:72px;background:#fff;border-block-end:0.5px solid rgba(15,17,21,.06)}html[data-theme='dark'] #boot-header{background:#141414;border-block-end-color:rgba(255,255,255,.08)}`;

const BOOT_HEADER_SCRIPT = `(function(){var p=document.getElementById('boot-header');if(!p)return;var s=Date.now();var r=function(){return document.querySelector('.site-header,[data-site-header]')};var d=function(h){if(!p)return;h?p.remove():p.style.display='none'};var t=function(){if(r())return d(false);if(Date.now()-s>8000)return d(true);setTimeout(t,150)};t()})();`;

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: 'cover',
  width: 'device-width',
};

const RootLayout = ({ children }: { children: ReactNode }) => {
  return (
    <html suppressHydrationWarning lang={'en'} style={{ height: '100%' }}>
      <body style={{ height: '100%', margin: 0 }}>
        <style dangerouslySetInnerHTML={{ __html: BOOT_HEADER_CSS }} />
        <div aria-hidden="true" id="boot-header" />
        {children}
        <script dangerouslySetInnerHTML={{ __html: BOOT_HEADER_SCRIPT }} />
        <Suspense fallback={null}>
          <Analytics />
          {inVercel && <SpeedInsights />}
        </Suspense>
      </body>
    </html>
  );
};

export default RootLayout;
