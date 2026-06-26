import type { Metadata } from 'next';
import 'driver.js/dist/driver.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Telegram Bot Tracker - Quản lý Nhóm & Chủ đề',
  description: 'Dashboard giám sát nhóm và chủ đề Telegram tự động bằng Bot API',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
