# 설비 사진 검사

같은 Wi-Fi에 연결된 휴대폰에서 설비 사진을 올려 OCR 또는 이상 판정을 수행하고, 로그인한 사용자별 검사 이력을 저장하는 Next.js 앱입니다.


## 운영자 LAN 시작 절차

1. Node.js 20.19+, 22.12+ 또는 24+와 이 저장소의 의존성을 준비합니다.

   ```powershell
   npm install
   ```

2. `.env.example`을 `.env.local`로 복사한 후 아래 값을 채웁니다. 이 파일은 서버에서만 읽으며 Git에 커밋하지 않습니다.

   ```powershell
   Copy-Item .env.example .env.local
   ```

   - `DATABASE_URL`: 앱 런타임용 Neon Postgres 연결 문자열(풀링 URL 권장)
   - `DIRECT_URL`: Prisma migration용 Neon 직접 연결 문자열. 생략하면 `DATABASE_URL`을 사용합니다.
   - `NVIDIA_API_KEY`: NVIDIA API 키
   - `SESSION_SECRET`: 32자 이상인 무작위 비밀값

3. 새 Neon 데이터베이스라면 앱을 시작하기 전에 커밋된 Prisma migration을 적용합니다. 앱 요청 중에는 스키마를 변경하지 않습니다.

   ```powershell
   npm run db:migrate:deploy
   ```

   로컬에서 Prisma 스키마를 수정해 새 migration을 만들 때는 `npm run db:migrate`를 사용합니다. 클라이언트만 다시 생성하려면 `npm run db:generate`를 실행합니다.

   이전 버전의 앱이 이미 `users`, `sessions`, `inspections` 테이블을 자동 생성한 데이터베이스라면 초기 migration을 바로 배포하지 마세요. 먼저 백업한 다음 기존 스키마가 Prisma 스키마와 일치하는지 확인합니다.

   ```powershell
   npm exec prisma -- migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
   ```

   Prisma 스키마가 직접 표현하지 못하는 CHECK 제약도 Neon SQL 편집기에서 별도로 확인합니다. 아래 쿼리는 정확히 세 행을 반환해야 합니다.

   ```sql
   SELECT conname
   FROM pg_constraint
   WHERE conname IN (
     'users_email_normalized',
     'inspections_mode_check',
     'inspections_status_check'
   )
   ORDER BY conname;
   ```

   diff 명령이 차이 없음(종료 코드 0)이고 위 세 제약이 모두 존재하는 경우에만 초기 migration을 기존 적용분으로 표시한 뒤 이후 migration을 배포합니다. 차이가 있거나 제약이 빠졌다면 먼저 백업 후 스키마를 정정해야 합니다.

   ```powershell
   npm exec prisma -- migrate resolve --applied 20260805000000_init
   npm run db:migrate:deploy
   ```

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

## API CORS

API의 교차 출처 요청은 내부 웹 클라이언트 Origin `http://192.168.0.34`에만 허용됩니다. 해당 Origin의 `GET`, `POST`, `OPTIONS` 요청과 쿠키 자격 증명을 지원하며, 다른 Origin의 모든 브라우저 요청을 거부합니다. 허용 주소를 변경해야 하면 `proxy.ts`의 정확한 Origin 값을 변경하세요. 와일드카드 Origin은 사용하지 않습니다.

현재 세션 쿠키는 LAN의 HTTP 운영을 위해 `SameSite=Lax`입니다. 교차 출처 클라이언트와 API는 같은 사이트(동일한 스킴과 IP, 포트는 달라도 됨)에 있어야 로그인 쿠키가 전송됩니다. 서로 다른 IP에서 쿠키 인증을 사용해야 한다면 같은 사이트의 reverse proxy를 두거나 HTTPS를 구성한 뒤 쿠키를 `SameSite=None; Secure`로 전환해야 합니다.

## 개발 검증

```powershell
npm test
npm run lint
npm run build
```
