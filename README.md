# 설비 사진 검사

같은 Wi-Fi에 연결된 휴대폰에서 설비 사진을 올려 OCR 또는 이상 판정을 수행하고, 로그인한 사용자별 검사 이력을 저장하는 Next.js 앱입니다.

## 운영자 LAN 시작 절차

1. Node.js 20.9 이상과 이 저장소의 의존성을 준비합니다.

   ```powershell
   npm install
   ```

2. `.env.example`을 `.env.local`로 복사한 후 아래 세 값을 채웁니다. 이 파일은 서버에서만 읽으며 Git에 커밋하지 않습니다.

   ```powershell
   Copy-Item .env.example .env.local
   ```

   - `DATABASE_URL`: Neon Postgres 연결 문자열
   - `NVIDIA_API_KEY`: NVIDIA API 키
   - `SESSION_SECRET`: 32자 이상인 무작위 비밀값

3. 별도 SQL 실행은 필요하지 않습니다. 앱이 처음 데이터베이스를 사용하는 요청에서 Neon 스키마(`users`, `sessions`, `inspections`)를 자동으로 초기화합니다. 먼저 PC에서 가입 또는 로그인을 한 번 실행해 초기화를 확인합니다.

4. LAN 개발 서버를 시작합니다.

   ```powershell
   npm run dev:lan
   ```

5. PC의 IPv4 주소를 확인합니다.

   ```powershell
   ipconfig
   ```

   `Wireless LAN adapter Wi-Fi` 등의 `IPv4 Address`를 찾습니다. 같은 Wi-Fi의 휴대폰에서 `http://<PC-LAN-IP>:3000`을 엽니다. 예: `http://192.168.0.25:3000`.

6. Windows Defender 방화벽에서 Node.js가 개인 네트워크의 TCP 3000 포트를 수신하도록 허용합니다. 휴대폰에서 접속할 수 없으면 PC와 휴대폰이 동일한 Wi-Fi에 연결되어 있는지와 방화벽 규칙을 먼저 확인합니다.

## 휴대폰 점검 절차

1. 휴대폰 브라우저에서 LAN 주소를 열고 계정을 가입하거나 로그인합니다.
2. 새 검사에서 사진 선택을 누릅니다. 지원하는 휴대폰에서는 후면 카메라가 열립니다.
3. `OCR`, `이상 판정`, `둘 다` 중 검사 유형을 선택합니다. 이상 판정에는 판정 기준을 입력합니다.
4. 검사를 실행하고 최신 검사 카드의 상태와 요약을 확인합니다.
5. 카드를 열어 원본 사진과 구조화된 OCR/이상 판정 결과를 확인합니다.

실제 운영 전에는 같은 Wi-Fi의 휴대폰으로 다음을 수동 확인하세요: 가입, 카메라 촬영, 세 검사 유형 각각의 실행, 화면 새로고침 후 최신 카드 표시, 상세 화면 표시, 그리고 다른 계정으로 첫 계정의 상세 URL을 열었을 때 접근이 거부되는지 확인합니다.

## 사진 보관 및 보안

업로드 사진은 UUID 파일명으로 `public/uploads`에 저장되며 검사 기록에는 `/uploads/<uuid>.jpg` 경로만 저장됩니다. 이 디렉터리는 Git에서 제외되고 정적 파일로 제공됩니다. 이 릴리스는 신뢰할 수 있는 LAN 운영용이며, 민감한 사진을 인터넷에 공개해서는 안 됩니다. 인터넷 공개 또는 더 엄격한 접근 제어가 필요하면 비공개 객체 스토리지와 인증된 이미지 제공 API로 이전하세요.

`NVIDIA_API_KEY`, `DATABASE_URL`, `SESSION_SECRET`은 브라우저에 전달하지 말고 `.env.local`에만 보관하세요.

## 개발 검증

```powershell
npm test
npm run lint
npm run build
```
