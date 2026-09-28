import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import './wafu-palette.css';
import './wafu.css';
import { wafuBootScript } from '@/lib/wafu/theme';

const title = 'OptionFlow — Visual Options Tracker';
const description = '可編輯與儲存的選擇權持倉追蹤工具，包含股票報價更新、週月年收益、SPY／BOXX 比較與持倉圓餅圖。';

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
    icons: { icon: '/optionflow-logo.jpg', apple: '/optionflow-logo.jpg' },
    openGraph: { title, description, type: 'website', images: [{ url: image, width: 1200, height: 630, alt: 'OPTIONFLOW — 桐生桔梗' }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The boot script marks <html data-wafu> before the first paint, so React leaves that attribute alone.
  return <html lang="zh-Hant" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: wafuBootScript }} /></head><body>{children}</body></html>;
}
