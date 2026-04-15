# SDY.CODER

<p align="center">
  <b>브라우저에서 바로 실행되는 온라인 코딩 워크스페이스</b><br/>
  설치 없이, VS Code 느낌 그대로, 빠르게 코드 작성 & 실행
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20Monaco-blue" />
  <img src="https://img.shields.io/badge/Backend-Express-green" />
  <img src="https://img.shields.io/badge/Sandbox-Docker-orange" />
  <img src="https://img.shields.io/badge/Languages-9+-brightgreen" />
  <img src="https://img.shields.io/badge/Status-Active-success" />
</p>

<p align="center">
  <a href="https://coder.sdy.world"><b>Visit SDY.CODER</b></a><br/>
  https://coder.sdy.world
</p>

---

## ✨ Features

### 🚀 Instant Execution

- 별도 설치 없이 브라우저에서 바로 코드 실행
- `stdin` 입력 지원
- 실행 상태 표시 (`idle / running / compile / run / mem`)

---

### 🧠 VS Code-like Editor

- Monaco Editor 기반
- 단축키 지원
- LSP 기능
  - 자동완성
  - Hover
  - 오류 진단
  - Semantic Highlighting

언어별 실행 보정:
- Java → 파일명 기반 `public class` 자동 매칭  
- Kotlin → 다양한 `main` 방식 지원  

---

### 🧩 Presets (Custom Snippets)

자주 사용하는 템플릿을 저장하여 빠르게 코드 작성 가능

지원 변수:
```
$classname
$filename
$filename_base
```

예시:

~~~java
public class $classname {
    public static void main(String[] args) {

    }
}
~~~

---

### ⚙️ Editor Customization

- 테마 / 폰트 / 글자 크기
- 줄 간격 / 탭 크기
- 줄 번호 / 미니맵
- ligatures / semantic highlighting

저장 방식:
- 로그인 → 계정 기준
- 비로그인 → 세션 기준

---

### 📁 File Explorer

- 파일 / 폴더 생성 및 관리
- 간단한 프로젝트 구조 지원
- 반응형 UI (`...` 처리)

---

## 📊 Output

- `stdout`
- `stderr`
- 실행 시간
- 메모리 사용량

---

### 📈 Python Visualization

`matplotlib` 그래프 inline 출력 지원

~~~python
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2 * np.pi, 400)
y = np.sin(x)

plt.plot(x, y)
plt.title("Sine Wave")
plt.show()
~~~

---

## 📦 Supported Languages
```
Python
C
C++
Java
C#
Node.js
Go
Kotlin
Dart
```
---

## 🧪 Python Packages
```
numpy
pandas
scipy
sympy
scikit-learn
statsmodels
matplotlib
seaborn
networkx
numba
pulp
ortools
tensorflow
requests
```
타입 스텁 지원:
```
pandas-stubs
scipy-stubs
matplotlib-stubs
types-requests
…
```
---

## 🏗 Architecture
```
Frontend  : React + Vite + Monaco Editor
Backend   : Express + WebSocket (LSP bridge)
Execution : Docker-based Sandbox
```
---

## ⚡ Getting Started

~~~bash
docker compose up --build
~~~

접속:
```
http://localhost:5403
```
중지:

~~~bash
docker compose down
~~~

---

## 🎯 Use Cases

- 알고리즘 문제풀이
- 수업 실습
- 빠른 문법 테스트
- 다중 언어 실행 확인
- 모바일 / 태블릿 코딩

---

## ⭐ Why SDY.CODER?

- ⚡ 빠른 실행 속도
- 🧠 VS Code 친화적 UX
- 🐳 안정적인 Docker 기반 실행
- 📱 어디서든 사용 가능

---
