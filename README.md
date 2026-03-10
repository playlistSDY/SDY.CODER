# SDY.CODER

브라우저에서 VS Code 느낌으로 코드를 작성하고 실행할 수 있는 웹 컴파일러입니다.  
현재 `Python / C / C++ / Java / C# / Node.js / Go / Kotlin / Dart`를 지원합니다.

## 주요 기능

- Monaco Editor 기반 에디터 + VS Code Dark Modern 스타일 테마
- 미니맵 비활성화
- 언어별 LSP(WebSocket 브리지)
  - Diagnostics, Hover, Completion, Semantic Highlighting
- `Input / Output / Logs` 3패널 UI
  - 패널 간 드래그 리사이즈 지원
  - 모바일 레이아웃 최적화
- 실행 로그 단순화
  - `HH:MM` 타임스탬프
  - LSP 연결/해제, 실행 단계 위주 표시
- 실행 결과 `Output`는 `[status]` 중심 포맷
  - `Opening container: ... ms`
  - `Code execution time: ... ms`
- LocalStorage 저장
  - 마지막 선택 언어
  - 언어별 마지막 코드
  - 패널 크기
- 파비콘/상단 로고: `frontend/public/sc_logo.png`

## 지원 언어/버전 표기(프론트 표시 기준)

- Python `3.11`
- C `99`
- C++ `17`
- Java `21`
- C# `Mono`
- Node.js `22`
- Go `1.x`
- Kotlin `1.9+`
- Dart `3.x`

참고: C 실행 컴파일 플래그는 현재 백엔드에서 `-std=c11`을 사용합니다.

## 프로젝트 구조

- `frontend`: Vite + React + Monaco
- `backend`: Express + WebSocket LSP bridge + `/api/run`
- `docker-compose.yml`: Nginx(프론트) + Backend 구성

## 빠른 실행

### 1) Docker Compose (권장)

```bash
docker compose up --build
```

- 접속: `http://localhost:5403`
- 구성:
  - `frontend`(Nginx): 정적 `dist` 서빙
  - `backend`: LSP + 실행 API
  - Nginx reverse proxy
    - `/api/*` -> `backend:3001`
    - `/lsp/*` -> `backend:3001` (WebSocket)

중지:

```bash
docker compose down
```

### 2) 로컬 개발 실행

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

포트 변경 예시:

```bash
BACKEND_PORT=3101 PORT=3101 npm run dev
```

## 샌드박스/보안 모델

- `/api/run`은 Docker sandbox 컨테이너에서 실행됩니다.
- 기본 제한:
  - `--network none`
  - CPU/메모리/PID 제한
  - 비루트 사용자(`65534:65534`)
- Backend 컨테이너는 샌드박스 생성을 위해 Docker socket(`/var/run/docker.sock`)을 사용합니다.

주의: Docker socket 접근은 강한 권한입니다. 외부 공개 시 인증/네트워크 제어를 반드시 추가하세요.

## 환경변수 (backend)

- `PORT` (default: `3001`)
- `RUN_TIMEOUT_MS` (default: `8000`)
- `SANDBOX_PROVIDER` (default: `docker`)
- `SANDBOX_IMAGE` (default: `web-vscode-backend:latest`)
- `SANDBOX_CPU_LIMIT` (default: `1.0`)
- `SANDBOX_MEMORY_LIMIT` (default: `512m`)
- `SANDBOX_PIDS_LIMIT` (default: `128`)
- `SANDBOX_WORKSPACE_SIZE` (default: `256m`)
- `SANDBOX_TMP_SIZE` (default: `128m`)
- `SANDBOX_USER` (default: `65534:65534`)
- `JAVA_DEFAULT_CLASSPATH` (default: `/usr/share/java/gson.jar:/usr/share/java/commons-lang3.jar`)

## 로컬(비도커) 사용 시 필요 도구

### 실행/컴파일

- `python3`, `gcc`, `g++`, `javac`, `java`, `mcs`, `mono`, `node`, `go`, `kotlinc`, `dart`

### LSP 후보

- Python: `pyright-langserver` / `basedpyright-langserver` / `pylsp`
- C/C++: `clangd`
- Java: `jdtls`
- C#: `csharp-ls` / `omnisharp`
- Node.js: `typescript-language-server`
- Go: `gopls`
- Kotlin: `kotlin-lsp`
- Dart: `dart language-server`

백엔드는 각 언어 연결 시 설치된 후보를 자동 탐색해서 사용합니다.
