"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

import type { InspectionMode, InspectionRecord } from "../lib/types";

type Dimensions = { width: number; height: number };

export function resizedDimensions(
  width: number,
  height: number,
  maxEdge = 640,
): Dimensions {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function decodeImage(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: "from-image" });
}

export async function resizeImage(file: File, maxEdge = 640): Promise<File> {
  const image = await decodeImage(file);
  try {
    const dimensions = resizedDimensions(image.width, image.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 변환을 시작할 수 없습니다.");
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.88),
    );
    if (!blob) throw new Error("JPEG 이미지를 만들지 못했습니다.");

    const stem = file.name.replace(/\.[^.]+$/, "") || "inspection";
    return new File([blob], `${stem}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    image.close();
  }
}

const modeOptions: { value: InspectionMode; label: string; description: string }[] = [
  { value: "visual", label: "특이점 판정", description: "외관 이상과 기준 충족 여부" },
  { value: "ocr", label: "글자 인식", description: "문자와 위치 좌표 추출" },
  { value: "both", label: "둘 다", description: "판정과 글자 인식을 함께" },
];

export function InspectionForm({
  onCreated,
}: {
  onCreated: (inspection: InspectionRecord) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<InspectionMode>("visual");
  const [criterion, setCriterion] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;

    setPending(true);
    setMessage("사진을 검사 크기로 준비하고 있습니다…");
    try {
      const resized = await resizeImage(selected);
      setFile(resized);
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return URL.createObjectURL(resized);
      });
      setMessage("긴 변 640px 이하의 JPEG로 준비했습니다.");
    } catch {
      setFile(null);
      setMessage("사진을 처리하지 못했습니다. 다른 사진을 선택해 주세요.");
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setMessage("검사할 사진을 먼저 선택해 주세요.");
      return;
    }
    if ((mode === "visual" || mode === "both") && !criterion.trim()) {
      setMessage("특이점 판정 기준을 적어 주세요.");
      return;
    }

    setPending(true);
    setMessage("NVIDIA 모델이 사진을 검사하고 있습니다…");
    const formData = new FormData();
    formData.append("image", file);
    formData.append("mode", mode);
    formData.append("criterion", criterion.trim());

    try {
      const response = await fetch("/api/inspections", { method: "POST", body: formData });
      const payload = (await response.json()) as {
        inspection?: InspectionRecord;
        error?: string;
      };

      if (!response.ok || !payload.inspection) {
        setMessage(payload.error ?? "검사를 완료하지 못했습니다.");
        return;
      }

      onCreated(payload.inspection);
      setMessage(
        payload.inspection.status === "partial"
          ? "검사 일부가 완료되었습니다. 결과 카드에서 확인해 주세요."
          : payload.inspection.status === "failed"
            ? "모델 판정에 실패했습니다. 기록에서 상세 오류를 확인해 주세요."
            : "검사가 완료되어 기록에 저장되었습니다.",
      );
      setFile(null);
      setPreviewUrl(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      setMessage("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel inspection-panel" aria-labelledby="new-inspection-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">NEW INSPECTION</p>
          <h2 id="new-inspection-heading">새 설비 검사</h2>
        </div>
        <span className="step-chip">640px JPEG</span>
      </div>

      <form onSubmit={handleSubmit} className="inspection-form">
        <label className={`photo-drop ${previewUrl ? "has-photo" : ""}`}>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhoto}
            disabled={pending}
          />
          {previewUrl ? (
            // Blob previews cannot be statically analyzed by next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="검사할 사진 미리보기" />
          ) : (
            <span className="photo-placeholder" aria-hidden="true">+</span>
          )}
          <span className="photo-copy">
            <strong>{previewUrl ? "사진 바꾸기" : "사진 촬영 또는 선택"}</strong>
            <small>휴대폰에서는 후면 카메라가 열립니다</small>
          </span>
        </label>

        <fieldset className="mode-fieldset">
          <legend>검사 유형</legend>
          <div className="mode-grid">
            {modeOptions.map((option) => (
              <label key={option.value} className={`mode-option ${mode === option.value ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  disabled={pending}
                />
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field-label">
          <span>
            판정 기준
            {mode === "ocr" && <small className="optional">선택</small>}
          </span>
          <textarea
            value={criterion}
            onChange={(event) => setCriterion(event.target.value)}
            placeholder="예: 배관 연결부의 누유, 균열, 부식 여부를 확인하고 압력계가 정상 범위인지 판정"
            rows={4}
            required={mode !== "ocr"}
            disabled={pending}
          />
        </label>

        <button className="primary-button inspect-button" type="submit" disabled={pending}>
          {pending ? "처리 중…" : "검사 시작"}
          <span aria-hidden="true">→</span>
        </button>
        {message && <p className="form-message" aria-live="polite">{message}</p>}
      </form>
    </section>
  );
}
