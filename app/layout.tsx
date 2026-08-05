import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "설비 인사이트",
  description: "NVIDIA 모델 기반 설비 사진 검사 및 기록",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
