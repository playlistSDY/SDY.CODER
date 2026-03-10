# Web VSCode Compiler (Python/C/C++/Java/C#/Node.js/Go/Kotlin/Dart)

브라우저에서 VS Code 느낌으로 코드를 작성하고 실행할 수 있는 프로젝트입니다.

## 포함 기능

- Monaco Editor 기반 VS Code 스타일 UI
- 테마: VS Code `Dark Modern` 감성 커스텀 테마 적용
- 미니맵 비활성화
- 언어 지원: `Python`, `C`, `C++`, `Java`, `C#`, `Node.js`, `Go`, `Kotlin`, `Dart`
- 언어별 LSP WebSocket 브리지 연결
  - Diagnostics (에러/경고)
  - Hover
  - Completion
- 언어별 실행/컴파일 API (`/api/run`)
- 실행 결과에 실제 코드 실행 시간(`executionMs`)을 ms 단위로 반환
  - Docker sandbox 사용 시: 컨테이너 시작 시간 제외, 코드 실행 구간만 측정
- 코테용 `Input` 패널에서 stdin 입력 가능
- `Logs` 패널에 LSP 연결 상태와 실행 단계 로그(컨테이너 생성/실행/실행시간) 표시
- 기본 라이브러리 사전 설치
  - Python: `numpy`, `pandas`, `requests`
  - C/C++: `libssl`, `libcurl`, `nlohmann/json`(header-only, Docker sandbox에서 `curl/ssl` 링크 플래그 기본 포함)
  - Java: `gson`, `commons-lang3` (기본 classpath 자동 포함)
  - C#: `mono` 컴파일/실행 환경 (`mcs`, `mono`)
  - Node.js/Go/Kotlin/Dart: 런타임 및 빌드 도구 포함

## 프로젝트 구조

- `frontend`: Vite + React + Monaco
- `backend`: Express + WebSocket + LSP stdio bridge + run API

## 실행 방법

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`

포트 충돌 시:

```bash
BACKEND_PORT=3101 PORT=3101 npm run dev
```

## Docker Compose

```bash
docker compose up --build
```

- App(Nginx): `http://localhost:5403`
- Nginx가 정적 파일(`frontend/dist`)을 서빙하고, 아래 경로를 백엔드로 프록시합니다.
  - `/api/*` -> `backend:3001`
  - `/lsp/*`(WebSocket) -> `backend:3001`
- 백엔드 이미지에 `python3`, `gcc/g++`, `clangd`, `JDK 21`, `pyright`, `jdtls`, `mono`, `node`, `go`, `kotlin`, `dart`를 포함합니다.
- LSP 서버 포함:
  - Python: `pyright-langserver`
  - JavaScript/TypeScript(Node.js): `typescript-language-server`
  - Go: `gopls`
  - Kotlin: `kotlin-lsp`
  - C#: `csharp-ls`
  - Java: `jdtls`
- 기본 라이브러리도 이미지에 포함됩니다.
  - Python: `numpy`, `pandas`, `requests`
  - C/C++: `libssl-dev`, `libcurl4-openssl-dev`, `nlohmann-json3-dev`
  - Java: `libgoogle-gson-java`, `libcommons-lang3-java`
- `/api/run` 코드는 별도 Docker sandbox 컨테이너(`--network none`, CPU/메모리/PID 제한)에서 실행됩니다.
- backend 컨테이너는 샌드박스 생성용으로 `/var/run/docker.sock`를 마운트합니다.
  - 주의: docker socket 접근은 강한 권한입니다. 외부 공개 시 네트워크/인증을 반드시 추가하세요.

중지:

```bash
docker compose down
```

샌드박스 관련 환경변수(backend):

- `SANDBOX_PROVIDER` (기본 `docker`)
- `SANDBOX_IMAGE` (기본 `web-vscode-backend:latest`)
- `SANDBOX_CPU_LIMIT` (기본 `1.0`)
- `SANDBOX_MEMORY_LIMIT` (기본 `512m`)
- `SANDBOX_PIDS_LIMIT` (기본 `128`)

## 시스템 선행 설치

### 실행/컴파일 도구

- Python: `python3`
- C: `gcc`
- C++: `g++`
- Java: `javac`, `java`
- C#: `mcs`, `mono`
- Node.js: `node`
- Go: `go`
- Kotlin: `kotlinc`
- Dart: `dart`

### LSP 서버

- Python: `pyright-langserver` 또는 `basedpyright-langserver` 또는 `pylsp`
- C/C++: `clangd`
- Java: `jdtls`
- C#: `csharp-ls` 또는 `omnisharp`
- Node.js: `typescript-language-server`
- Go: `gopls`
- Kotlin: `kotlin-lsp`
- Dart: `dart language-server`

백엔드는 각 언어 접속 시 위 후보 중 설치된 LSP를 자동 선택합니다.

## 참고

- 이 프로젝트의 코드 실행 기능은 샘플 구현이며, 외부 공개 서비스로 운영하려면 별도 샌드박싱/보안 격리가 필요합니다.
