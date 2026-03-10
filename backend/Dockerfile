FROM golang:1.24-bookworm AS golang_toolchain

FROM node:22-bookworm-slim

WORKDIR /app/backend

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-numpy \
    python3-pandas \
    python3-requests \
    gcc \
    g++ \
    libssl-dev \
    libcurl4-openssl-dev \
    nlohmann-json3-dev \
    clangd \
    libgoogle-gson-java \
    libcommons-lang3-java \
    mono-mcs \
    mono-runtime \
    docker.io \
    curl \
    tar \
    unzip \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=golang_toolchain /usr/local/go /usr/local/go

ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) JDK_ARCH="x64" ;; \
    arm64) JDK_ARCH="aarch64" ;; \
    *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && mkdir -p /opt/java \
  && curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/${JDK_ARCH}/jdk/hotspot/normal/eclipse?project=jdk" -o /tmp/jdk21.tar.gz \
  && tar -xzf /tmp/jdk21.tar.gz -C /opt/java \
  && mv /opt/java/jdk-* /opt/java/jdk-21 \
  && rm -f /tmp/jdk21.tar.gz

ENV JAVA_HOME=/opt/java/jdk-21
ENV PATH="/usr/local/go/bin:${JAVA_HOME}/bin:${PATH}"

RUN npm install -g typescript-language-server typescript
RUN GOTOOLCHAIN=auto GOBIN=/usr/local/bin go install golang.org/x/tools/gopls@latest

ARG TARGETARCH
ARG KOTLIN_COMPILER_VERSION=1.9.25
RUN curl -fsSL "https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_COMPILER_VERSION}/kotlin-compiler-${KOTLIN_COMPILER_VERSION}.zip" -o /tmp/kotlinc.zip \
  && unzip -q /tmp/kotlinc.zip -d /opt \
  && rm -f /tmp/kotlinc.zip \
  && mv /opt/kotlinc /opt/kotlinc-${KOTLIN_COMPILER_VERSION} \
  && ln -s /opt/kotlinc-${KOTLIN_COMPILER_VERSION} /opt/kotlinc

ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) DOTNET_ARCH="x64" ;; \
    arm64) DOTNET_ARCH="arm64" ;; \
    *) echo "Unsupported TARGETARCH for .NET: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
  && chmod +x /tmp/dotnet-install.sh \
  && /tmp/dotnet-install.sh --channel 10.0 --architecture "$DOTNET_ARCH" --install-dir /usr/share/dotnet \
  && rm -f /tmp/dotnet-install.sh \
  && ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet \
  && dotnet tool install --tool-path /usr/local/bin csharp-ls

ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="/opt/kotlinc/bin:/usr/local/go/bin:/usr/share/dotnet:${JAVA_HOME}/bin:${PATH}"

ARG TARGETARCH
ARG KOTLIN_LSP_VERSION=261.13587.0
RUN case "$TARGETARCH" in \
    amd64) KOTLIN_LSP_ARCH="x64" ;; \
    arm64) KOTLIN_LSP_ARCH="aarch64" ;; \
    *) echo "Unsupported TARGETARCH for kotlin-lsp: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://download-cdn.jetbrains.com/kotlin-lsp/${KOTLIN_LSP_VERSION}/kotlin-lsp-${KOTLIN_LSP_VERSION}-linux-${KOTLIN_LSP_ARCH}.zip" -o /tmp/kotlin-lsp.zip \
  && mkdir -p /opt/kotlin-lsp \
  && unzip -q /tmp/kotlin-lsp.zip -d /opt/kotlin-lsp \
  && rm -f /tmp/kotlin-lsp.zip \
  && KOTLIN_LSP_BIN="$(find /opt/kotlin-lsp -type f \( -name 'kotlin-lsp' -o -name 'kotlin-lsp.sh' \) | head -n 1)" \
  && [ -n "$KOTLIN_LSP_BIN" ] \
  && chmod +x "$KOTLIN_LSP_BIN" \
  && ln -sf "$KOTLIN_LSP_BIN" /usr/local/bin/kotlin-lsp

ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) DART_ARCH="x64" ;; \
    arm64) DART_ARCH="arm64" ;; \
    *) echo "Unsupported TARGETARCH for Dart SDK: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://storage.googleapis.com/dart-archive/channels/stable/release/latest/sdk/dartsdk-linux-${DART_ARCH}-release.zip" -o /tmp/dartsdk.zip \
  && unzip -q /tmp/dartsdk.zip -d /opt \
  && mv /opt/dart-sdk /opt/dart-sdk-current \
  && ln -s /opt/dart-sdk-current /opt/dart-sdk \
  && rm -f /tmp/dartsdk.zip

ENV PATH="/opt/dart-sdk/bin:/opt/kotlinc/bin:/usr/local/go/bin:/usr/share/dotnet:${JAVA_HOME}/bin:${PATH}"

ARG JDTLS_URL=https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz
RUN mkdir -p /opt/jdtls /tmp/jdtls-workspace \
  && curl -fsSL "$JDTLS_URL" -o /tmp/jdtls.tar.gz \
  && tar -xzf /tmp/jdtls.tar.gz -C /opt/jdtls \
  && rm -f /tmp/jdtls.tar.gz \
  && printf '%s\n' \
    '#!/bin/sh' \
    'LAUNCHER=$(ls /opt/jdtls/plugins/org.eclipse.equinox.launcher_*.jar 2>/dev/null | head -n 1)' \
    'if [ -z "$LAUNCHER" ]; then' \
    '  echo "jdtls launcher jar not found" >&2' \
    '  exit 1' \
    'fi' \
    'exec java -Declipse.application=org.eclipse.jdt.ls.core.id1 -Dosgi.bundles.defaultStartLevel=4 -Declipse.product=org.eclipse.jdt.ls.core.product -Dlog.level=ALL -Xmx1G -jar "$LAUNCHER" -configuration /opt/jdtls/config_linux -data /tmp/jdtls-workspace "$@"' \
    > /usr/local/bin/jdtls \
  && chmod +x /usr/local/bin/jdtls

COPY backend/package*.json ./
RUN npm ci

COPY backend/src ./src

ENV PORT=3001
EXPOSE 3001

CMD ["npm", "run", "start"]
