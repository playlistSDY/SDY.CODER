import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
app.use(express.json({ limit: '1mb' }));

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3001);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 8000);
const LSP_WORKSPACE_DIR = path.join(os.tmpdir(), 'web-vscode-workspace');
const DOCKER_SOCKET_PATH = '/var/run/docker.sock';

const SANDBOX_PROVIDER = process.env.SANDBOX_PROVIDER || 'docker';
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || 'web-vscode-backend:latest';
const SANDBOX_CPU_LIMIT = process.env.SANDBOX_CPU_LIMIT || '1.0';
const SANDBOX_MEMORY_LIMIT = process.env.SANDBOX_MEMORY_LIMIT || '512m';
const SANDBOX_PIDS_LIMIT = Number(process.env.SANDBOX_PIDS_LIMIT || 128);
const SANDBOX_WORKSPACE_SIZE = process.env.SANDBOX_WORKSPACE_SIZE || '256m';
const SANDBOX_TMP_SIZE = process.env.SANDBOX_TMP_SIZE || '128m';
const SANDBOX_USER = process.env.SANDBOX_USER || '65534:65534';
const JAVA_DEFAULT_CLASSPATH =
  process.env.JAVA_DEFAULT_CLASSPATH || '/usr/share/java/gson.jar:/usr/share/java/commons-lang3.jar';
const COMPILE_ERROR_EXIT_CODE = 42;
const EXEC_TIME_MARKER = '__WEB_EXEC_NS__=';
const OPEN_TIME_MARKER = '__WEB_OPEN_NS__=';
const RUNTIME_INFO_TTL_MS = Number(process.env.RUNTIME_INFO_TTL_MS || 10 * 60 * 1000);
const runtimeInfoCache = new Map();

const LSP_CANDIDATES = {
  python: [
    { cmd: 'pyright-langserver', args: ['--stdio'] },
    { cmd: 'basedpyright-langserver', args: ['--stdio'] },
    { cmd: 'pylsp', args: [] }
  ],
  c: [{ cmd: 'clangd', args: ['--background-index'] }],
  cpp: [{ cmd: 'clangd', args: ['--background-index'] }],
  java: [{ cmd: 'jdtls', args: [] }],
  csharp: [{ cmd: 'csharp-ls', args: [] }, { cmd: 'omnisharp', args: ['--languageserver'] }],
  nodejs: [{ cmd: 'typescript-language-server', args: ['--stdio'] }],
  go: [{ cmd: 'gopls', args: [] }],
  kotlin: [{ cmd: 'kotlin-lsp', args: [] }],
  dart: [
    { cmd: '/opt/dart-sdk/bin/dart', args: ['language-server', '--protocol', 'lsp'] },
    { cmd: 'dart', args: ['language-server', '--protocol', 'lsp'] },
    { cmd: 'dart', args: ['language-server'] },
    { cmd: 'dart', args: ['/opt/dart-sdk/bin/snapshots/analysis_server.dart.snapshot', '--lsp'] }
  ]
};

const DOCKER_RUN_SPEC = {
  python: {
    sourceFile: 'main.py',
    compileCommand: null,
    runCommand: 'python3 main.py',
    hasCompileStep: false
  },
  c: {
    sourceFile: 'main.c',
    compileCommand: 'gcc main.c -std=c11 -O2 -pipe -lcurl -lssl -lcrypto -o main',
    runCommand: './main',
    hasCompileStep: true
  },
  cpp: {
    sourceFile: 'main.cpp',
    compileCommand: 'g++ main.cpp -std=c++17 -O2 -pipe -lcurl -lssl -lcrypto -o main',
    runCommand: './main',
    hasCompileStep: true
  },
  java: {
    sourceFile: 'Main.java',
    compileCommand: 'javac -cp "$JAVA_DEFAULT_CLASSPATH" Main.java',
    runCommand: 'java -cp ".:$JAVA_DEFAULT_CLASSPATH" Main',
    hasCompileStep: true
  },
  csharp: {
    sourceFile: 'Main.cs',
    compileCommand: 'mcs -out:Main.exe Main.cs',
    runCommand: 'mono Main.exe',
    hasCompileStep: true
  },
  nodejs: {
    sourceFile: 'main.js',
    compileCommand: null,
    runCommand: 'node main.js',
    hasCompileStep: false
  },
  go: {
    sourceFile: 'main.go',
    compileCommand: 'go build -o main main.go',
    runCommand: './main',
    hasCompileStep: true
  },
  kotlin: {
    sourceFile: 'Main.kt',
    compileCommand: 'kotlinc Main.kt -include-runtime -d main.jar && [ -f main.jar ]',
    runCommand: 'java -jar main.jar',
    hasCompileStep: true
  },
  dart: {
    sourceFile: 'main.dart',
    compileCommand: null,
    runCommand: 'dart run main.dart',
    hasCompileStep: false
  }
};
const SUPPORTED_LANGUAGES = Object.keys(DOCKER_RUN_SPEC);

const RUNTIME_PROBE_COMMAND = {
  python: 'python3 --version',
  c: 'gcc --version | head -n 1',
  cpp: 'g++ --version | head -n 1',
  java: 'java -version 2>&1 | head -n 1',
  csharp: 'mono --version | head -n 1',
  nodejs: 'node --version',
  go: 'go version',
  kotlin: 'kotlinc -version 2>&1 | head -n 1',
  dart: 'dart --version 2>&1 | head -n 1'
};

function buildDockerSandboxCommand(language) {
  const spec = DOCKER_RUN_SPEC[language];
  if (!spec) {
    throw new Error(`Unsupported language for docker sandbox: ${language}`);
  }

  const compilePart = spec.compileCommand
    ? `(${spec.compileCommand} || exit ${COMPILE_ERROR_EXIT_CODE}); `
    : '';

  return `__boot_ns=$(date +%s%N); \
printf '%s' "$CODE_B64" | base64 -d > ${spec.sourceFile} \
&& printf '%s' "$STDIN_B64" | base64 -d > .stdin \
&& ${compilePart}__start_ns=$(date +%s%N); \
echo "${OPEN_TIME_MARKER}$((__start_ns - __boot_ns))" >&2; \
(${spec.runCommand} < .stdin); \
__status=$?; \
__end_ns=$(date +%s%N); \
echo "${EXEC_TIME_MARKER}$((__end_ns - __start_ns))" >&2; \
exit $__status`;
}

function stripExecutionMarker(stdout = '', stderr = '') {
  let executionNs = null;
  let openNs = null;

  const strip = (text) => {
    const lines = text.split('\n');
    const kept = [];
    for (const line of lines) {
      const match = line.match(new RegExp(`^${EXEC_TIME_MARKER}(\\d+)$`));
      if (match) {
        executionNs = Number(match[1]);
        continue;
      }
      const openMatch = line.match(new RegExp(`^${OPEN_TIME_MARKER}(\\d+)$`));
      if (openMatch) {
        openNs = Number(openMatch[1]);
        continue;
      }
      kept.push(line);
    }
    return kept.join('\n');
  };

  return {
    stdout: strip(stdout),
    stderr: strip(stderr),
    executionMs:
      executionNs === null || Number.isNaN(executionNs)
        ? null
        : Number((executionNs / 1_000_000).toFixed(3)),
    containerOpenMs:
      openNs === null || Number.isNaN(openNs) ? null : Number((openNs / 1_000_000).toFixed(3))
  };
}

function canExecute(command) {
  if (command.includes('/')) {
    return existsSync(command);
  }

  const localBin = path.join(BACKEND_DIR, 'node_modules', '.bin', command);
  if (existsSync(localBin)) {
    return true;
  }

  const result = spawnSync('/bin/sh', ['-lc', `command -v "${command}"`], {
    stdio: 'ignore'
  });
  return result.status === 0;
}

function resolveLspCommand(language) {
  const candidates = LSP_CANDIDATES[language] || [];
  for (const candidate of candidates) {
    if (canExecute(candidate.cmd)) {
      return candidate;
    }
  }
  return null;
}

function uriToWorkspacePath(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:') {
      return null;
    }

    const root = path.resolve(LSP_WORKSPACE_DIR);
    const rawPath = decodeURIComponent(parsed.pathname);
    const fsPath =
      process.platform === 'win32' && rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
    const normalized = path.resolve(fsPath);
    if (normalized !== root && !normalized.startsWith(`${root}${path.sep}`)) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

async function persistDocument(uri, text) {
  const fsPath = uriToWorkspacePath(uri);
  if (!fsPath) {
    return;
  }
  await mkdir(path.dirname(fsPath), { recursive: true });
  await writeFile(fsPath, text, 'utf8');
}

async function ensureLspWorkspaceScaffold(language) {
  if (language !== 'csharp') {
    return;
  }

  const editorConfigPath = path.join(LSP_WORKSPACE_DIR, '.editorconfig');
  await writeFile(
    editorConfigPath,
    `root = true

[*.cs]
dotnet_diagnostic.IDE0005.severity = none
`,
    'utf8'
  );

  const csprojPath = path.join(LSP_WORKSPACE_DIR, 'Main.csproj');
  await writeFile(
    csprojPath,
    `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
  </PropertyGroup>
</Project>
`,
    'utf8'
  );

  const mainCsPath = path.join(LSP_WORKSPACE_DIR, 'Main.cs');
  if (!existsSync(mainCsPath)) {
    await writeFile(
      mainCsPath,
      `using System;

public class Program
{
    public static void Main(string[] args)
    {
        Console.WriteLine("Hello, C#");
    }
}
`,
      'utf8'
    );
  }
}

function extractFullTextFromDidChange(params) {
  const contentChanges = params?.contentChanges;
  if (!Array.isArray(contentChanges) || contentChanges.length === 0) {
    return null;
  }
  const latest = contentChanges[contentChanges.length - 1];
  if (typeof latest?.text !== 'string') {
    return null;
  }
  return latest.text;
}

async function createLspBridge(ws, language) {
  await ensureLspWorkspaceScaffold(language);

  const selected = resolveLspCommand(language);
  if (!selected) {
    const candidateCommands = Array.from(
      new Set((LSP_CANDIDATES[language] || []).map((entry) => entry.cmd))
    );
    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'window/logMessage',
        params: {
          type: 1,
          message: `No LSP server found for ${language}. Please install one of: ${candidateCommands.join(
            ', '
          )}`
        }
      })
    );
    ws.close(1011, 'Missing LSP server');
    return;
  }

  const child = spawn(selected.cmd, selected.args, {
    cwd: LSP_WORKSPACE_DIR,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdoutBuffer = Buffer.alloc(0);

  const sendStdioMessageToWs = (jsonPayload) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(jsonPayload);
    }
  };

  const parseStdioMessages = (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);

    while (true) {
      const headerEnd = stdoutBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const header = stdoutBuffer.subarray(0, headerEnd).toString('utf8');
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
      if (!lengthMatch) {
        stdoutBuffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number(lengthMatch[1]);
      const fullLength = headerEnd + 4 + contentLength;
      if (stdoutBuffer.length < fullLength) {
        return;
      }

      const body = stdoutBuffer.subarray(headerEnd + 4, fullLength).toString('utf8');
      stdoutBuffer = stdoutBuffer.subarray(fullLength);
      sendStdioMessageToWs(body);
    }
  };

  child.stdout.on('data', parseStdioMessages);

  child.stderr.on('data', (chunk) => {
    const message = chunk.toString('utf8').trim();
    if (!message || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'window/logMessage',
        params: {
          type: 2,
          message
        }
      })
    );
  });

  ws.on('message', async (raw) => {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');

    try {
      const msg = JSON.parse(text);
      if (msg?.method === 'textDocument/didOpen') {
        await persistDocument(msg.params?.textDocument?.uri, msg.params?.textDocument?.text || '');
      }
      if (msg?.method === 'textDocument/didChange') {
        const changedText = extractFullTextFromDidChange(msg.params);
        if (changedText !== null) {
          await persistDocument(msg.params?.textDocument?.uri, changedText);
        }
      }
    } catch {
      // Ignore parse/disk-sync errors and continue forwarding to LSP.
    }

    const payload = Buffer.from(text, 'utf8');
    const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');
    child.stdin.write(header);
    child.stdin.write(payload);
  });

  ws.on('close', () => {
    child.kill();
  });

  child.on('exit', () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  child.on('error', () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, `Failed to start ${selected.cmd}`);
    }
  });
}

function runCommand(
  command,
  args,
  { cwd, timeoutMs = RUN_TIMEOUT_MS, input = null, onTimeout = null } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      if (onTimeout) {
        Promise.resolve(onTimeout()).catch(() => {});
      }
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code, timedOut });
    });

    if (typeof input === 'string') {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function isDockerSandboxAvailable() {
  return canExecute('docker') && existsSync(DOCKER_SOCKET_PATH);
}

function normalizeRuntimeInfo(language, rawOutput) {
  const line = String(rawOutput || '')
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .find(Boolean);

  if (!line) {
    return null;
  }

  if (language === 'python') {
    const match = line.match(/^Python\s+(.+)$/i);
    return match ? `Python ${match[1]}` : line;
  }

  if (language === 'java') {
    const match = line.match(/version "([^"]+)"/);
    return match ? `Java ${match[1]}` : line;
  }

  if (language === 'nodejs') {
    return line.replace(/^v/i, 'Node.js v');
  }

  return line;
}

async function probeRuntimeInDocker(language) {
  const command = RUNTIME_PROBE_COMMAND[language];
  if (!command) {
    return null;
  }

  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--cpus',
    '0.25',
    '--memory',
    '128m',
    '--pids-limit',
    '32',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=32m,uid=65534,gid=65534,mode=1777',
    '-e',
    'HOME=/tmp',
    '-u',
    SANDBOX_USER,
    '-w',
    '/tmp',
    SANDBOX_IMAGE,
    'sh',
    '-c',
    command
  ];

  const result = await runCommand('docker', args, { timeoutMs: 4000 });
  if (result.timedOut) {
    return null;
  }

  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return normalizeRuntimeInfo(language, combined);
}

async function probeRuntimeLocally(language) {
  const command = RUNTIME_PROBE_COMMAND[language];
  if (!command) {
    return null;
  }

  const result = await runCommand('sh', ['-c', command], { timeoutMs: 2500 });
  if (result.timedOut) {
    return null;
  }

  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return normalizeRuntimeInfo(language, combined);
}

async function getRuntimeInfo(language) {
  const cacheKey = `${SANDBOX_PROVIDER}:${language}`;
  const cached = runtimeInfoCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.updatedAt < RUNTIME_INFO_TTL_MS) {
    return cached.value;
  }

  try {
    const runtimeInfo =
      SANDBOX_PROVIDER === 'docker'
        ? await probeRuntimeInDocker(language)
        : await probeRuntimeLocally(language);
    runtimeInfoCache.set(cacheKey, { value: runtimeInfo, updatedAt: now });
    return runtimeInfo;
  } catch {
    runtimeInfoCache.set(cacheKey, { value: null, updatedAt: now });
    return null;
  }
}

function forceRemoveDockerContainer(containerName) {
  try {
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  } catch {
    // Ignore cleanup failures.
  }
}

async function runInDockerSandbox(language, code, stdinText = '') {
  const spec = DOCKER_RUN_SPEC[language];
  if (!spec) {
    throw new Error(`Unsupported language for docker sandbox: ${language}`);
  }
  const shellCommand = buildDockerSandboxCommand(language);
  const logs = [];
  const runtimeInfo = await getRuntimeInfo(language);

  const containerName = `web-run-${randomUUID().slice(0, 8)}`;
  logs.push('  sandbox container created');
  if (runtimeInfo) {
    logs.push(`  runtime: ${runtimeInfo}`);
  }
  if (spec.hasCompileStep) {
    logs.push('  compiling source code');
  }
  logs.push('  running code in sandbox container');
  const args = [
    'run',
    '--name',
    containerName,
    '--rm',
    '--network',
    'none',
    '--cpus',
    SANDBOX_CPU_LIMIT,
    '--memory',
    SANDBOX_MEMORY_LIMIT,
    '--pids-limit',
    String(SANDBOX_PIDS_LIMIT),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    `/workspace:rw,exec,nosuid,nodev,size=${SANDBOX_WORKSPACE_SIZE},uid=65534,gid=65534,mode=1777`,
    '--tmpfs',
    `/tmp:rw,noexec,nosuid,nodev,size=${SANDBOX_TMP_SIZE},uid=65534,gid=65534,mode=1777`,
    '-e',
    'HOME=/tmp',
    '-e',
    `JAVA_DEFAULT_CLASSPATH=${JAVA_DEFAULT_CLASSPATH}`,
    '-e',
    `CODE_B64=${Buffer.from(code, 'utf8').toString('base64')}`,
    '-e',
    `STDIN_B64=${Buffer.from(stdinText, 'utf8').toString('base64')}`,
    '-u',
    SANDBOX_USER,
    '-w',
    '/workspace',
    '-i',
    SANDBOX_IMAGE,
    'sh',
    '-c',
    shellCommand
  ];

  const result = await runCommand('docker', args, {
    onTimeout: () => forceRemoveDockerContainer(containerName)
  });

  if (result.timedOut) {
    forceRemoveDockerContainer(containerName);
  }

  const cleaned = stripExecutionMarker(result.stdout, result.stderr);
  if (typeof cleaned.containerOpenMs === 'number') {
    logs.push(`  sandbox open time: ${cleaned.containerOpenMs.toFixed(3)} ms`);
  }
  if (typeof cleaned.executionMs === 'number') {
    logs.push(`  code execution time: ${(cleaned.executionMs / 1000).toFixed(6)} s`);
  }

  return {
    ...result,
    stdout: cleaned.stdout,
    stderr: cleaned.stderr,
    executionMs: cleaned.executionMs,
    containerOpenMs: cleaned.containerOpenMs,
    logs,
    compileError: spec.hasCompileStep && result.code === COMPILE_ERROR_EXIT_CODE
  };
}

async function runCodeLocally(language, code, stdinText = '') {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'web-compiler-'));
  const logs = ['  running code locally (fallback mode)'];
  const runtimeInfo = await getRuntimeInfo(language);
  if (runtimeInfo) {
    logs.push(`  runtime: ${runtimeInfo}`);
  }

  try {
    if (language === 'python') {
      await writeFile(path.join(tempDir, 'main.py'), code, 'utf8');
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const result = await runCommand('python3', ['main.py'], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...result, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'c') {
      await writeFile(path.join(tempDir, 'main.c'), code, 'utf8');
      logs.push('  compiling source code');
      const compile = await runCommand('gcc', ['main.c', '-std=c11', '-O2', '-o', 'main'], {
        cwd: tempDir
      });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, logs, compileError: true };
      }
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand(path.join(tempDir, 'main'), [], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...run, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'cpp') {
      await writeFile(path.join(tempDir, 'main.cpp'), code, 'utf8');
      logs.push('  compiling source code');
      const compile = await runCommand('g++', ['main.cpp', '-std=c++17', '-O2', '-o', 'main'], {
        cwd: tempDir
      });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, logs, compileError: true };
      }
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand(path.join(tempDir, 'main'), [], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...run, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'java') {
      await writeFile(path.join(tempDir, 'Main.java'), code, 'utf8');
      logs.push('  compiling source code');
      const compile = await runCommand('javac', ['-cp', JAVA_DEFAULT_CLASSPATH, 'Main.java'], {
        cwd: tempDir
      });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, logs, compileError: true };
      }
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('java', ['-cp', `.:${JAVA_DEFAULT_CLASSPATH}`, 'Main'], {
        cwd: tempDir,
        input: stdinText
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...run, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'csharp') {
      await writeFile(path.join(tempDir, 'Main.cs'), code, 'utf8');
      logs.push('  compiling source code');
      const compile = await runCommand('mcs', ['-out:Main.exe', 'Main.cs'], { cwd: tempDir });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, logs, compileError: true };
      }
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('mono', ['Main.exe'], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...run, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'nodejs') {
      await writeFile(path.join(tempDir, 'main.js'), code, 'utf8');
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const result = await runCommand('node', ['main.js'], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...result, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'go') {
      await writeFile(path.join(tempDir, 'main.go'), code, 'utf8');
      logs.push('  compiling source code');
      const compile = await runCommand('go', ['build', '-o', 'main', 'main.go'], {
        cwd: tempDir
      });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, logs, compileError: true };
      }
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand(path.join(tempDir, 'main'), [], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...run, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'kotlin') {
      await writeFile(path.join(tempDir, 'Main.kt'), code, 'utf8');
      logs.push('  compiling source code');
      const compile = await runCommand(
        'kotlinc',
        ['Main.kt', '-include-runtime', '-d', 'main.jar'],
        { cwd: tempDir }
      );
      if (compile.code !== 0 || !existsSync(path.join(tempDir, 'main.jar'))) {
        return { ...compile, executionMs: null, logs, compileError: true };
      }
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('java', ['-jar', 'main.jar'], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...run, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'dart') {
      await writeFile(path.join(tempDir, 'main.dart'), code, 'utf8');
      logs.push('  running code');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('dart', ['run', 'main.dart'], { cwd: tempDir, input: stdinText });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...run, executionMs, containerOpenMs: null, logs, compileError: false };
    }

    throw new Error(`Unsupported language: ${language}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

app.post('/api/run', async (req, res) => {
  const { language, code, stdin = '' } = req.body ?? {};
  if (!language || !code) {
    res.status(400).json({ error: 'language and code are required' });
    return;
  }
  if (typeof stdin !== 'string') {
    res.status(400).json({ error: 'stdin must be a string' });
    return;
  }

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    res.status(400).json({ error: 'unsupported language' });
    return;
  }

  try {
    let result;
    if (SANDBOX_PROVIDER === 'docker') {
      if (!isDockerSandboxAvailable()) {
        res.status(500).json({
          error:
            'Docker sandbox is unavailable. Ensure docker CLI exists and /var/run/docker.sock is mounted.'
        });
        return;
      }
      result = await runInDockerSandbox(language, code, stdin);
    } else {
      result = await runCodeLocally(language, code, stdin);
    }

    if (result.compileError) {
      res.status(400).json({
        stdout: result.stdout,
        stderr: result.stderr || 'Compilation failed',
        executionMs: null,
        containerOpenMs:
          typeof result.containerOpenMs === 'number' ? result.containerOpenMs : null,
        logs: result.logs || []
      });
      return;
    }

    res.json({
      stdout: result.stdout,
      stderr: result.timedOut ? `${result.stderr}\nExecution timed out` : result.stderr,
      executionMs: typeof result.executionMs === 'number' ? result.executionMs : null,
      containerOpenMs: typeof result.containerOpenMs === 'number' ? result.containerOpenMs : null,
      logs: result.logs || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Execution error' });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

await mkdir(LSP_WORKSPACE_DIR, { recursive: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://localhost');
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (pathParts[0] !== 'lsp' || pathParts.length !== 2) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, pathParts[1]);
  });
});

wss.on('connection', (ws, language) => {
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    ws.close(1008, 'Unsupported language');
    return;
  }

  createLspBridge(ws, language).catch(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, `Failed to initialize LSP bridge for ${language}`);
    }
  });
});

server.listen(PORT, () => {
  if (SANDBOX_PROVIDER === 'docker') {
    const ready = isDockerSandboxAvailable();
    console.log(`[Sandbox] provider=docker image=${SANDBOX_IMAGE} ready=${ready}`);
  } else {
    console.log(`[Sandbox] provider=${SANDBOX_PROVIDER}`);
  }
  console.log(`Backend listening on http://localhost:${PORT}`);
});
