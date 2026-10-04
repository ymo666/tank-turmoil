import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "坦克大战 | Tank Battle",
  description: "使用 Next.js 和 Canvas 实现的坦克大战游戏",
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
