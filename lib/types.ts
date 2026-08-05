export type InspectionMode = "ocr" | "visual" | "both";

export type ImagePoint = { x: number; y: number };

export type OcrDetectionResult = {
  imageWidth: number;
  imageHeight: number;
  textDetections: {
    text: string;
    confidence: number;
    boundingBox: { points: ImagePoint[] };
  }[];
};

export type OcrSemanticResult = {
  equipmentNameOrId: string | null;
  observedAt: string | null;
  readings: {
    label: string;
    value: string;
    unit: string | null;
  }[];
  statusMessages: string[];
  otherText: string[];
  confidence: number | null;
};

export type OcrResult = OcrDetectionResult & OcrSemanticResult;

export type VisualResult = {
  verdict: "normal" | "abnormal" | "indeterminate";
  summary: string;
  findings: {
    locationDescription: string;
    severity: "low" | "medium" | "high";
    evidence: string;
  }[];
  criteriaAssessment: string;
  confidence: number | null;
};

export type InspectionRecord = {
  id: string;
  imagePath: string;
  mode: InspectionMode;
  criterion: string | null;
  ocrResult: OcrResult | null;
  visualResult: VisualResult | null;
  status: "completed" | "partial" | "failed";
  errorMessage: string | null;
  createdAt: string;
};
