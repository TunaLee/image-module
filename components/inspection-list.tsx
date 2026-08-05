"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { InspectionRecord } from "../lib/types";

const modeLabels = { ocr: "글자 인식", visual: "특이점 판정", both: "통합 검사" } as const;
const statusLabels = { completed: "완료", partial: "일부 완료", failed: "실패" } as const;

function cardSummary(inspection: InspectionRecord): string {
  if (inspection.visualResult?.summary) return inspection.visualResult.summary;
  if (inspection.ocrResult) return `텍스트 ${inspection.ocrResult.textDetections.length}개를 인식했습니다.`;
  return inspection.errorMessage ?? "검사 결과를 불러올 수 없습니다.";
}

export function InspectionList({ refreshKey = 0 }: { refreshKey?: number }) {
  const router = useRouter();
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/inspections", { signal: controller.signal });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = (await response.json()) as { inspections?: InspectionRecord[]; error?: string };
        if (!response.ok) throw new Error(payload.error);
        setInspections((payload.inspections ?? []).slice(0, 6));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError("검사 기록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [refreshKey, router]);

  return (
    <section className="history-section" aria-labelledby="history-heading">
      <div className="section-heading history-heading">
        <div>
          <p className="eyebrow">RECENT HISTORY</p>
          <h2 id="history-heading">최근 검사</h2>
        </div>
        <span className="history-count">최근 {Math.min(inspections.length, 6)}건</span>
      </div>

      {loading ? (
        <div className="empty-state">검사 기록을 불러오는 중입니다…</div>
      ) : error ? (
        <div className="empty-state error-message">{error}</div>
      ) : inspections.length === 0 ? (
        <div className="empty-state"><strong>아직 검사 기록이 없습니다.</strong><span>첫 사진을 올려 설비 상태를 기록해 보세요.</span></div>
      ) : (
        <div className="inspection-grid">
          {inspections.map((inspection) => (
            <Link className="inspection-card" href={`/inspections/${inspection.id}`} key={inspection.id}>
              <div className="card-image">
                <Image src={inspection.imagePath} alt="검사 설비 사진" fill sizes="(max-width: 760px) 100vw, 33vw" />
                <span className={`status-badge ${inspection.status}`}>{statusLabels[inspection.status]}</span>
              </div>
              <div className="card-content">
                <div className="card-meta">
                  <span>{modeLabels[inspection.mode]}</span>
                  <time dateTime={inspection.createdAt}>
                    {new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(inspection.createdAt))}
                  </time>
                </div>
                <h3>{inspection.visualResult?.verdict === "abnormal" ? "특이점 발견" : inspection.visualResult?.verdict === "normal" ? "정상 범위" : modeLabels[inspection.mode]}</h3>
                <p>{cardSummary(inspection)}</p>
                <span className="detail-link">상세 결과 보기 <span aria-hidden="true">→</span></span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
