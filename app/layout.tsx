import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "坦克动荡 | Tank Turmoil",
  description: "使用 Next.js 和 Canvas 实现的坦克动荡游戏",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
