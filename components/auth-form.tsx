"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "요청을 처리하지 못했습니다.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-intro">
        <Link className="brand" href="/" aria-label="설비 인사이트 홈">
          <span className="brand-mark" aria-hidden="true">EI</span>
          <span>설비 인사이트</span>
        </Link>
        <div>
          <p className="eyebrow">EQUIPMENT VISION</p>
          <h1>사진 한 장으로<br />설비 상태를 기록하세요.</h1>
          <p>NVIDIA 비전·OCR 모델로 특이점과 문자를 확인하고 검사 이력을 한곳에 보관합니다.</p>
        </div>
        <p className="auth-note">같은 Wi-Fi의 휴대폰에서도 바로 촬영할 수 있습니다.</p>
      </section>

      <section className="auth-card" aria-labelledby="auth-heading">
        <p className="eyebrow">{isRegister ? "CREATE ACCOUNT" : "WELCOME BACK"}</p>
        <h2 id="auth-heading">{isRegister ? "계정 만들기" : "로그인"}</h2>
        <p>{isRegister ? "검사 기록을 안전하게 분리해 보관합니다." : "내 검사 대시보드로 돌아갑니다."}</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label">
            <span>이메일</span>
            <input type="email" name="email" autoComplete="email" placeholder="operator@example.com" required />
          </label>
          <label className="field-label">
            <span>비밀번호</span>
            <input
              type="password"
              name="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={12}
              maxLength={128}
              placeholder="12자 이상 입력"
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "처리 중…" : isRegister ? "가입하고 시작" : "로그인"}
          </button>
          {error && <p className="error-message" role="alert">{error}</p>}
        </form>

        <p className="auth-switch">
          {isRegister ? "이미 계정이 있나요?" : "처음 사용하시나요?"}{" "}
          <Link href={isRegister ? "/login" : "/register"}>
            {isRegister ? "로그인" : "계정 만들기"}
          </Link>
        </p>
      </section>
    </main>
  );
}
