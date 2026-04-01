# 검사실 근무표 스케줄러

## 파일 구조

```
index.html          ← 앱 본체
functions/
  api.js            ← Cloudflare Workers (KV 읽기/쓰기 API)
wrangler.toml       ← Cloudflare 프로젝트 설정
```

---

## 배포 방법

### 1단계 — Cloudflare KV Namespace 생성

1. [Cloudflare 대시보드](https://dash.cloudflare.com) 접속
2. **Workers & Pages → KV** 메뉴
3. **Create a namespace** 클릭
4. 이름: `SCHEDULER_KV` 입력 후 저장
5. 생성된 **Namespace ID** 복사

### 2단계 — wrangler.toml 수정

`wrangler.toml` 파일에서 아래 부분에 복사한 ID 붙여넣기:

```toml
id = "여기에_KV_namespace_ID_입력"
```

### 3단계 — GitHub에 올리기

이 폴더 전체를 GitHub Private 저장소에 올리세요.

```
index.html
functions/api.js
wrangler.toml
README.md
```

### 4단계 — Cloudflare Pages 연동

1. **Workers & Pages → Create → Pages → Connect to Git**
2. GitHub 저장소 선택
3. 빌드 설정:
   - Framework preset: `None`
   - Build command: *(비워두기)*
   - Build output directory: `/` 또는 *(비워두기)*
4. **Save and Deploy**

### 5단계 — KV 바인딩 설정

배포 후:
1. Pages 프로젝트 → **Settings → Functions → KV namespace bindings**
2. **Add binding** 클릭
3. Variable name: `SCHEDULER_KV`
4. KV namespace: 1단계에서 만든 `SCHEDULER_KV` 선택
5. **Save** → 재배포 트리거

---

## 비밀번호 변경 방법

`index.html`과 `functions/api.js` 두 파일 모두 같은 해시값으로 변경해야 합니다.

브라우저 콘솔(F12)에서 실행:

```javascript
const pw = '새비밀번호';
crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
  .then(buf => console.log([...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')));
```

나온 해시값을 두 파일의 `ADMIN_PASSWORD_HASH` 변수에 동일하게 붙여넣으세요.

---

## 데이터 흐름

```
직원(뷰어)   → GET  /api/state  → KV 읽기 → 화면 표시
관리자       → POST /api/state  → 비밀번호 해시 검증 → KV 쓰기
```

- 뷰어 화면은 **30초마다 자동으로** 최신 데이터를 불러옵니다.
- 관리자가 수정하면 저장 즉시 KV에 반영됩니다.
