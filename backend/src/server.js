import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { OAuth2Client } from 'google-auth-library';
import { WebSocketServer, WebSocket } from 'ws';

const app = express();
app.use(express.json({ limit: '1mb' }));

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3001);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 30000);
const LSP_WORKSPACE_DIR = path.join(os.tmpdir(), 'web-vscode-workspace');
const DOCKER_SOCKET_PATH = '/var/run/docker.sock';
const DATA_DIR = process.env.DATA_DIR || path.join(BACKEND_DIR, 'data');
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'app.db');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const SESSION_COOKIE_NAME = 'sdycoder_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 30);

const SANDBOX_PROVIDER = process.env.SANDBOX_PROVIDER || 'docker';
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || 'web-vscode-backend:latest';
const SANDBOX_CPU_LIMIT = process.env.SANDBOX_CPU_LIMIT || '1.0';
const SANDBOX_MEMORY_LIMIT = process.env.SANDBOX_MEMORY_LIMIT || '512m';
const SANDBOX_PIDS_LIMIT = Number(process.env.SANDBOX_PIDS_LIMIT || 128);
const SANDBOX_MAX_CONTAINERS = Number(process.env.SANDBOX_MAX_CONTAINERS || 20);
const SANDBOX_WORKSPACE_SIZE = process.env.SANDBOX_WORKSPACE_SIZE || '256m';
const SANDBOX_TMP_SIZE = process.env.SANDBOX_TMP_SIZE || '128m';
const SANDBOX_USER = process.env.SANDBOX_USER || '65534:65534';
const JAVA_DEFAULT_CLASSPATH =
  process.env.JAVA_DEFAULT_CLASSPATH || '/usr/share/java/gson.jar:/usr/share/java/commons-lang3.jar';
const COMPILE_ERROR_EXIT_CODE = 42;
const EXEC_TIME_MARKER = '__WEB_EXEC_NS__=';
const OPEN_TIME_MARKER = '__WEB_OPEN_NS__=';
const COMPILE_TIME_MARKER = '__WEB_COMPILE_NS__=';
const SANDBOX_CPU_MARKER = '__WEB_SANDBOX_CPU_MILLI_PCT__=';
const SANDBOX_MEM_PEAK_MARKER = '__WEB_SANDBOX_MEM_PEAK_BYTES__=';
const PHASE_MARKER = '__WEB_PHASE__=';
const RUNTIME_INFO_TTL_MS = Number(process.env.RUNTIME_INFO_TTL_MS || 10 * 60 * 1000);
const runtimeInfoCache = new Map();
let sandboxActiveContainers = 0;
let sandboxQueueSeq = 0;
const sandboxWaitQueue = [];
const activeRunControls = new Map();
mkdirSync(path.dirname(SQLITE_DB_PATH), { recursive: true });
const db = new Database(SQLITE_DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  folder_id TEXT,
  language TEXT NOT NULL,
  content TEXT NOT NULL,
  stdin TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_files_user_id_updated_at ON files(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_folders_user_id_name ON folders(user_id, name);
`);
const fileColumns = db.prepare('PRAGMA table_info(files)').all();
if (!fileColumns.some((column) => column.name === 'stdin')) {
  db.exec(`ALTER TABLE files ADD COLUMN stdin TEXT NOT NULL DEFAULT ''`);
}
if (!fileColumns.some((column) => column.name === 'folder_id')) {
  db.exec(`ALTER TABLE files ADD COLUMN folder_id TEXT`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_files_user_id_folder_id ON files(user_id, folder_id)`);

const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function nowIso() {
  return new Date().toISOString();
}

function signSessionId(sessionId) {
  return createHmac('sha256', SESSION_SECRET).update(sessionId).digest('hex');
}

function createSignedSessionValue(sessionId) {
  return `${sessionId}.${signSessionId(sessionId)}`;
}

function verifySignedSessionValue(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const dotIndex = value.lastIndexOf('.');
  if (dotIndex <= 0) {
    return null;
  }
  const sessionId = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  const expected = signSessionId(sessionId);
  try {
    const left = Buffer.from(signature, 'hex');
    const right = Buffer.from(expected, 'hex');
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      return null;
    }
  } catch {
    return null;
  }
  return sessionId;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const [rawName, ...rest] = part.trim().split('=');
    if (!rawName || rest.length === 0) {
      return;
    }
    cookies[rawName] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

function setSessionCookie(res, sessionId) {
  const signed = createSignedSessionValue(sessionId);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function getSessionRecord(req) {
  const cookies = parseCookies(req);
  const signedValue = cookies[SESSION_COOKIE_NAME];
  const sessionId = verifySignedSessionValue(signedValue);
  if (!sessionId) {
    return null;
  }
  const row = db
    .prepare(
      `SELECT sessions.id, sessions.user_id, sessions.expires_at, users.email, users.name, users.avatar_url
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`
    )
    .get(sessionId);
  if (!row) {
    return null;
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return row;
}

function requireAuth(req, res, next) {
  const session = getSessionRecord(req);
  if (!session) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  req.user = {
    id: session.user_id,
    email: session.email,
    name: session.name,
    avatarUrl: session.avatar_url
  };
  req.sessionId = session.id;
  next();
}

function languageExists(language) {
  return SUPPORTED_LANGUAGES.includes(language);
}

function getStarterForLanguage(language) {
  switch (language) {
    case 'python':
      return `def solve():\n    print("Hello, Python")\n\nif __name__ == "__main__":\n    solve()\n`;
    case 'c':
      return `#include <stdio.h>\n\nint main(void) {\n    printf("Hello, C\\n");\n    return 0;\n}\n`;
    case 'cpp':
      return `#include <iostream>\n\nint main() {\n    std::cout << "Hello, C++" << std::endl;\n    return 0;\n}\n`;
    case 'java':
      return buildJavaStarter();
    case 'csharp':
      return `using System;\n\npublic class Program {\n    public static void Main(string[] args) {\n        Console.WriteLine("Hello, C#");\n    }\n}\n`;
    case 'nodejs':
      return `function solve() {\n  console.log("Hello, Node.js");\n}\n\nsolve();\n`;
    case 'go':
      return `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, Go")\n}\n`;
    case 'kotlin':
      return `fun main() {\n    println("Hello, Kotlin")\n}\n`;
    case 'dart':
      return `void main() {\n  print('Hello, Dart');\n}\n`;
    default:
      return '';
  }
}

function getFileExtension(language) {
  return DOCKER_RUN_SPEC[language]?.sourceFile?.split('.').pop() || 'txt';
}

function getJavaPrimaryTypeName(fileName = 'Main.java') {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .trim();
  const cleaned = base.replace(/[^A-Za-z0-9_$]/g, '');
  if (!cleaned) {
    return 'Main';
  }
  return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `Main${cleaned}`;
}

function buildJavaStarter(fileName = 'Main.java') {
  const className = getJavaPrimaryTypeName(fileName);
  return `public class ${className} {\n    public static void main(String[] args) {\n        System.out.println("Hello, Java");\n    }\n}\n`;
}

function sanitizeFileBaseName(raw) {
  const trimmed = String(raw || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ');
  return trimmed || 'untitled';
}

function normalizeFileName(name, language) {
  const base = sanitizeFileBaseName(name).replace(/\.[^.]+$/, '');
  return `${base}.${getFileExtension(language)}`;
}

function normalizeFolderName(name) {
  return String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ');
}

function serializeUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl || user.avatar_url || null
  };
}

class RunCancelledError extends Error {
  constructor(message = 'Execution cancelled by user') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

function parseMemoryLimitToBytes(raw) {
  if (!raw) {
    return null;
  }
  const text = String(raw).trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)([kmgt]?)(b)?$/);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  const unit = match[2] || '';
  const scale =
    unit === 'k'
      ? 1024
      : unit === 'm'
        ? 1024 ** 2
        : unit === 'g'
          ? 1024 ** 3
          : unit === 't'
            ? 1024 ** 4
            : 1;
  return Math.round(value * scale);
}

function createRunControl() {
  const abortHandlers = new Set();
  return {
    aborted: false,
    abortReason: null,
    abort(reason = 'Execution cancelled by user') {
      if (this.aborted) {
        return;
      }
      this.aborted = true;
      this.abortReason = reason;
      for (const fn of abortHandlers) {
        try {
          fn(reason);
        } catch {
          // Ignore abort handler failures.
        }
      }
      abortHandlers.clear();
    },
    onAbort(fn) {
      if (typeof fn !== 'function') {
        return () => {};
      }
      if (this.aborted) {
        fn(this.abortReason || 'Execution cancelled by user');
        return () => {};
      }
      abortHandlers.add(fn);
      return () => abortHandlers.delete(fn);
    }
  };
}

function notifySandboxQueuePositions() {
  sandboxWaitQueue.forEach((entry, index) => {
    if (typeof entry.onQueueEvent === 'function') {
      entry.onQueueEvent({ phase: 'queue_wait_update', position: index + 1 });
    }
  });
}

function tryGrantSandboxQueue() {
  if (sandboxActiveContainers >= SANDBOX_MAX_CONTAINERS) {
    return;
  }
  if (sandboxWaitQueue.length === 0) {
    return;
  }

  const entry = sandboxWaitQueue.shift();
  sandboxActiveContainers += 1;
  const queueWaitMs = Date.now() - entry.enqueuedAt;
  if (typeof entry.onQueueEvent === 'function') {
    entry.onQueueEvent({
      phase: 'queue_wait_end',
      ms: queueWaitMs,
      position: entry.queuePositionAtEnqueue
    });
  }
  entry.resolve({ queueWaitMs, queuePositionAtEnqueue: entry.queuePositionAtEnqueue });
  notifySandboxQueuePositions();
}

function acquireSandboxSlot({ onQueueEvent = null, runControl = null } = {}) {
  if (SANDBOX_PROVIDER !== 'docker') {
    return Promise.resolve({ queueWaitMs: 0, queuePositionAtEnqueue: null });
  }

  if (runControl?.aborted) {
    return Promise.reject(new RunCancelledError(runControl.abortReason || 'Execution cancelled by user'));
  }

  if (sandboxActiveContainers < SANDBOX_MAX_CONTAINERS) {
    sandboxActiveContainers += 1;
    return Promise.resolve({ queueWaitMs: 0, queuePositionAtEnqueue: null });
  }

  return new Promise((resolve, reject) => {
    const queuePositionAtEnqueue = sandboxWaitQueue.length + 1;
    const entry = {
      id: ++sandboxQueueSeq,
      enqueuedAt: Date.now(),
      queuePositionAtEnqueue,
      onQueueEvent,
      resolve,
      reject
    };
    sandboxWaitQueue.push(entry);
    let unsubscribe = () => {};
    const resolveWithCleanup = (value) => {
      unsubscribe();
      resolve(value);
    };
    entry.resolve = resolveWithCleanup;
    if (typeof onQueueEvent === 'function') {
      onQueueEvent({ phase: 'queue_wait_start', position: queuePositionAtEnqueue });
    }
    notifySandboxQueuePositions();

    if (runControl) {
      unsubscribe = runControl.onAbort(() => {
        const idx = sandboxWaitQueue.findIndex((item) => item.id === entry.id);
        if (idx !== -1) {
          sandboxWaitQueue.splice(idx, 1);
          notifySandboxQueuePositions();
          reject(new RunCancelledError(runControl.abortReason || 'Execution cancelled by user'));
        }
        unsubscribe();
      });
    }
  });
}

function releaseSandboxSlot() {
  if (SANDBOX_PROVIDER !== 'docker') {
    return;
  }
  sandboxActiveContainers = Math.max(0, sandboxActiveContainers - 1);
  tryGrantSandboxQueue();
}

async function runWithSandboxQueue(runFn, { onQueueEvent = null, runControl = null } = {}) {
  const slot = await acquireSandboxSlot({ onQueueEvent, runControl });
  let released = false;
  const release = () => {
    if (released) {
      return;
    }
    released = true;
    releaseSandboxSlot();
  };

  try {
    const result = await runFn();
    return {
      ...result,
      queueWaitMs: slot.queueWaitMs,
      queuePositionAtEnqueue: slot.queuePositionAtEnqueue
    };
  } finally {
    release();
  }
}

const LSP_CANDIDATES = {
  python: [
    { cmd: 'basedpyright-langserver', args: ['--stdio'] },
    { cmd: 'pyright-langserver', args: ['--stdio'] },
    { cmd: 'python-lsp-server', args: [] },
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
    compileCommand: 'kotlinc Main.kt -d main.jar && [ -f main.jar ]',
    runCommand: 'java -cp "main.jar:/opt/kotlinc/lib/*" MainKt',
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
const IMPORT_SUGGESTION_CACHE = new Map();

function readLines(output = '') {
  return String(output)
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listWorkspaceNodePackages() {
  const results = new Set();

  const packageJsonPath = path.join(LSP_WORKSPACE_DIR, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].forEach((field) => {
        const deps = pkg?.[field];
        if (deps && typeof deps === 'object') {
          Object.keys(deps).forEach((name) => results.add(name));
        }
      });
    } catch {
      // Ignore malformed package.json.
    }
  }

  const nodeModulesPath = path.join(LSP_WORKSPACE_DIR, 'node_modules');
  if (existsSync(nodeModulesPath)) {
    try {
      for (const entry of readdirSync(nodeModulesPath)) {
        if (!entry || entry.startsWith('.')) {
          continue;
        }
        if (entry.startsWith('@')) {
          const scopedDir = path.join(nodeModulesPath, entry);
          for (const sub of readdirSync(scopedDir)) {
            if (sub && !sub.startsWith('.')) {
              results.add(`${entry}/${sub}`);
            }
          }
          continue;
        }
        results.add(entry);
      }
    } catch {
      // Ignore node_modules scan failures.
    }
  }

  return Array.from(results).sort();
}

function listImportPackages(language) {
  const cacheKey = `${language}:packages`;
  const cached = IMPORT_SUGGESTION_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  let result = [];

  if (language === 'python') {
    const probe = spawnSync(
      'python3',
      [
        '-c',
        [
          'import pkgutil',
          'mods = sorted({m.name.split(".")[0] for m in pkgutil.iter_modules()})',
          'print("\\n".join(mods))'
        ].join('; ')
      ],
      { encoding: 'utf8' }
    );
    if (probe.status === 0) {
      result = readLines(probe.stdout);
    }
  } else if (language === 'nodejs') {
    const probe = spawnSync(
      'node',
      [
        '-e',
        [
          'const fs = require("fs");',
          'const path = require("path");',
          'const cp = require("child_process");',
          'const { builtinModules } = require("module");',
          'const mods = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));',
          'try {',
          '  const root = cp.execSync("npm root -g", { encoding: "utf8" }).trim();',
          '  for (const entry of fs.readdirSync(root)) {',
          '    if (!entry || entry.startsWith(".")) continue;',
          '    if (entry.startsWith("@")) {',
          '      for (const sub of fs.readdirSync(path.join(root, entry))) {',
          '        mods.add(`${entry}/${sub}`);',
          '      }',
          '      continue;',
          '    }',
          '    mods.add(entry);',
          '  }',
          '} catch {}',
          'console.log(Array.from(mods).sort().join("\\n"));'
        ].join(' ')
      ],
      { encoding: 'utf8' }
    );
    if (probe.status === 0) {
      result = Array.from(new Set([...readLines(probe.stdout), ...listWorkspaceNodePackages()])).sort();
    }
  } else if (language === 'go') {
    const probe = spawnSync('go', ['list', 'std'], { encoding: 'utf8' });
    if (probe.status === 0) {
      result = readLines(probe.stdout);
    }
  } else if (language === 'java') {
    const javaHome = process.env.JAVA_HOME || '/opt/java/jdk-21';
    const modulesPath = path.join(javaHome, 'lib', 'modules');
    const probe = spawnSync(
      'sh',
      [
        '-lc',
        [
          `[ -f "${modulesPath}" ] || exit 0`,
          `jimage list "${modulesPath}" 2>/dev/null`,
          `| grep '\\.class$'`,
          `| grep -v 'module-info\\.class$'`,
          `| sed 's#^/##'`,
          `| sed 's#/#.#g'`,
          `| sed 's#\\.class$##'`,
          `| sed '/\\$/{d;}'`
        ].join(' ')
      ],
      { encoding: 'utf8' }
    );
    if (probe.status === 0) {
      const classes = readLines(probe.stdout);
      const names = new Set(classes);
      for (const className of classes) {
        const parts = className.split('.');
        for (let i = 1; i < parts.length; i += 1) {
          names.add(parts.slice(0, i).join('.'));
        }
      }
      result = Array.from(names).sort();
    }
  } else if (language === 'csharp') {
    const probe = spawnSync(
      'sh',
      [
        '-lc',
        [
          'find /usr/share/dotnet /usr/lib/mono \\( -name "*.dll" -o -name "*.exe" \\) 2>/dev/null',
          '| head -n 400',
          '| xargs -r strings -n 8 2>/dev/null',
          `| grep -E '^[A-Z][A-Za-z0-9_]*(\\.[A-Z][A-Za-z0-9_]*)+$'`,
          `| grep -vE '\\.(resources|XmlSerializers)$'`,
          '| sort -u'
        ].join(' ')
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    if (probe.status === 0) {
      result = readLines(probe.stdout);
    } else {
      result = [
        'System',
        'System.Collections.Generic',
        'System.IO',
        'System.Linq',
        'System.Net.Http',
        'System.Text',
        'System.Threading',
        'System.Threading.Tasks'
      ];
    }
  }

  IMPORT_SUGGESTION_CACHE.set(cacheKey, result);
  return result;
}

function listPythonModuleSymbols(moduleName) {
  if (!moduleName) {
    return [];
  }
  const cacheKey = `python:members:${moduleName}`;
  const cached = IMPORT_SUGGESTION_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const probe = spawnSync(
    'python3',
    [
      '-c',
      [
        'import importlib, json, pkgutil, sys',
        `module_name = ${JSON.stringify(moduleName)}`,
        'mod = importlib.import_module(module_name)',
        'names = {name for name in dir(mod) if not name.startswith("_")}',
        'module_path = getattr(mod, "__path__", None)',
        'if module_path:',
        '  names.update({item.name for item in pkgutil.iter_modules(module_path)})',
        'print(json.dumps(sorted(names)))'
      ].join('; ')
    ],
    { encoding: 'utf8' }
  );

  let result = [];
  if (probe.status === 0) {
    try {
      const parsed = JSON.parse(probe.stdout || '[]');
      if (Array.isArray(parsed)) {
        result = parsed.filter((item) => typeof item === 'string');
      }
    } catch {
      result = [];
    }
  }

  IMPORT_SUGGESTION_CACHE.set(cacheKey, result);
  return result;
}

function buildDockerSandboxCommand(language) {
  const spec = DOCKER_RUN_SPEC[language];
  if (!spec) {
    throw new Error(`Unsupported language for docker sandbox: ${language}`);
  }

  const compilePart = spec.compileCommand
    ? `echo "${PHASE_MARKER}compile_start" >&2; \
__compile_start_ns=$(date +%s%N); \
(${spec.compileCommand}); \
__compile_status=$?; \
__compile_end_ns=$(date +%s%N); \
echo "${COMPILE_TIME_MARKER}$((__compile_end_ns - __compile_start_ns))" >&2; \
echo "${PHASE_MARKER}compile_end:$((__compile_end_ns - __compile_start_ns))" >&2; \
[ $__compile_status -eq 0 ] || exit ${COMPILE_ERROR_EXIT_CODE}; `
    : '';

  return `__boot_ns=$(date +%s%N); \
printf '%s' "$CODE_B64" | base64 -d > ${spec.sourceFile} \
&& printf '%s' "$STDIN_B64" | base64 -d > .stdin \
&& __opened_ns=$(date +%s%N); \
echo "${OPEN_TIME_MARKER}$((__opened_ns - __boot_ns))" >&2; \
echo "${PHASE_MARKER}open_done:$((__opened_ns - __boot_ns))" >&2; \
${compilePart}__start_ns=$(date +%s%N); \
echo "${PHASE_MARKER}run_start" >&2; \
__cpu_start_us=$(awk '/usage_usec/ {print $2}' /sys/fs/cgroup/cpu.stat 2>/dev/null || echo 0); \
(${spec.runCommand} < .stdin); \
__status=$?; \
__end_ns=$(date +%s%N); \
__cpu_end_us=$(awk '/usage_usec/ {print $2}' /sys/fs/cgroup/cpu.stat 2>/dev/null || echo 0); \
__wall_us=$(((__end_ns - __start_ns) / 1000)); \
if [ "$__wall_us" -gt 0 ]; then __cpu_milli_pct=$(( (__cpu_end_us - __cpu_start_us) * 100000 / __wall_us )); else __cpu_milli_pct=0; fi; \
__mem_peak_bytes=$(cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory.max_usage_in_bytes 2>/dev/null || echo 0); \
echo "${EXEC_TIME_MARKER}$((__end_ns - __start_ns))" >&2; \
echo "${PHASE_MARKER}run_end:$((__end_ns - __start_ns))" >&2; \
echo "${SANDBOX_CPU_MARKER}\${__cpu_milli_pct}" >&2; \
echo "${SANDBOX_MEM_PEAK_MARKER}\${__mem_peak_bytes}" >&2; \
exit $__status`;
}

function stripExecutionMarker(stdout = '', stderr = '') {
  let executionNs = null;
  let openNs = null;
  let compileNs = null;
  let sandboxCpuMilliPct = null;
  let sandboxMemPeakBytes = null;

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
      const compileMatch = line.match(new RegExp(`^${COMPILE_TIME_MARKER}(\\d+)$`));
      if (compileMatch) {
        compileNs = Number(compileMatch[1]);
        continue;
      }
      const cpuMatch = line.match(new RegExp(`^${SANDBOX_CPU_MARKER}(-?\\d+)$`));
      if (cpuMatch) {
        sandboxCpuMilliPct = Number(cpuMatch[1]);
        continue;
      }
      const memMatch = line.match(new RegExp(`^${SANDBOX_MEM_PEAK_MARKER}(\\d+)$`));
      if (memMatch) {
        sandboxMemPeakBytes = Number(memMatch[1]);
        continue;
      }
      if (line.startsWith(PHASE_MARKER)) {
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
    compileMs:
      compileNs === null || Number.isNaN(compileNs) ? null : Number((compileNs / 1_000_000).toFixed(3)),
    sandboxCpuPercent:
      sandboxCpuMilliPct === null || Number.isNaN(sandboxCpuMilliPct)
        ? null
        : Number((sandboxCpuMilliPct / 1000).toFixed(3)),
    sandboxMemoryPeakBytes:
      sandboxMemPeakBytes === null || Number.isNaN(sandboxMemPeakBytes) ? null : sandboxMemPeakBytes,
    containerOpenMs:
      openNs === null || Number.isNaN(openNs) ? null : Number((openNs / 1_000_000).toFixed(3))
  };
}

function parsePhaseMarker(line) {
  if (!line || !line.startsWith(PHASE_MARKER)) {
    return null;
  }

  const raw = line.slice(PHASE_MARKER.length);
  const [phase, value] = raw.split(':');
  if (!phase) {
    return null;
  }

  if (value && /^\d+$/.test(value)) {
    const ms = Number((Number(value) / 1_000_000).toFixed(3));
    return { phase, ms };
  }
  return { phase };
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

function resolveExecutablePath(command) {
  if (command.includes('/')) {
    return existsSync(command) ? command : null;
  }

  const localBin = path.join(BACKEND_DIR, 'node_modules', '.bin', command);
  if (existsSync(localBin)) {
    return localBin;
  }

  const result = spawnSync('/bin/sh', ['-lc', `command -v "${command}"`], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return null;
  }

  const resolved = (result.stdout || '').trim().split('\n')[0];
  return resolved || null;
}

function resolveLspCommand(language) {
  const candidates = LSP_CANDIDATES[language] || [];
  for (const candidate of candidates) {
    const resolvedCmd = resolveExecutablePath(candidate.cmd);
    if (resolvedCmd) {
      return {
        ...candidate,
        resolvedCmd
      };
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

function getLspWorkspaceDir(language) {
  return path.join(LSP_WORKSPACE_DIR, language);
}

async function persistDocument(uri, text) {
  const fsPath = uriToWorkspacePath(uri);
  if (!fsPath) {
    return;
  }
  await mkdir(path.dirname(fsPath), { recursive: true });
  await writeFile(fsPath, text, 'utf8');
}

async function removePersistedDocument(uri) {
  const fsPath = uriToWorkspacePath(uri);
  if (!fsPath) {
    return;
  }
  await rm(fsPath, { force: true });
}

async function ensureLspWorkspaceScaffold(language, workspaceDir) {
  if (language === 'go') {
    const workspaceEntries = await readdir(workspaceDir, { withFileTypes: true }).catch(() => []);
    for (const entry of workspaceEntries) {
      if (!entry.isFile()) {
        continue;
      }
      const shouldKeep = entry.name === 'go.mod' || entry.name.endsWith('.go');
      if (!shouldKeep) {
        await rm(path.join(workspaceDir, entry.name), { force: true });
      }
    }

    const goModPath = path.join(workspaceDir, 'go.mod');
    await writeFile(
      goModPath,
      `module playground

go 1.24
`,
      'utf8'
    );
    return;
  }

  if (language !== 'csharp') {
    return;
  }

  const editorConfigPath = path.join(workspaceDir, '.editorconfig');
  await writeFile(
    editorConfigPath,
    `root = true

[*.cs]
dotnet_diagnostic.IDE0005.severity = none
`,
    'utf8'
  );

  const csprojPath = path.join(workspaceDir, 'Main.csproj');
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

  const mainCsPath = path.join(workspaceDir, 'Main.cs');
  if (existsSync(mainCsPath)) {
    await rm(mainCsPath, { force: true });
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
  const workspaceDir = getLspWorkspaceDir(language);
  await mkdir(workspaceDir, { recursive: true });
  await ensureLspWorkspaceScaffold(language, workspaceDir);

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

  const child = spawn(selected.resolvedCmd || selected.cmd, selected.args, {
    cwd: workspaceDir,
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
      if (msg?.method === 'textDocument/didClose') {
        await removePersistedDocument(msg.params?.textDocument?.uri);
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
      ws.close(1011, `Failed to start ${selected.resolvedCmd || selected.cmd}`);
    }
  });
}

function runCommand(
  command,
  args,
  {
    cwd,
    timeoutMs = RUN_TIMEOUT_MS,
    input = null,
    onTimeout = null,
    onStdoutChunk = null,
    onStderrChunk = null,
    runControl = null
  } = {}
) {
  return new Promise((resolve, reject) => {
    if (runControl?.aborted) {
      reject(new RunCancelledError(runControl.abortReason || 'Execution cancelled by user'));
      return;
    }

    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let abortUnsubscribe = null;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      if (onTimeout) {
        Promise.resolve(onTimeout()).catch(() => {});
      }
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      const text = data.toString('utf8');
      stdout += text;
      if (typeof onStdoutChunk === 'function') {
        onStdoutChunk(text);
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString('utf8');
      stderr += text;
      if (typeof onStderrChunk === 'function') {
        onStderrChunk(text);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      if (abortUnsubscribe) {
        abortUnsubscribe();
      }
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (abortUnsubscribe) {
        abortUnsubscribe();
      }
      if (cancelled || runControl?.aborted) {
        reject(new RunCancelledError(runControl?.abortReason || 'Execution cancelled by user'));
        return;
      }
      resolve({ stdout, stderr, code, timedOut });
    });

    if (runControl) {
      abortUnsubscribe = runControl.onAbort(() => {
        cancelled = true;
        child.kill('SIGKILL');
      });
    }

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

function getRuntimeInfoFromCache(language) {
  const cacheKey = `${SANDBOX_PROVIDER}:${language}`;
  const cached = runtimeInfoCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt >= RUNTIME_INFO_TTL_MS) {
    return null;
  }
  return cached.value;
}

function forceRemoveDockerContainer(containerName) {
  try {
    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  } catch {
    // Ignore cleanup failures.
  }
}

async function runInDockerSandbox(language, code, stdinText = '', options = {}) {
  const { onPhase = null, onStdout = null, onStderr = null, runControl = null } = options;
  const spec = DOCKER_RUN_SPEC[language];
  if (!spec) {
    throw new Error(`Unsupported language for docker sandbox: ${language}`);
  }
  const shellCommand = buildDockerSandboxCommand(language);
  const logs = [];
  const runtimeInfo = getRuntimeInfoFromCache(language);
  void getRuntimeInfo(language);

  const containerName = `web-run-${randomUUID().slice(0, 8)}`;
  const unsubscribeAbort =
    runControl && SANDBOX_PROVIDER === 'docker'
      ? runControl.onAbort(() => forceRemoveDockerContainer(containerName))
      : null;
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

  let phaseBuffer = '';
  let stderrRelayBuffer = '';
  let hostContainerOpenMs = null;
  const dockerRunStartedAt = process.hrtime.bigint();
  const emitPhase = (event) => {
    if (typeof onPhase === 'function' && event?.phase) {
      onPhase(event);
    }
  };

  const emitStdout = (chunk) => {
    if (typeof onStdout === 'function' && chunk) {
      onStdout(chunk);
    }
  };

  const emitStderr = (chunk) => {
    if (typeof onStderr === 'function' && chunk) {
      onStderr(chunk);
    }
  };

  const parsePhaseChunks = (chunk) => {
    phaseBuffer += chunk;
    stderrRelayBuffer += chunk;
    while (true) {
      const newlineIdx = phaseBuffer.indexOf('\n');
      if (newlineIdx === -1) {
        break;
      }
      const line = phaseBuffer.slice(0, newlineIdx).replace(/\r$/, '');
      phaseBuffer = phaseBuffer.slice(newlineIdx + 1);
      const parsed = parsePhaseMarker(line);
      if (parsed) {
        if (parsed.phase === 'open_done' && hostContainerOpenMs === null) {
          hostContainerOpenMs = Number(
            (Number(process.hrtime.bigint() - dockerRunStartedAt) / 1_000_000).toFixed(3)
          );
          emitPhase({ ...parsed, ms: hostContainerOpenMs });
          continue;
        }
        emitPhase(parsed);
      }
    }

    while (true) {
      const newlineIdx = stderrRelayBuffer.indexOf('\n');
      if (newlineIdx === -1) {
        break;
      }
      const rawLine = stderrRelayBuffer.slice(0, newlineIdx + 1);
      stderrRelayBuffer = stderrRelayBuffer.slice(newlineIdx + 1);
      const normalized = rawLine.replace(/\r?\n$/, '');
      if (
        normalized.startsWith(PHASE_MARKER) ||
        normalized.startsWith(EXEC_TIME_MARKER) ||
        normalized.startsWith(OPEN_TIME_MARKER) ||
        normalized.startsWith(COMPILE_TIME_MARKER) ||
        normalized.startsWith(SANDBOX_CPU_MARKER) ||
        normalized.startsWith(SANDBOX_MEM_PEAK_MARKER)
      ) {
        continue;
      }
      emitStderr(rawLine);
    }
  };

  let result;
  try {
    result = await runCommand('docker', args, {
      onTimeout: () => forceRemoveDockerContainer(containerName),
      onStdoutChunk: emitStdout,
      onStderrChunk: parsePhaseChunks,
      runControl
    });
  } finally {
    if (unsubscribeAbort) {
      unsubscribeAbort();
    }
  }

  if (phaseBuffer) {
    const parsed = parsePhaseMarker(phaseBuffer.replace(/\r$/, ''));
    if (parsed) {
      if (parsed.phase === 'open_done' && hostContainerOpenMs === null) {
        hostContainerOpenMs = Number(
          (Number(process.hrtime.bigint() - dockerRunStartedAt) / 1_000_000).toFixed(3)
        );
        emitPhase({ ...parsed, ms: hostContainerOpenMs });
      } else {
        emitPhase(parsed);
      }
    }
  }

  if (stderrRelayBuffer) {
    const normalized = stderrRelayBuffer.replace(/\r?\n$/, '');
    if (
      normalized &&
      !normalized.startsWith(PHASE_MARKER) &&
      !normalized.startsWith(EXEC_TIME_MARKER) &&
      !normalized.startsWith(OPEN_TIME_MARKER) &&
      !normalized.startsWith(COMPILE_TIME_MARKER) &&
      !normalized.startsWith(SANDBOX_CPU_MARKER) &&
      !normalized.startsWith(SANDBOX_MEM_PEAK_MARKER)
    ) {
      emitStderr(stderrRelayBuffer);
    }
  }

  if (result.timedOut) {
    forceRemoveDockerContainer(containerName);
  }

  const cleaned = stripExecutionMarker(result.stdout, result.stderr);
  if (hostContainerOpenMs !== null) {
    cleaned.containerOpenMs = hostContainerOpenMs;
  }
  if (typeof cleaned.containerOpenMs === 'number') {
    logs.push(`  sandbox open time: ${cleaned.containerOpenMs.toFixed(3)} ms`);
  }
  if (typeof cleaned.executionMs === 'number') {
    logs.push(`  code execution time: ${(cleaned.executionMs / 1000).toFixed(6)} s`);
  }
  if (typeof cleaned.compileMs === 'number') {
    logs.push(`  compile time: ${(cleaned.compileMs / 1000).toFixed(6)} s`);
  }
  if (typeof cleaned.sandboxCpuPercent === 'number') {
    logs.push(`  sandbox cpu usage: ${cleaned.sandboxCpuPercent.toFixed(3)} %`);
  }
  if (typeof cleaned.sandboxMemoryPeakBytes === 'number') {
    logs.push(`  sandbox memory peak: ${cleaned.sandboxMemoryPeakBytes} bytes`);
  }

  return {
    ...result,
    stdout: cleaned.stdout,
    stderr: cleaned.stderr,
    executionMs: cleaned.executionMs,
    compileMs: cleaned.compileMs,
    sandboxCpuPercent: cleaned.sandboxCpuPercent,
    sandboxMemoryPeakBytes: cleaned.sandboxMemoryPeakBytes,
    sandboxCpuLimit: Number(SANDBOX_CPU_LIMIT),
    sandboxMemoryLimitBytes: parseMemoryLimitToBytes(SANDBOX_MEMORY_LIMIT),
    containerOpenMs: cleaned.containerOpenMs,
    logs,
    compileError: spec.hasCompileStep && result.code === COMPILE_ERROR_EXIT_CODE
  };
}

async function runCodeLocally(language, code, stdinText = '', options = {}) {
  const { onPhase = null, runControl = null } = options;
  const emitPhase = (phase, extra = {}) => {
    if (typeof onPhase === 'function') {
      onPhase({ phase, ...extra });
    }
  };
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'web-compiler-'));
  const logs = ['  running code locally (fallback mode)'];
  const runtimeInfo = getRuntimeInfoFromCache(language);
  void getRuntimeInfo(language);
  if (runtimeInfo) {
    logs.push(`  runtime: ${runtimeInfo}`);
  }

  try {
    emitPhase('open_done', { ms: 0 });

    if (language === 'python') {
      await writeFile(path.join(tempDir, 'main.py'), code, 'utf8');
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const result = await runCommand('python3', ['main.py'], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return { ...result, executionMs, compileMs: null, containerOpenMs: null, logs, compileError: false };
    }

    if (language === 'c') {
      await writeFile(path.join(tempDir, 'main.c'), code, 'utf8');
      logs.push('  compiling source code');
      emitPhase('compile_start');
      const compileStartedAt = process.hrtime.bigint();
      const compile = await runCommand('gcc', ['main.c', '-std=c11', '-O2', '-o', 'main'], {
        cwd: tempDir,
        runControl
      });
      const compileMs = Number((Number(process.hrtime.bigint() - compileStartedAt) / 1_000_000).toFixed(3));
      emitPhase('compile_end', { ms: compileMs });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, compileMs, logs, compileError: true };
      }
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand(path.join(tempDir, 'main'), [], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...run,
        executionMs,
        compileMs,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    if (language === 'cpp') {
      await writeFile(path.join(tempDir, 'main.cpp'), code, 'utf8');
      logs.push('  compiling source code');
      emitPhase('compile_start');
      const compileStartedAt = process.hrtime.bigint();
      const compile = await runCommand('g++', ['main.cpp', '-std=c++17', '-O2', '-o', 'main'], {
        cwd: tempDir,
        runControl
      });
      const compileMs = Number((Number(process.hrtime.bigint() - compileStartedAt) / 1_000_000).toFixed(3));
      emitPhase('compile_end', { ms: compileMs });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, compileMs, logs, compileError: true };
      }
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand(path.join(tempDir, 'main'), [], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...run,
        executionMs,
        compileMs,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    if (language === 'java') {
      await writeFile(path.join(tempDir, 'Main.java'), code, 'utf8');
      logs.push('  compiling source code');
      emitPhase('compile_start');
      const compileStartedAt = process.hrtime.bigint();
      const compile = await runCommand('javac', ['-cp', JAVA_DEFAULT_CLASSPATH, 'Main.java'], {
        cwd: tempDir,
        runControl
      });
      const compileMs = Number((Number(process.hrtime.bigint() - compileStartedAt) / 1_000_000).toFixed(3));
      emitPhase('compile_end', { ms: compileMs });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, compileMs, logs, compileError: true };
      }
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('java', ['-cp', `.:${JAVA_DEFAULT_CLASSPATH}`, 'Main'], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...run,
        executionMs,
        compileMs,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    if (language === 'csharp') {
      await writeFile(path.join(tempDir, 'Main.cs'), code, 'utf8');
      logs.push('  compiling source code');
      emitPhase('compile_start');
      const compileStartedAt = process.hrtime.bigint();
      const compile = await runCommand('mcs', ['-out:Main.exe', 'Main.cs'], {
        cwd: tempDir,
        runControl
      });
      const compileMs = Number((Number(process.hrtime.bigint() - compileStartedAt) / 1_000_000).toFixed(3));
      emitPhase('compile_end', { ms: compileMs });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, compileMs, logs, compileError: true };
      }
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('mono', ['Main.exe'], { cwd: tempDir, input: stdinText, runControl });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...run,
        executionMs,
        compileMs,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    if (language === 'nodejs') {
      await writeFile(path.join(tempDir, 'main.js'), code, 'utf8');
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const result = await runCommand('node', ['main.js'], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...result,
        executionMs,
        compileMs: null,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    if (language === 'go') {
      await writeFile(path.join(tempDir, 'main.go'), code, 'utf8');
      logs.push('  compiling source code');
      emitPhase('compile_start');
      const compileStartedAt = process.hrtime.bigint();
      const compile = await runCommand('go', ['build', '-o', 'main', 'main.go'], {
        cwd: tempDir,
        runControl
      });
      const compileMs = Number((Number(process.hrtime.bigint() - compileStartedAt) / 1_000_000).toFixed(3));
      emitPhase('compile_end', { ms: compileMs });
      if (compile.code !== 0) {
        return { ...compile, executionMs: null, compileMs, logs, compileError: true };
      }
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand(path.join(tempDir, 'main'), [], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...run,
        executionMs,
        compileMs,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    if (language === 'kotlin') {
      await writeFile(path.join(tempDir, 'Main.kt'), code, 'utf8');
      logs.push('  compiling source code');
      emitPhase('compile_start');
      const compileStartedAt = process.hrtime.bigint();
      const compile = await runCommand('kotlinc', ['Main.kt', '-d', 'main.jar'], {
        cwd: tempDir,
        runControl
      });
      const compileMs = Number((Number(process.hrtime.bigint() - compileStartedAt) / 1_000_000).toFixed(3));
      emitPhase('compile_end', { ms: compileMs });
      if (compile.code !== 0 || !existsSync(path.join(tempDir, 'main.jar'))) {
        return { ...compile, executionMs: null, compileMs, logs, compileError: true };
      }
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('java', ['-cp', 'main.jar:/opt/kotlinc/lib/*', 'MainKt'], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...run,
        executionMs,
        compileMs,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    if (language === 'dart') {
      await writeFile(path.join(tempDir, 'main.dart'), code, 'utf8');
      logs.push('  running code');
      emitPhase('run_start');
      const startedAt = process.hrtime.bigint();
      const run = await runCommand('dart', ['run', 'main.dart'], {
        cwd: tempDir,
        input: stdinText,
        runControl
      });
      const executionMs = Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(3));
      emitPhase('run_end', { ms: executionMs });
      logs.push(`  code execution time: ${(executionMs / 1000).toFixed(6)} s`);
      return {
        ...run,
        executionMs,
        compileMs: null,
        sandboxCpuPercent: null,
        sandboxMemoryPeakBytes: null,
        sandboxCpuLimit: null,
        sandboxMemoryLimitBytes: null,
        containerOpenMs: null,
        logs,
        compileError: false
      };
    }

    throw new Error(`Unsupported language: ${language}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function withExecutionTimeoutMessage(stderr, timedOut) {
  if (!timedOut) {
    return stderr || '';
  }
  const base = stderr || '';
  return base ? `${base}\nExecution timed out` : 'Execution timed out';
}

function appendRuntimeDiagnostic(stderr, result) {
  const base = (stderr || '').trim();
  const notes = [];

  const hasKillSignal = /(^|\n)\s*killed\s*($|\n)/i.test(base);
  const exitCode = typeof result?.code === 'number' ? result.code : null;
  const memPeak = typeof result?.sandboxMemoryPeakBytes === 'number' ? result.sandboxMemoryPeakBytes : null;
  const memLimit = typeof result?.sandboxMemoryLimitBytes === 'number' ? result.sandboxMemoryLimitBytes : null;
  const cpu = typeof result?.sandboxCpuPercent === 'number' ? result.sandboxCpuPercent : null;
  const cpuLimit = typeof result?.sandboxCpuLimit === 'number' ? result.sandboxCpuLimit : null;

  const memoryPressure =
    memPeak !== null && memLimit !== null && memLimit > 0 ? memPeak / memLimit : null;
  const likelyOom = (exitCode === 137 || hasKillSignal) && memoryPressure !== null && memoryPressure >= 0.95;

  if (likelyOom) {
    notes.push(
      `Likely out-of-memory: process reached ${Math.round(memoryPressure * 100)}% of sandbox memory limit (${Math.round(memPeak / (1024 * 1024))} MB / ${Math.round(memLimit / (1024 * 1024))} MB).`
    );
  } else if (exitCode === 137 || hasKillSignal) {
    notes.push('Process was terminated by the sandbox (SIGKILL).');
  }

  if (result?.timedOut && cpu !== null && cpuLimit !== null && cpu >= 90) {
    notes.push(
      `CPU was saturated near the sandbox limit (${cpu.toFixed(1)}% of ${cpuLimit} vCPU), which can contribute to timeout.`
    );
  }

  if (notes.length === 0) {
    return base;
  }
  return [base, ...notes].filter(Boolean).join('\n');
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, at: new Date().toISOString() });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

app.get('/api/auth/session', (req, res) => {
  const session = getSessionRecord(req);
  res.json({ user: session ? serializeUser(session) : null });
});

app.post('/api/auth/google', async (req, res) => {
  const idToken = String(req.body?.credential || req.body?.idToken || '').trim();
  if (!oauthClient || !GOOGLE_CLIENT_ID) {
    res.status(500).json({ error: 'google oauth is not configured' });
    return;
  }
  if (!idToken) {
    res.status(400).json({ error: 'idToken is required' });
    return;
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload?.email || !payload?.name) {
      res.status(400).json({ error: 'invalid google account payload' });
      return;
    }

    const userId =
      db.prepare('SELECT id FROM users WHERE google_sub = ?').get(payload.sub)?.id || randomUUID();
    const now = nowIso();
    db.prepare(
      `INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, updated_at)
       VALUES (@id, @googleSub, @email, @name, @avatarUrl, @now, @now)
       ON CONFLICT(google_sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         updated_at = excluded.updated_at`
    ).run({
      id: userId,
      googleSub: payload.sub,
      email: payload.email,
      name: payload.name,
      avatarUrl: payload.picture || null,
      now
    });

    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(sessionId, userId, expiresAt, now);
    setSessionCookie(res, sessionId);

    res.json({
      user: serializeUser({
        id: userId,
        email: payload.email,
        name: payload.name,
        avatarUrl: payload.picture || null
      })
    });
  } catch (error) {
    res.status(401).json({ error: error.message || 'google authentication failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const session = getSessionRecord(req);
  if (session) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/files', requireAuth, (req, res) => {
  const folders = db
    .prepare(
      `SELECT id, name, created_at AS createdAt, updated_at AS updatedAt
       FROM folders
       WHERE user_id = ?
       ORDER BY LOWER(name) ASC, created_at ASC`
    )
    .all(req.user.id);
  const files = db
    .prepare(
      `SELECT id, name, folder_id AS folderId, language, content, stdin, created_at AS createdAt, updated_at AS updatedAt
       FROM files
       WHERE user_id = ?
       ORDER BY LOWER(name) ASC, created_at ASC`
    )
    .all(req.user.id);
  res.json({ files, folders });
});

app.post('/api/files', requireAuth, (req, res) => {
  const language = String(req.body?.language || '').trim();
  const rawName = String(req.body?.name || '').trim();
  const folderId =
    req.body?.folderId === null || req.body?.folderId === undefined || req.body?.folderId === ''
      ? null
      : String(req.body.folderId).trim();
  if (!languageExists(language)) {
    res.status(400).json({ error: 'unsupported language' });
    return;
  }
  if (!rawName) {
    res.status(400).json({ error: 'file name is required' });
    return;
  }

  const id = randomUUID();
  const now = nowIso();
  const name = normalizeFileName(rawName, language);
  const content =
    typeof req.body?.content === 'string'
      ? req.body.content
      : language === 'java'
        ? buildJavaStarter(name)
        : getStarterForLanguage(language);
  const stdin = typeof req.body?.stdin === 'string' ? req.body.stdin : '';
  if (folderId) {
    const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(folderId, req.user.id);
    if (!folder) {
      res.status(400).json({ error: 'folder not found' });
      return;
    }
  }
  const existing = db
    .prepare('SELECT id FROM files WHERE user_id = ? AND folder_id IS ? AND name = ? LIMIT 1')
    .get(req.user.id, folderId, name);
  if (existing) {
    res.status(409).json({ error: 'file name already exists' });
    return;
  }
  db.prepare(
    `INSERT INTO files (id, user_id, name, folder_id, language, content, stdin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.id, name, folderId, language, content, stdin, now, now);

  res.status(201).json({
    file: { id, name, folderId, language, content, stdin, createdAt: now, updatedAt: now }
  });
});

app.patch('/api/files/:id', requireAuth, (req, res) => {
  const fileId = String(req.params.id || '').trim();
  const current = db
    .prepare('SELECT id, name, folder_id AS folderId, language, content, stdin FROM files WHERE id = ? AND user_id = ?')
    .get(fileId, req.user.id);
  if (!current) {
    res.status(404).json({ error: 'file not found' });
    return;
  }

  const nextLanguage = req.body?.language ? String(req.body.language).trim() : current.language;
  if (!languageExists(nextLanguage)) {
    res.status(400).json({ error: 'unsupported language' });
    return;
  }

  const nextRawName = req.body?.name !== undefined ? String(req.body.name).trim() : null;
  const nextFolderId =
    req.body?.folderId === undefined
      ? current.folderId
      : req.body.folderId === null || req.body.folderId === ''
        ? null
        : String(req.body.folderId).trim();
  if (nextRawName !== null && !nextRawName) {
    res.status(400).json({ error: 'file name is required' });
    return;
  }
  if (nextFolderId) {
    const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(nextFolderId, req.user.id);
    if (!folder) {
      res.status(400).json({ error: 'folder not found' });
      return;
    }
  }
  const nextName =
    nextRawName !== null ? normalizeFileName(nextRawName, nextLanguage) : normalizeFileName(current.name, nextLanguage);
  const nextContent = typeof req.body?.content === 'string' ? req.body.content : current.content;
  const nextStdin = typeof req.body?.stdin === 'string' ? req.body.stdin : current.stdin;
  const existing = db
    .prepare('SELECT id FROM files WHERE user_id = ? AND folder_id IS ? AND name = ? AND id != ? LIMIT 1')
    .get(req.user.id, nextFolderId, nextName, fileId);
  if (existing) {
    res.status(409).json({ error: 'file name already exists' });
    return;
  }
  const now = nowIso();
  db.prepare(
    `UPDATE files
     SET name = ?, folder_id = ?, language = ?, content = ?, stdin = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(nextName, nextFolderId, nextLanguage, nextContent, nextStdin, now, fileId, req.user.id);

  res.json({
    file: {
      id: fileId,
      name: nextName,
      folderId: nextFolderId,
      language: nextLanguage,
      content: nextContent,
      stdin: nextStdin,
      updatedAt: now
    }
  });
});

app.delete('/api/files/:id', requireAuth, (req, res) => {
  const fileId = String(req.params.id || '').trim();
  const result = db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').run(fileId, req.user.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'file not found' });
    return;
  }
  res.json({ ok: true, id: fileId });
});

app.post('/api/folders', requireAuth, (req, res) => {
  const rawName = normalizeFolderName(req.body?.name);
  if (!rawName) {
    res.status(400).json({ error: 'folder name is required' });
    return;
  }
  const existing = db
    .prepare('SELECT id FROM folders WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1')
    .get(req.user.id, rawName);
  if (existing) {
    res.status(409).json({ error: 'folder name already exists' });
    return;
  }
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO folders (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, req.user.id, rawName, now, now);
  res.status(201).json({ folder: { id, name: rawName, createdAt: now, updatedAt: now } });
});

app.patch('/api/folders/:id', requireAuth, (req, res) => {
  const folderId = String(req.params.id || '').trim();
  const rawName = normalizeFolderName(req.body?.name);
  if (!rawName) {
    res.status(400).json({ error: 'folder name is required' });
    return;
  }
  const current = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(folderId, req.user.id);
  if (!current) {
    res.status(404).json({ error: 'folder not found' });
    return;
  }
  const existing = db
    .prepare('SELECT id FROM folders WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id != ? LIMIT 1')
    .get(req.user.id, rawName, folderId);
  if (existing) {
    res.status(409).json({ error: 'folder name already exists' });
    return;
  }
  const now = nowIso();
  db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    rawName,
    now,
    folderId,
    req.user.id
  );
  res.json({ folder: { id: folderId, name: rawName, updatedAt: now } });
});

app.delete('/api/folders/:id', requireAuth, (req, res) => {
  const folderId = String(req.params.id || '').trim();
  const current = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(folderId, req.user.id);
  if (!current) {
    res.status(404).json({ error: 'folder not found' });
    return;
  }
  db.prepare('UPDATE files SET folder_id = NULL, updated_at = ? WHERE folder_id = ? AND user_id = ?').run(
    nowIso(),
    folderId,
    req.user.id
  );
  db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?').run(folderId, req.user.id);
  res.json({ ok: true, id: folderId });
});

app.get('/api/import-packages/:language', (req, res) => {
  const language = String(req.params.language || '').trim();
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    res.status(400).json({ error: 'unsupported language' });
    return;
  }

  try {
    const mode = String(req.query.mode || 'packages').trim();
    const moduleName = String(req.query.module || '').trim();

    if (mode === 'python-members') {
      if (language !== 'python' || !moduleName) {
        res.status(400).json({ error: 'python module is required' });
        return;
      }
      res.json({ items: listPythonModuleSymbols(moduleName) });
      return;
    }

    if (mode !== 'packages') {
      res.status(400).json({ error: 'unsupported import suggestion mode' });
      return;
    }

    res.json({ items: listImportPackages(language) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to list import packages' });
  }
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
      result = await runWithSandboxQueue(
        () => runInDockerSandbox(language, code, stdin),
        { onQueueEvent: null }
      );
    } else {
      result = await runCodeLocally(language, code, stdin);
    }

    if (typeof result.queueWaitMs === 'number' && result.queueWaitMs > 0) {
      result.logs = result.logs || [];
      result.logs.push(`  queue wait time: ${(result.queueWaitMs / 1000).toFixed(3)} s`);
      if (typeof result.queuePositionAtEnqueue === 'number') {
        result.logs.push(`  queue position at enqueue: #${result.queuePositionAtEnqueue}`);
      }
    }

    if (result.compileError) {
      res.status(400).json({
        stdout: result.stdout,
        stderr: result.stderr || 'Compilation failed',
        executionMs: null,
        compileMs: typeof result.compileMs === 'number' ? result.compileMs : null,
        sandboxCpuPercent:
          typeof result.sandboxCpuPercent === 'number' ? result.sandboxCpuPercent : null,
        sandboxMemoryPeakBytes:
          typeof result.sandboxMemoryPeakBytes === 'number' ? result.sandboxMemoryPeakBytes : null,
        sandboxCpuLimit: typeof result.sandboxCpuLimit === 'number' ? result.sandboxCpuLimit : null,
        sandboxMemoryLimitBytes:
          typeof result.sandboxMemoryLimitBytes === 'number' ? result.sandboxMemoryLimitBytes : null,
        queueWaitMs: typeof result.queueWaitMs === 'number' ? result.queueWaitMs : 0,
        queuePositionAtEnqueue:
          typeof result.queuePositionAtEnqueue === 'number' ? result.queuePositionAtEnqueue : null,
        containerOpenMs:
          typeof result.containerOpenMs === 'number' ? result.containerOpenMs : null,
        logs: result.logs || []
      });
      return;
    }

    res.json({
      stdout: result.stdout,
      stderr: appendRuntimeDiagnostic(withExecutionTimeoutMessage(result.stderr, result.timedOut), result),
      executionMs: typeof result.executionMs === 'number' ? result.executionMs : null,
      compileMs: typeof result.compileMs === 'number' ? result.compileMs : null,
      sandboxCpuPercent:
        typeof result.sandboxCpuPercent === 'number' ? result.sandboxCpuPercent : null,
      sandboxMemoryPeakBytes:
        typeof result.sandboxMemoryPeakBytes === 'number' ? result.sandboxMemoryPeakBytes : null,
      sandboxCpuLimit: typeof result.sandboxCpuLimit === 'number' ? result.sandboxCpuLimit : null,
      sandboxMemoryLimitBytes:
        typeof result.sandboxMemoryLimitBytes === 'number' ? result.sandboxMemoryLimitBytes : null,
      queueWaitMs: typeof result.queueWaitMs === 'number' ? result.queueWaitMs : 0,
      queuePositionAtEnqueue:
        typeof result.queuePositionAtEnqueue === 'number' ? result.queuePositionAtEnqueue : null,
      containerOpenMs: typeof result.containerOpenMs === 'number' ? result.containerOpenMs : null,
      logs: result.logs || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Execution error' });
  }
});

app.post('/api/run/stream', async (req, res) => {
  const { language, code, stdin = '', runId: requestedRunId } = req.body ?? {};
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

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const sendEvent = (event, payload = {}) => {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    res.write(`${JSON.stringify({ event, ...payload })}\n`);
  };

  const runId = typeof requestedRunId === 'string' && requestedRunId.trim()
    ? requestedRunId.trim()
    : randomUUID();
  const runControl = createRunControl();
  activeRunControls.set(runId, runControl);
  sendEvent('run', { runId });

  try {
    let result;
    const onPhase = (payload) => sendEvent('phase', payload);
    const onStdout = (chunk) => sendEvent('stdout', { chunk });
    const onStderr = (chunk) => sendEvent('stderr', { chunk });
    if (SANDBOX_PROVIDER === 'docker') {
      if (!isDockerSandboxAvailable()) {
        sendEvent('final', {
          ok: false,
          error:
            'Docker sandbox is unavailable. Ensure docker CLI exists and /var/run/docker.sock is mounted.'
        });
        res.end();
        return;
      }
      result = await runWithSandboxQueue(
        () => runInDockerSandbox(language, code, stdin, { onPhase, onStdout, onStderr, runControl }),
        { onQueueEvent: onPhase, runControl }
      );
    } else {
      result = await runCodeLocally(language, code, stdin, { onPhase, runControl });
    }

    if (typeof result.queueWaitMs === 'number' && result.queueWaitMs > 0) {
      result.logs = result.logs || [];
      result.logs.push(`  queue wait time: ${(result.queueWaitMs / 1000).toFixed(3)} s`);
      if (typeof result.queuePositionAtEnqueue === 'number') {
        result.logs.push(`  queue position at enqueue: #${result.queuePositionAtEnqueue}`);
      }
    }

    if (result.compileError) {
      sendEvent('final', {
        ok: false,
        stdout: result.stdout,
        stderr: result.stderr || 'Compilation failed',
        executionMs: null,
        compileMs: typeof result.compileMs === 'number' ? result.compileMs : null,
        sandboxCpuPercent:
          typeof result.sandboxCpuPercent === 'number' ? result.sandboxCpuPercent : null,
        sandboxMemoryPeakBytes:
          typeof result.sandboxMemoryPeakBytes === 'number' ? result.sandboxMemoryPeakBytes : null,
        sandboxCpuLimit: typeof result.sandboxCpuLimit === 'number' ? result.sandboxCpuLimit : null,
        sandboxMemoryLimitBytes:
          typeof result.sandboxMemoryLimitBytes === 'number' ? result.sandboxMemoryLimitBytes : null,
        queueWaitMs: typeof result.queueWaitMs === 'number' ? result.queueWaitMs : 0,
        queuePositionAtEnqueue:
          typeof result.queuePositionAtEnqueue === 'number' ? result.queuePositionAtEnqueue : null,
        containerOpenMs: typeof result.containerOpenMs === 'number' ? result.containerOpenMs : null,
        logs: result.logs || []
      });
      res.end();
      return;
    }

    sendEvent('final', {
      ok: true,
      stdout: result.stdout,
      stderr: appendRuntimeDiagnostic(withExecutionTimeoutMessage(result.stderr, result.timedOut), result),
      executionMs: typeof result.executionMs === 'number' ? result.executionMs : null,
      compileMs: typeof result.compileMs === 'number' ? result.compileMs : null,
      sandboxCpuPercent:
        typeof result.sandboxCpuPercent === 'number' ? result.sandboxCpuPercent : null,
      sandboxMemoryPeakBytes:
        typeof result.sandboxMemoryPeakBytes === 'number' ? result.sandboxMemoryPeakBytes : null,
      sandboxCpuLimit: typeof result.sandboxCpuLimit === 'number' ? result.sandboxCpuLimit : null,
      sandboxMemoryLimitBytes:
        typeof result.sandboxMemoryLimitBytes === 'number' ? result.sandboxMemoryLimitBytes : null,
      queueWaitMs: typeof result.queueWaitMs === 'number' ? result.queueWaitMs : 0,
      queuePositionAtEnqueue:
        typeof result.queuePositionAtEnqueue === 'number' ? result.queuePositionAtEnqueue : null,
      containerOpenMs: typeof result.containerOpenMs === 'number' ? result.containerOpenMs : null,
      logs: result.logs || []
    });
  } catch (error) {
    if (error instanceof RunCancelledError) {
      sendEvent('final', { ok: false, cancelled: true, error: 'Execution stopped by user' });
      return;
    }
    sendEvent('final', { ok: false, error: error.message || 'Execution error' });
  } finally {
    activeRunControls.delete(runId);
    res.end();
  }
});

app.post('/api/run/cancel', (req, res) => {
  const { runId } = req.body ?? {};
  if (!runId || typeof runId !== 'string') {
    res.status(400).json({ ok: false, error: 'runId is required' });
    return;
  }

  const runControl = activeRunControls.get(runId);
  if (!runControl) {
    res.json({ ok: true, cancelled: false, reason: 'run_not_found_or_already_finished' });
    return;
  }

  runControl.abort('Execution stopped by user');
  res.json({ ok: true, cancelled: true });
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
