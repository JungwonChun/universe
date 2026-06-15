# 🌌 Universe — 동아리 운영 PWA

통합 일정 캘린더(레슨·행사) · 선착순 신청(대기열 자동 승급) · 참여 랭킹 · 교류전/같이 치기 모집 게시판을 갖춘
**멀티 동아리 운영 앱**이에요. 휴대폰 홈 화면에 추가하면 일반 앱처럼 쓸 수 있어요.

전부 무료로 운영돼요: Supabase 무료 플랜(DB·로그인·실시간) + Vercel 무료 플랜(호스팅) + GitHub Actions(정지 방지 핑).

---

## 배포하기 (총 15분, 카드 등록 불필요)

### 1단계. Supabase 프로젝트 만들기 (5분)

1. https://supabase.com 접속 → GitHub 계정으로 가입/로그인
2. **New Project** 클릭 → 이름 아무거나(예: `universe`), 비밀번호 설정, Region은 **Northeast Asia (Seoul)** 선택 → 생성 (1~2분 소요)
3. 왼쪽 메뉴 **SQL Editor** → **New query** → 이 프로젝트의 `supabase/schema.sql` 파일 내용을 **전체 복사해서 붙여넣고 Run** 클릭
   - 맨 아래 `Success. No rows returned`가 나오면 성공이에요.
4. 왼쪽 메뉴 **Authentication → Sign In / Providers → Email** 에서 **Confirm email을 꺼주세요(OFF)**.
   - 무료 플랜의 기본 메일 발송은 시간당 3~4통으로 제한돼서, 끄지 않으면 부원들이 가입 확인 메일을 못 받을 수 있어요. 끄면 가입 즉시 바로 로그인됩니다.
5. 왼쪽 메뉴 **Project Settings → API** 에서 두 값을 복사해두세요:
   - **Project URL** (예: `https://abcd1234.supabase.co`)
   - **anon public** 키

### 2단계. GitHub에 코드 올리기 (3분)

1. https://github.com 에서 **New repository** → 이름 `universe` (Private 가능) → 생성
2. 이 폴더에서 터미널 실행:

```bash
git init
git add .
git commit -m "Universe 초기 버전"
git branch -M main
git remote add origin https://github.com/JungwonChun/universe.git
git push -u origin main
```

3. 저장소 **Settings → Secrets and variables → Actions → New repository secret** 으로 두 개 등록:
   - `SUPABASE_URL` = 1단계에서 복사한 Project URL
   - `SUPABASE_ANON_KEY` = anon public 키
   - → 이걸 등록해야 **7일 정지 방지 자동 핑**(`.github/workflows/keepalive.yml`)이 매주 월·목 자동으로 돌아가요.

### 3단계. Vercel로 배포하기 (5분)

1. https://vercel.com 접속 → GitHub 계정으로 가입/로그인
2. **Add New → Project** → 방금 만든 `universe` 저장소 **Import**
3. Framework는 자동으로 **Vite**로 잡혀요. **Environment Variables**에 두 개 추가:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public 키
4. **Deploy** 클릭 → 1분 뒤 `https://universe-xxxx.vercel.app` 같은 **내 링크**가 생겨요! 🎉

### 4단계. 휴대폰에 앱으로 설치하기

링크를 카톡 등으로 부원들에게 공유하고:

- **아이폰**: Safari로 링크 열기 → 공유 버튼(⬆️) → **홈 화면에 추가**
- **안드로이드**: Chrome으로 열기 → 메뉴(⋮) → **홈 화면에 추가** (또는 자동으로 뜨는 설치 배너)

홈 화면 아이콘으로 실행하면 주소창 없는 진짜 앱처럼 동작해요.

---

## 처음 시작 흐름

1. **가입** → 이름/이메일/비밀번호 입력
2. **새 단체 만들기** → 만든 사람이 자동으로 관리자가 되고 **6자리 초대 코드**가 발급돼요
3. **[일정] 탭**에서 관리자가 **일정 만들기**:
   - **레슨** (매주 반복 ON → 요일 선택, 정원, 신청 오픈 규칙 설정. 예: 매주 월 18:00–19:00 정원 6명, 매주 일요일 21:00 신청 오픈)
   - **행사** (반복 OFF → 날짜 선택. 등록 즉시 신청을 받아요)
4. 초대 코드를 부원들에게 공유 → 부원들은 가입 후 **초대 코드 입력**으로 합류
5. 다른 동아리도 같은 링크에서 **새 단체 만들기**로 독립된 공간을 만들어 쓸 수 있어요

## 주요 동작 방식

| 기능 | 설명 |
|---|---|
| 통합 일정 | 레슨·행사 모두 [일정] 캘린더에서 등록·신청. 반복 일정은 매주 자동으로 생겨요 |
| 선착순 신청 | 서버(DB 함수)에서 잠금 처리해 마지막 한 자리 동시 클릭에도 안전해요 |
| 대기열 | 정원 마감 시 대기 등록 → 누가 취소하면 대기 1번이 **자동 확정** |
| 실시간 | 다른 부원이 신청/취소하면 화면이 즉시 갱신돼요 |
| 오픈/마감 | 반복 일정은 일정별 오픈 규칙(예: 매주 일 21:00) + 회차별 수동 오픈/마감 가능 |
| 내 캘린더 | 일정 신청·모집글 참여하면 캘린더에 초록 링으로 표시돼요. 단체 일정은 부원 모두에게 보여요 |
| 모집 게시판 | 글마다 "우리 단체만 / 전체 공개" 선택, 전체 공개 글엔 다른 동아리도 참여 가능. 날짜 있는 글은 캘린더에 반영 |
| 참여 랭킹 | 확정 신청 누적 횟수 자동 집계 |
| 업데이트 | 코드를 고쳐 git push만 하면 Vercel이 자동 재배포, 사용자 앱에 "새 버전" 배너가 떠요 |

## 로컬에서 개발하려면

```bash
npm install
cp .env.example .env   # .env 열어서 Supabase URL/키 입력
npm run dev
```

## Update List

- [x] 대회 운영 추가 — 조별 리그 / 토너먼트 / 혼합, 팀 편성·자동 대진표, 오더지, 테니스 룰 점수 입력, 자동 순위·진출, '내 차례' 표시 *(적용하려면 `supabase/migration-v3.sql` 실행)*
- [ ] 대회 알림 고도화 (브라우저/푸시 알림)
- [ ] Trouble Shooting 추가

## 자주 묻는 것

- **무료로 어디까지 되나요?** Supabase 무료: DB 500MB, 월 활성 사용자 5만 명, 실시간 동시접속 200명 — 동아리 수십 개 규모까지 충분해요.
- **7일 정지가 뭔가요?** Supabase 무료 프로젝트는 7일간 요청이 없으면 잠들어요. 이 프로젝트엔 GitHub Actions가 주 2회 자동 핑을 보내는 설정이 포함돼 있어서, 2단계의 Secrets만 등록하면 신경 쓸 필요 없어요.
- **비밀번호를 잊으면?** 현재는 관리자가 Supabase 대시보드(Authentication → Users)에서 재설정 메일을 보내거나 비밀번호를 직접 바꿔줄 수 있어요.
