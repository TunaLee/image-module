"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { InspectionForm } from "../components/inspection-form";
import { InspectionList } from "../components/inspection-list";

type SessionUser = { id: string; email: string };

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { signal: controller.signal });
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const payload = (await response.json()) as { user: SessionUser };
        setUser(payload.user);
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    void loadSession();
    return () => controller.abort();
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function handleCreated() {
    setRefreshKey((value) => value + 1);
  }

  if (loading || !user) {
    return <main className="loading-shell"><div className="loader" aria-hidden="true" /><p>검사 대시보드를 여는 중입니다…</p></main>;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand"><span className="brand-mark" aria-hidden="true">EI</span><span>설비 인사이트</span></div>
          <div className="user-menu"><span>{user.email}</span><button type="button" onClick={logout}>로그아웃</button></div>
        </div>
      </header>
      <main className="dashboard">
        <header className="dashboard-heading">
          <div><p className="eyebrow">EQUIPMENT INSPECTION</p><h1>설비 상태를<br className="mobile-break" /> 사진으로 확인하세요.</h1></div>
          <p>사진을 촬영하고 판정 기준을 입력하면 특이점과 글자를 분석해 기록합니다.</p>
        </header>
        <InspectionForm onCreated={handleCreated} />
        <InspectionList refreshKey={refreshKey} />
      </main>
    </div>
  );
}
