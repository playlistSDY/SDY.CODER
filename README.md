# SDY.CODER

브라우저에서 바로 코드를 작성하고 실행할 수 있는 온라인 코딩 워크스페이스입니다.  
VS Code에 익숙한 흐름을 최대한 유지하면서도, 문제풀이와 실습에 바로 쓸 수 있게 가볍고 빠른 사용감을 목표로 만들었습니다.

현재 지원 언어:

- Python
- C
- C++
- Java
- C#
- Node.js
- Go
- Kotlin
- Dart

## 어떤 점이 편한가요?

### 1. 브라우저 안에서 바로 코딩하고 실행

- 별도 설치 없이 바로 코드를 작성하고 실행할 수 있습니다.
- `Input`을 넣고 결과를 바로 확인할 수 있습니다.
- 실행 상태는 `idle / running / compile / open / run / mem` 같은 요약 바로 한눈에 확인할 수 있습니다.
- 모바일, 태블릿, 데스크탑 화면에 맞춰 레이아웃이 반응형으로 바뀝니다.

### 2. VS Code 느낌의 에디터 경험

- Monaco Editor 기반 에디터를 사용합니다.
- 단축키로 실행할 수 있습니다.
- 자동완성, hover, 진단, semantic highlighting 등 LSP 기능을 지원합니다.
- 언어별로 가능한 한 자연스럽게 동작하도록 러너와 에디터를 조정해 두었습니다.
  - Java는 public class 이름에 맞춰 실행
  - Kotlin은 top-level `main`과 class-based `main` 모두 안정적으로 실행

### 3. 직접 만드는 프리셋

- 상단 `Presets`에서 사용자 프리셋을 직접 만들 수 있습니다.
- 언어별로 `prefix`를 저장해두고 자동완성처럼 펼칠 수 있습니다.
- Java처럼 파일 이름이 중요한 언어를 위해 아래 변수도 지원합니다.
  - `$classname`
  - `$filename`
  - `$filename_base`
- 프리셋 본문도 Monaco 에디터로 작성할 수 있습니다.

예를 들어 Java에서 `pvsm` 같은 프리셋을 만들고, 본문에 `$classname`을 넣어두면 현재 파일 이름에 맞는 클래스 틀이 자동으로 들어갑니다.

### 4. 에디터 설정 저장

- `Settings` 모달에서 에디터 환경을 직접 바꿀 수 있습니다.
- 현재 지원 옵션:
  - 테마
  - 폰트
  - 글자 크기
  - 줄 간격
  - 탭 크기
  - 줄바꿈
  - 줄번호
  - 미니맵
  - font ligatures
  - semantic highlighting

설정은 로그인 여부에 따라 저장 위치가 나뉩니다.

- 로그인 상태: 계정 기준으로 저장
- 비로그인 상태: 세션 기준으로 저장

### 5. 로그인/비로그인 흐름 분리

- 로그인하면 파일, 프리셋, 에디터 설정을 계정 기준으로 유지할 수 있습니다.
- 비로그인 상태에서도 세션 단위로 작업 내용을 유지합니다.
- 로그인 상태와 비로그인 상태는 서로 섞이지 않게 분리되어 있습니다.
- 마지막으로 열던 파일도 기억해서, 다시 들어오면 이어서 작업할 수 있습니다.

### 6. 탐색기 기반 파일 관리

- 폴더와 파일을 만들고 수정할 수 있습니다.
- 폴더 단위로 파일을 정리할 수 있습니다.
- 폴더 행에서 바로 새 파일을 만들 수 있습니다.
- 탐색기 크기를 줄여도 파일명/폴더명은 줄바꿈 대신 `...` 처리됩니다.

## 출력과 실행 결과

실행 결과는 단순 텍스트뿐 아니라 시각 자료도 함께 다룰 수 있습니다.

### 텍스트 출력

- `stdout`, `stderr`, 실행 시간, 메모리 등의 결과를 바로 확인할 수 있습니다.
- 실행 요약은 본문과 분리되어 보여서 출력이 더 깔끔합니다.

### matplotlib 그래프 출력

- Python에서 `matplotlib`를 사용할 수 있습니다.
- `plt.show()` 결과를 브라우저 안에 바로 표시합니다.
- 그래프는 별도 섹션이 아니라 출력 흐름 안에 자연스럽게 삽입됩니다.
- `print(...)`와 그래프가 코랩처럼 순서대로 이어서 보입니다.

예시:

```python
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2 * np.pi, 400)
y = np.sin(x)

plt.plot(x, y)
plt.title("Sine Wave")
plt.show()
```

## Python 패키지 지원

문제풀이뿐 아니라 데이터 분석, 통계, 최적화, 시각화 실습에도 쓸 수 있도록 주요 패키지를 포함하고 있습니다.

포함된 대표 패키지:

- `numpy`
- `pandas`
- `scipy`
- `sympy`
- `scikit-learn`
- `statsmodels`
- `matplotlib`
- `seaborn`
- `networkx`
- `numba`
- `pulp`
- `ortools`
- `tensorflow`
- `requests`

또한 타입 힌트와 자동완성 품질을 높이기 위해 가능한 패키지에는 stub 패키지도 함께 반영했습니다.

예:

- `pandas-stubs`
- `scipy-stubs`
- `matplotlib-stubs`
- `scikit-learn-stubs`
- `types-seaborn`
- `types-networkx`
- `types-requests`
- `types-protobuf`

## 테마

에디터 테마에 맞춰 앱 전체 분위기도 함께 바뀝니다.

- `Dark Modern`
- `Dark`
- `Light`
- `High Contrast`

라이트 테마에서는 전체 UI가 밝은 배경 기준으로 바뀌고, 하이 컨트라스트에서는 더 강한 대비의 검은 배경 UI로 전환됩니다.

## 이런 용도에 잘 맞습니다

- 알고리즘 문제풀이
- 수업 실습
- 빠른 문법 테스트
- Python 데이터 분석/통계 예제 실행
- Java, Kotlin, C# 등 여러 언어의 간단한 런타임 확인
- 모바일이나 태블릿에서 가볍게 코드 확인

## 실행 환경 요약

- Frontend: React + Vite + Monaco Editor
- Backend: Express + WebSocket LSP bridge + 실행 API
- Sandbox: Docker 기반 격리 실행

## 빠르게 실행하기

권장 방식:

```bash
docker compose up --build
```

접속:

- `http://localhost:5403`

중지:

```bash
docker compose down
```

## 참고

- Python, C, C++, Java, C#, Node.js, Go, Kotlin, Dart 실행을 지원합니다.
- LSP는 환경에 설치된 후보를 자동 탐색해 연결합니다.
- 일부 언어 기능은 런타임과 LSP 설치 상태에 따라 차이가 있을 수 있습니다.
