import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import './wafu.css';
import './wafu-opening.css';
import './wafu-media.css';
import './wafu-assistant.css';
import './wafu-mobile.css';
import './wafu-sections.css';
import './wafu-tone.css';
import { wafuBootScript, wafuFontsHref } from '@/lib/wafu/theme';
import StaticOpening from '@/components/wafu/opening/StaticOpening';

const title = 'OptionFlow — Visual Options Tracker';
const description = '可編輯與儲存的選擇權持倉追蹤工具，包含股票報價更新、週月年收益、SPY／BOXX 比較與持倉圓餅圖。';

// Phones: draw under the notch and home indicator (the page pads itself with the safe-area insets).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0c0d11' };

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const host = headerList.get('host') ?? '';
  const trustedHost = host === 'localhost:3000' || host.endsWith('.openai.com') || host.endsWith('.chatgpt.com') || host.endsWith('.chatgpt-team.site');
  const origin = trustedHost ? `${host.startsWith('localhost') ? 'http' : 'https'}://${host}` : 'https://chatgpt.com';
  const image = new URL('/og.png', origin).toString();
  return {
    metadataBase: new URL(origin),
    title,
    description,
    icons: { icon: '/optionflow-logo.png' },
    openGraph: { title, description, type: 'website', images: [{ url: image, width: 1200, height: 630, alt: 'OPTIONFLOW — 桐生桔梗' }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

// Installable on Android (manifest) and iOS (Add to Home Screen: full screen, dark status bar). Written into
// <head> directly because the metadata API streams these tags into <body>, where browsers may ignore them.
const appHead = <>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="OptionFlow" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
</>;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The server renders 桔梗; the boot script switches <html data-wafu> to the chosen theme before the first paint.
  return <html lang="zh-Hant" data-wafu="kikyo" suppressHydrationWarning><head>{appHead}<link id="wafu-fonts" rel="stylesheet" href={wafuFontsHref} /><script dangerouslySetInnerHTML={{ __html: wafuBootScript }} /></head><body><StaticOpening />{children}</body></html>;
}
