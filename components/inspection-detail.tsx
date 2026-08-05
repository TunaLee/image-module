"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { InspectionRecord, OcrResult } from "../lib/types";

const verdictLabels = { normal: "정상", abnormal: "이상", indeterminate: "판정 불가" } as const;
const severityLabels = { low: "낮음", medium: "중간", high: "높음" } as const;

export function OcrImage({
  imagePath,
  ocr,
}: {
  imagePath: string;
  ocr: OcrResult | null;
}) {
  return (
    <div
      className="result-photo"
      style={{
        aspectRatio: ocr ? `${ocr.imageWidth} / ${ocr.imageHeight}` : "4 / 3",
        minHeight: 0,
      }}
    >
      <Image
        src={imagePath}
        alt="검사한 설비"
        fill
        sizes="(max-width: 900px) 100vw, 52vw"
        priority
      />
      {ocr && (
        <svg
          className="ocr-overlay"
          viewBox={`0 0 ${ocr.imageWidth} ${ocr.imageHeight}`}
          aria-label="인식 글자 영역"
        >
          {ocr.textDetections.map((detection, index) => (
            <polygon
              key={`${detection.text}-${index}`}
              points={detection.boundingBox.points
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
            />
          ))}
        </svg>
      )}
    </div>
  );
}

export function OcrResultPanel({ ocr }: { ocr: OcrResult }) {
  const readings = ocr.readings ?? [];
  const statusMessages = ocr.statusMessages ?? [];
  const otherText = ocr.otherText ?? [];

  return (
    <section className="panel result-panel" aria-labelledby="ocr-heading">
      <div className="result-title-row">
        <div>
          <p className="eyebrow">STRUCTURED OCR</p>
          <h2 id="ocr-heading">글자 인식</h2>
        </div>
        <span className="detection-count">{ocr.textDetections.length}개</span>
      </div>

      <dl className="result-facts ocr-facts">
        <div>
          <dt>설비명 / 번호</dt>
          <dd>{ocr.equipmentNameOrId ?? "인식되지 않음"}</dd>
        </div>
        <div>
          <dt>표기 일시</dt>
          <dd>{ocr.observedAt ?? "인식되지 않음"}</dd>
        </div>
        <div>
          <dt>측정값</dt>
          <dd>
            {readings.length === 0 ? (
              "인식되지 않음"
            ) : (
              <ul className="ocr-values">
                {readings.map((reading, index) => (
                  <li key={`${reading.label}-${index}`}>
                    <span>{reading.label}</span>
                    <strong>
                      {reading.value}
                      {reading.unit ? ` ${reading.unit}` : ""}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt>경고 / 상태</dt>
          <dd>{statusMessages.length > 0 ? statusMessages.join(" · ") : "없음"}</dd>
        </div>
        <div>
          <dt>기타 텍스트</dt>
          <dd>{otherText.length > 0 ? otherText.join(" · ") : "없음"}</dd>
        </div>
        <div>
          <dt>종합 신뢰도</dt>
          <dd>{ocr.confidence == null ? "제공되지 않음" : `${Math.round(ocr.confidence * 100)}%`}</dd>
        </div>
      </dl>

      <details className="raw-detections">
        <summary>원문과 좌표 보기</summary>
        <p className="image-size">
          원본 좌표계 {ocr.imageWidth} × {ocr.imageHeight}px · 이미지 위 박스로 위치 표시
        </p>
        {ocr.textDetections.length === 0 ? (
          <p className="empty-inline">인식된 글자가 없습니다.</p>
        ) : (
          <div className="detection-list">
            {ocr.textDetections.map((detection, index) => (
              <article key={`${detection.text}-${index}`}>
                <div className="detection-index">{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <strong>{detection.text}</strong>
                  <p>신뢰도 {Math.round(detection.confidence * 100)}%</p>
                  <code>
                    {detection.boundingBox.points
                      .map((point) => `(${Math.round(point.x)}, ${Math.round(point.y)})`)
                      .join(" · ")}
                  </code>
                </div>
              </article>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}

export function InspectionDetail({ id }: { id: string }) {
  const router = useRouter();
  const [inspection, setInspection] = useState<InspectionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/inspections/${encodeURIComponent(id)}`, { signal: controller.signal });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = (await response.json()) as { inspection?: InspectionRecord; error?: string };
        if (!response.ok || !payload.inspection) {
          setError(response.status === 404 ? "검사 기록을 찾을 수 없습니다." : "검사 기록을 불러오지 못했습니다.");
          return;
        }
        setInspection(payload.inspection);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError("서버에 연결하지 못했습니다.");
      }
    }
    void load();
    return () => controller.abort();
  }, [id, router]);

  if (error) return <main className="detail-shell"><Link href="/" className="back-link">← 대시보드</Link><div className="empty-state error-message">{error}</div></main>;
  if (!inspection) return <main className="detail-shell"><div className="empty-state">검사 결과를 불러오는 중입니다…</div></main>;

  const ocr = inspection.ocrResult;
  const visual = inspection.visualResult;
  const createdAt = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short" }).format(new Date(inspection.createdAt));

  return (
    <main className="detail-shell">
      <Link href="/" className="back-link">← 대시보드로 돌아가기</Link>
      <header className="detail-header">
        <div>
          <p className="eyebrow">INSPECTION DETAIL</p>
          <h1>검사 상세 결과</h1>
          <p>{createdAt}</p>
        </div>
        <span className={`status-badge static ${inspection.status}`}>{inspection.status === "completed" ? "완료" : inspection.status === "partial" ? "일부 완료" : "실패"}</span>
      </header>

      <div className="detail-layout">
        <section className="panel result-photo-panel" aria-label="검사 이미지">
          <OcrImage imagePath={inspection.imagePath} ocr={ocr} />
          {inspection.criterion && <div className="criterion-box"><span>판정 기준</span><p>{inspection.criterion}</p></div>}
        </section>

        <div className="result-stack">
          {visual && (
            <section className="panel result-panel" aria-labelledby="visual-heading">
              <div className="result-title-row">
                <div><p className="eyebrow">VISUAL ANALYSIS</p><h2 id="visual-heading">특이점 판정</h2></div>
                <span className={`verdict ${visual.verdict}`}>{verdictLabels[visual.verdict]}</span>
              </div>
              <p className="result-summary">{visual.summary}</p>
              <dl className="result-facts">
                <div><dt>기준 대비 판정</dt><dd>{visual.criteriaAssessment}</dd></div>
                <div><dt>신뢰도</dt><dd>{visual.confidence === null ? "제공되지 않음" : `${Math.round(visual.confidence * 100)}%`}</dd></div>
              </dl>
              {visual.findings.length > 0 && <div className="findings"><h3>발견된 특이점</h3>{visual.findings.map((finding, index) => <article key={`${finding.locationDescription}-${index}`}><span className={`severity ${finding.severity}`}>{severityLabels[finding.severity]}</span><div><strong>{finding.locationDescription}</strong><p>{finding.evidence}</p></div></article>)}</div>}
            </section>
          )}

          {ocr && <OcrResultPanel ocr={ocr} />}

          {inspection.errorMessage && <section className="panel warning-panel"><strong>일부 처리가 완료되지 않았습니다.</strong><p>{inspection.errorMessage}</p></section>}
        </div>
      </div>
    </main>
  );
}
