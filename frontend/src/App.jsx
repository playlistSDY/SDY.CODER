import { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { LSPClient } from './lspClient';
import './styles.css';

const LANGUAGES = [
  {
    id: 'python',
    label: 'Python',
    versionLabel: '3.11',
    monacoLanguage: 'python',
    starter: `def solve():\n    print(\"Hello, Python\")\n\nif __name__ == \"__main__\":\n    solve()\n`
  },
  {
    id: 'c',
    label: 'C',
    versionLabel: '99',
    monacoLanguage: 'c',
    starter: `#include <stdio.h>\n\nint main(void) {\n    printf(\"Hello, C\\n\");\n    return 0;\n}\n`
  },
  {
    id: 'cpp',
    label: 'C++',
    versionLabel: '17',
    monacoLanguage: 'cpp',
    starter: `#include <iostream>\n\nint main() {\n    std::cout << \"Hello, C++\" << std::endl;\n    return 0;\n}\n`
  },
  {
    id: 'java',
    label: 'Java',
    versionLabel: '21',
    monacoLanguage: 'java',
    starter: `public class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hello, Java\");\n    }\n}\n`
  },
  {
    id: 'csharp',
    label: 'C#',
    versionLabel: 'Mono',
    monacoLanguage: 'csharp',
    starter:
      `using System;\n\npublic class Program {\n    public static void Main(string[] args) {\n        Console.WriteLine(\"Hello, C#\");\n    }\n}\n`
  },
  {
    id: 'nodejs',
    label: 'Node.js',
    versionLabel: '22',
    monacoLanguage: 'javascript',
    starter: `function solve() {\n  console.log("Hello, Node.js");\n}\n\nsolve();\n`
  },
  {
    id: 'go',
    label: 'Go',
    versionLabel: '1.x',
    monacoLanguage: 'go',
    starter: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, Go")\n}\n`
  },
  {
    id: 'kotlin',
    label: 'Kotlin',
    versionLabel: '1.9+',
    monacoLanguage: 'kotlin',
    starter: `fun main() {\n    println("Hello, Kotlin")\n}\n`
  },
  {
    id: 'dart',
    label: 'Dart',
    versionLabel: '3.x',
    monacoLanguage: 'dart',
    starter: `void main() {\n  print('Hello, Dart');\n}\n`
  }
];

const EXT_BY_LANG = {
  python: 'py',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  csharp: 'cs',
  nodejs: 'js',
  go: 'go',
  kotlin: 'kt',
  dart: 'dart'
};
const FILE_NAME_BY_LANG = {
  java: 'Main.java',
  csharp: 'Main.cs'
};
const COMPILED_LANGUAGES = new Set(['c', 'cpp', 'java', 'csharp', 'go', 'kotlin']);
const LSP_WORKSPACE_URI = 'file:///tmp/web-vscode-workspace';
const DEFAULT_LANGUAGE = LANGUAGES[0].id;
const LAST_LANGUAGE_STORAGE_KEY = 'web-vscode:last-language';
const GUEST_FILES_STORAGE_KEY = 'web-vscode:guest-files';
const GUEST_SELECTED_FILE_ID_STORAGE_KEY = 'web-vscode:guest-selected-file-id';
const EXPLORER_WIDTH_STORAGE_KEY = 'web-vscode:explorer-width';
const SIDE_PANE_WIDTH_STORAGE_KEY = 'web-vscode:side-pane-width';
const SIDE_PANE_HEIGHT_STORAGE_KEY = 'web-vscode:side-pane-height';
const DEFAULT_EXPLORER_WIDTH_PX = 220;
const DEFAULT_SIDE_PANE_WIDTH_PX = 360;
const DEFAULT_SIDE_PANE_HEIGHT_PX = 380;
const WORKSPACE_RESIZER_MIN_EXPLORER_PX = 210;
const WORKSPACE_RESIZER_MIN_EDITOR_PX = 420;
const WORKSPACE_RESIZER_MIN_SIDE_PX = 280;
const WORKSPACE_RESIZER_MIN_EDITOR_HEIGHT_PX = 260;
const WORKSPACE_RESIZER_MIN_SIDE_HEIGHT_PX = 220;
const RESIZER_HEIGHT_PX = 8;
const DEFAULT_PANEL_RATIOS = [0.26, 0.62, 0.12];
const MIN_PANEL_HEIGHT_PX = 96;
const LEGACY_CSHARP_STARTER =
  `using System;\n\npublic class Main {\n    public static void Main(string[] args) {\n        Console.WriteLine(\"Hello, C#\");\n    }\n}\n`;
const DEFAULT_NEW_FILE_BASENAME = 'untitled';

function isSupportedLanguage(value) {
  return LANGUAGES.some((item) => item.id === value);
}

function loadLastLanguage() {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE;
  }
  try {
    const saved = window.localStorage.getItem(LAST_LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(saved) ? saved : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function saveLastLanguage(lang) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(LAST_LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Ignore storage errors.
  }
}

function createLocalFile(languageId = DEFAULT_LANGUAGE, fileName = DEFAULT_NEW_FILE_BASENAME) {
  return {
    id: `guest:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    name: normalizeFileName(fileName, languageId),
    language: languageId,
    content: getStarterForLanguage(languageId),
    stdin: ''
  };
}

function loadGuestWorkspace() {
  if (typeof window === 'undefined') {
    const fallback = createLocalFile(DEFAULT_LANGUAGE);
    return { files: [fallback], selectedFileId: fallback.id };
  }
  try {
    const rawFiles = window.localStorage.getItem(GUEST_FILES_STORAGE_KEY);
    const rawSelectedFileId = window.localStorage.getItem(GUEST_SELECTED_FILE_ID_STORAGE_KEY);
    const parsedFiles = JSON.parse(rawFiles || '[]');
    const files = Array.isArray(parsedFiles)
      ? parsedFiles
          .filter((file) => file && typeof file.id === 'string' && isSupportedLanguage(file.language))
          .map((file) => ({
            id: file.id,
            name: normalizeFileName(file.name, file.language),
            language: file.language,
            content:
              typeof file.content === 'string'
                ? normalizeLoadedCode(file.language, file.content)
                : getStarterForLanguage(file.language),
            stdin: typeof file.stdin === 'string' ? file.stdin : ''
          }))
      : [];
    if (files.length === 0) {
      const fallback = createLocalFile(loadLastLanguage());
      return { files: [fallback], selectedFileId: fallback.id };
    }
    const selectedFileId = files.some((file) => file.id === rawSelectedFileId) ? rawSelectedFileId : files[0].id;
    return { files, selectedFileId };
  } catch {
    const fallback = createLocalFile(DEFAULT_LANGUAGE);
    return { files: [fallback], selectedFileId: fallback.id };
  }
}

function saveGuestWorkspace(files, selectedFileId) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(GUEST_FILES_STORAGE_KEY, JSON.stringify(files));
    window.localStorage.setItem(GUEST_SELECTED_FILE_ID_STORAGE_KEY, selectedFileId || '');
  } catch {
    // Ignore storage errors.
  }
}

function loadSidePaneWidth() {
  if (typeof window === 'undefined') {
    return DEFAULT_SIDE_PANE_WIDTH_PX;
  }
  try {
    const raw = window.localStorage.getItem(SIDE_PANE_WIDTH_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  } catch {
    // Ignore storage errors.
  }
  return DEFAULT_SIDE_PANE_WIDTH_PX;
}

function loadExplorerWidth() {
  if (typeof window === 'undefined') {
    return DEFAULT_EXPLORER_WIDTH_PX;
  }
  try {
    const raw = window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(parsed, WORKSPACE_RESIZER_MIN_EXPLORER_PX);
    }
  } catch {
    // Ignore storage errors.
  }
  return Math.max(DEFAULT_EXPLORER_WIDTH_PX, WORKSPACE_RESIZER_MIN_EXPLORER_PX);
}

function saveExplorerWidth(width) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Ignore storage errors.
  }
}

function saveSidePaneWidth(width) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SIDE_PANE_WIDTH_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Ignore storage errors.
  }
}

function loadSidePaneHeight() {
  if (typeof window === 'undefined') {
    return DEFAULT_SIDE_PANE_HEIGHT_PX;
  }
  try {
    const raw = window.localStorage.getItem(SIDE_PANE_HEIGHT_STORAGE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  } catch {
    // Ignore storage errors.
  }
  return DEFAULT_SIDE_PANE_HEIGHT_PX;
}

function saveSidePaneHeight(height) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SIDE_PANE_HEIGHT_STORAGE_KEY, String(Math.round(height)));
  } catch {
    // Ignore storage errors.
  }
}

function getFileNameForLanguage(languageId) {
  return FILE_NAME_BY_LANG[languageId] || `main.${EXT_BY_LANG[languageId]}`;
}

function getStarterForLanguage(languageId) {
  return LANGUAGES.find((item) => item.id === languageId)?.starter || '';
}

function getMonacoLanguageForLanguage(languageId) {
  return LANGUAGES.find((item) => item.id === languageId)?.monacoLanguage || languageId;
}

function normalizeFileName(name, languageId) {
  const ext = EXT_BY_LANG[languageId] || 'txt';
  const cleaned = String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ');
  const base = (cleaned || DEFAULT_NEW_FILE_BASENAME).replace(/\.[^.]+$/, '');
  return `${base}.${ext}`;
}

function normalizeLoadedCode(languageId, code) {
  if (languageId === 'csharp' && code === LEGACY_CSHARP_STARTER) {
    const csharpLang = LANGUAGES.find((item) => item.id === 'csharp');
    return csharpLang?.starter || code;
  }
  return code;
}

function getModelUri(monaco, file) {
  if (!monaco || !file) {
    return null;
  }
  const safeId = encodeURIComponent(file.id || file.name || 'file');
  const safeName = encodeURIComponent(file.name || getFileNameForLanguage(file.language || DEFAULT_LANGUAGE));
  return monaco.Uri.parse(`${LSP_WORKSPACE_URI}/${safeId}/${safeName}`);
}

function getClientPoint(event) {
  if (event?.touches && event.touches.length > 0) {
    return { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
  if (event?.changedTouches && event.changedTouches.length > 0) {
    return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  }
  if (typeof event?.clientX === 'number' && typeof event?.clientY === 'number') {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

function formatDurationWithSeconds(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) {
    return 'N/A';
  }
  return `${ms.toFixed(3)} ms (${(ms / 1000).toFixed(3)} s)`;
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return 'N/A';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = -1;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(2)} ${units[idx]}`;
}

function buildStatusBlock(
  containerOpenMs,
  compileMs,
  executionMs,
  sandboxCpuPercent = null,
  sandboxCpuLimit = null,
  sandboxMemoryPeakBytes = null,
  sandboxMemoryLimitBytes = null,
  queueWaitMs = null,
  queuePositionAtEnqueue = null
) {
  const lines = ['[status]'];

  const shouldShowQueueWait = typeof queueWaitMs === 'number' && queueWaitMs > 0;

  if (shouldShowQueueWait) {
    const wait = typeof queueWaitMs === 'number' ? formatDurationWithSeconds(queueWaitMs) : 'N/A';
    if (typeof queuePositionAtEnqueue === 'number') {
      lines.push(`Queue wait: ${wait} / position #${queuePositionAtEnqueue}`);
    } else {
      lines.push(`Queue wait: ${wait}`);
    }
  }

  lines.push(
    Number.isFinite(containerOpenMs)
      ? `Opening container: ${formatDurationWithSeconds(containerOpenMs)}`
      : 'Opening container: N/A'
  );

  if (typeof compileMs === 'number') {
    lines.push(`Compile time: ${formatDurationWithSeconds(compileMs)}`);
  }

  lines.push(
    typeof executionMs === 'number'
      ? `Code execution time: ${formatDurationWithSeconds(executionMs)}`
      : 'Code execution time: N/A'
  );

  if (typeof sandboxMemoryPeakBytes === 'number' || typeof sandboxMemoryLimitBytes === 'number') {
    lines.push(
      `Memory peak: ${formatBytes(sandboxMemoryPeakBytes)} / max ${formatBytes(sandboxMemoryLimitBytes)}`
    );
  }

  return lines.join('\n');
}

function buildOutputText(statusBlock, stdout = '', stderr = '', error = '') {
  return [
    statusBlock,
    stdout ? `[stdout]\n${stdout}` : '',
    stderr ? `[stderr]\n${stderr}` : '',
    error ? `[error]\n${error}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
}

function defineDarkModernTheme(monaco) {
  monaco.editor.defineTheme('vscode-dark-modern', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955' },
      { token: 'keyword', foreground: 'C586C0' },
      { token: 'keyword.control', foreground: 'C586C0' },
      { token: 'operator', foreground: 'C586C0' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'stringLiteral', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'numberLiteral', foreground: 'B5CEA8' },
      { token: 'namespace', foreground: '4EC9B0' },
      { token: 'module', foreground: '4EC9B0' },
      { token: 'module.defaultLibrary', foreground: '4EC9B0' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'type.identifier', foreground: '4EC9B0' },
      { token: 'class', foreground: '4EC9B0' },
      { token: 'class.defaultLibrary', foreground: '4EC9B0' },
      { token: 'struct', foreground: '4EC9B0' },
      { token: 'type.defaultLibrary', foreground: '4EC9B0' },
      { token: 'templateType', foreground: '4EC9B0' },
      { token: 'templateType.defaultLibrary', foreground: '4EC9B0' },
      { token: 'variable', foreground: '9CDCFE' },
      { token: 'parameter', foreground: '9CDCFE' },
      { token: 'property', foreground: '9CDCFE' },
      { token: 'enumMember', foreground: '4FC1FF' },
      { token: 'variable.readonly', foreground: '4FC1FF' },
      { token: 'variable.defaultLibrary', foreground: '4FC1FF' },
      { token: 'newOperator', foreground: 'C586C0' },
      { token: 'customLiteral', foreground: 'DCDCAA' },
      { token: 'function', foreground: 'DCDCAA' },
      { token: 'method', foreground: 'DCDCAA' },
      { token: 'entity.name.function', foreground: 'DCDCAA' },
      { token: 'support.function', foreground: 'DCDCAA' }
    ],
    colors: {
      'editor.background': '#1F1F1F',
      'editor.foreground': '#CCCCCC',
      'editor.findMatchBackground': '#9E6A03',
      'editor.lineHighlightBackground': '#2A2D2E',
      'editor.selectionBackground': '#26477866',
      'editor.inactiveSelectionBackground': '#3A3D4166',
      'editorCursor.foreground': '#CCCCCC',
      'editorLineNumber.foreground': '#6E7681',
      'editorLineNumber.activeForeground': '#CCCCCC',
      'editorIndentGuide.background1': '#404040',
      'editorIndentGuide.activeBackground1': '#707070',
      'editorWidget.background': '#202020',
      'editorOverviewRuler.border': '#010409'
    }
  });
}

export default function App() {
  const initialGuestWorkspace = loadGuestWorkspace();
  const [language, setLanguage] = useState(() => loadLastLanguage());
  const [stdinText, setStdinText] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [files, setFiles] = useState(() => initialGuestWorkspace.files);
  const [selectedFileId, setSelectedFileId] = useState(() => initialGuestWorkspace.selectedFileId);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [createFileModalOpen, setCreateFileModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileLanguage, setNewFileLanguage] = useState(() => loadLastLanguage());
  const [renameFileModalOpen, setRenameFileModalOpen] = useState(false);
  const [renameFileId, setRenameFileId] = useState(null);
  const [renameFileName, setRenameFileName] = useState('');
  const [renameFileLanguage, setRenameFileLanguage] = useState(DEFAULT_LANGUAGE);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [explorerWidth, setExplorerWidth] = useState(() => loadExplorerWidth());
  const [editorStatus, setEditorStatus] = useState({
    lineCount: 0,
    lineNumber: 1,
    column: 1,
    selectedChars: 0,
    isFocused: false
  });
  const [sidePaneWidth, setSidePaneWidth] = useState(() => loadSidePaneWidth());
  const [sidePaneHeight, setSidePaneHeight] = useState(() => loadSidePaneHeight());
  const [panelRatios, setPanelRatios] = useState(DEFAULT_PANEL_RATIOS);
  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  );

  const workspaceRef = useRef(null);
  const explorerPaneRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const lspRef = useRef(null);
  const modelsRef = useRef(new Map());
  const modelStorageDisposablesRef = useRef([]);
  const sidePaneRef = useRef(null);
  const workspaceResizeDragRef = useRef(null);
  const resizeDragRef = useRef(null);
  const logsBodyRef = useRef(null);
  const logCounterRef = useRef(0);
  const currentRunIdRef = useRef(null);
  const currentRunAbortRef = useRef(null);
  const stopRequestedRef = useRef(false);
  const lspSessionRef = useRef(0);
  const saveTimersRef = useRef(new Map());
  const stdinSaveTimersRef = useRef(new Map());
  const selectedFileIdRef = useRef(null);
  const selectedFile = files.find((item) => item.id === selectedFileId) || null;
  const activeFile = selectedFile;
  const normalizedNewFileName = normalizeFileName(newFileName, newFileLanguage);
  const createNameTaken = files.some((file) => file.name === normalizedNewFileName);
  const canCreateFile = Boolean(newFileName.trim()) && !createNameTaken;

  const makeTimestamp = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const appendLogWithId = (line) => {
    const id = `log-${Date.now()}-${logCounterRef.current++}`;
    const timestamp = makeTimestamp();
    setLogs((prev) => [...prev.slice(-120), { id, timestamp, text: line }]);
    return id;
  };

  const appendLog = (line) => {
    appendLogWithId(line);
  };

  const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }
    return payload;
  };

  const updateEditorStatusFromEditor = (editor) => {
    const model = editor?.getModel();
    const position = editor?.getPosition();
    const selection = editor?.getSelection();
    const selectedChars = model && selection ? model.getValueLengthInRange(selection) : 0;

    setEditorStatus({
      lineCount: model ? model.getLineCount() : 0,
      lineNumber: position?.lineNumber || 1,
      column: position?.column || 1,
      selectedChars,
      isFocused: editor?.hasTextFocus?.() || false
    });
  };

  const persistFilePatch = async (fileId, patch) => {
    if (!user) {
      setFiles((prev) => prev.map((file) => (file.id === fileId ? { ...file, ...patch } : file)));
      return;
    }
    await fetchJson(`/api/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    setFiles((prev) =>
      prev.map((file) =>
        file.id === fileId ? { ...file, ...patch, updatedAt: new Date().toISOString() } : file
      )
    );
  };

  const scheduleFileSave = (fileId, content) => {
    const prev = saveTimersRef.current.get(fileId);
    if (prev) {
      window.clearTimeout(prev);
    }
    const timer = window.setTimeout(() => {
      saveTimersRef.current.delete(fileId);
      persistFilePatch(fileId, { content }).catch((error) => appendLog(`save failed: ${error.message}`));
    }, 500);
    saveTimersRef.current.set(fileId, timer);
  };

  const scheduleFileStdinSave = (fileId, stdin) => {
    const prev = stdinSaveTimersRef.current.get(fileId);
    if (prev) {
      window.clearTimeout(prev);
    }
    const timer = window.setTimeout(() => {
      stdinSaveTimersRef.current.delete(fileId);
      persistFilePatch(fileId, { stdin }).catch((error) => appendLog(`stdin save failed: ${error.message}`));
    }, 300);
    stdinSaveTimersRef.current.set(fileId, timer);
  };

  const ensureModelForFile = (file, editor = editorRef.current, monaco = monacoRef.current) => {
    if (!file || !monaco) {
      return null;
    }

    const existing = modelsRef.current.get(file.id);
    if (existing) {
      return existing;
    }

    const model = monaco.editor.createModel(
      file.content || getStarterForLanguage(file.language),
      getMonacoLanguageForLanguage(file.language),
      getModelUri(monaco, file)
    );
    const storageDisposable = model.onDidChangeContent(() => {
      if (editor && editor.getModel() === model) {
        updateEditorStatusFromEditor(editor);
      }
      scheduleFileSave(file.id, model.getValue());
    });
    modelStorageDisposablesRef.current.push(storageDisposable);
    modelsRef.current.set(file.id, model);
    return model;
  };

  const syncSelectedFileModel = (file, editor = editorRef.current) => {
    if (!file || !editor) {
      return;
    }
    const model = ensureModelForFile(file, editor);
    if (model && editor.getModel() !== model) {
      editor.setModel(model);
      updateEditorStatusFromEditor(editor);
    }
  };

  const updateLogById = (id, nextText) => {
    if (!id) {
      return;
    }
    setLogs((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              timestamp: makeTimestamp(),
              text: nextText
            }
          : entry
      )
    );
  };

  const bootLspForFile = async (file) => {
    if (!monacoRef.current) {
      return;
    }

    const sessionId = lspSessionRef.current + 1;
    lspSessionRef.current = sessionId;

    if (lspRef.current) {
      await lspRef.current.stop();
      lspRef.current = null;
    }

    if (!file) {
      return;
    }

    const model = ensureModelForFile(file);
    if (!model) {
      return;
    }

    const nextClient = new LSPClient({
      monaco: monacoRef.current,
      language: file.language,
      languageId: model.getLanguageId(),
      model,
      fileName: file.name,
      onLog: appendLog,
      isActive: () => lspSessionRef.current === sessionId && lspRef.current === nextClient,
      workspaceUri: LSP_WORKSPACE_URI
    });
    lspRef.current = nextClient;
    nextClient.start();
  };

  const onEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    defineDarkModernTheme(monaco);
    monaco.editor.setTheme('vscode-dark-modern');

    if (activeFile) {
      syncSelectedFileModel(activeFile, editor);
      bootLspForFile(activeFile);
    }

    modelStorageDisposablesRef.current.push(editor.onDidChangeCursorPosition(() => updateEditorStatusFromEditor(editor)));
    modelStorageDisposablesRef.current.push(editor.onDidChangeCursorSelection(() => updateEditorStatusFromEditor(editor)));
    modelStorageDisposablesRef.current.push(editor.onDidFocusEditorText(() => updateEditorStatusFromEditor(editor)));
    modelStorageDisposablesRef.current.push(editor.onDidBlurEditorText(() => updateEditorStatusFromEditor(editor)));
    modelStorageDisposablesRef.current.push(editor.onDidChangeModel(() => updateEditorStatusFromEditor(editor)));
  };

  useEffect(() => {
    selectedFileIdRef.current = selectedFileId;
  }, [selectedFileId]);

  useEffect(() => {
    if (selectedFile?.language && selectedFile.language !== language) {
      setLanguage(selectedFile.language);
    }
  }, [selectedFile?.language]);

  useEffect(() => {
    saveLastLanguage(language);
  }, [language]);

  useEffect(() => {
    saveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current.clear();
    stdinSaveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    stdinSaveTimersRef.current.clear();
    modelsRef.current.forEach((model) => model.dispose());
    modelsRef.current.clear();
    if (lspRef.current) {
      lspRef.current.stop();
      lspRef.current = null;
    }
  }, [user]);

  useEffect(() => {
    if (!activeFile) {
      return;
    }
    syncSelectedFileModel(activeFile);
    bootLspForFile(activeFile);
  }, [user, selectedFileId, activeFile?.name, activeFile?.language]);

  useEffect(() => {
    setStdinText(selectedFile?.stdin || '');
  }, [selectedFile?.id, selectedFile?.stdin]);

  useEffect(() => {
    saveExplorerWidth(explorerWidth);
  }, [explorerWidth]);

  useEffect(() => {
    saveSidePaneWidth(sidePaneWidth);
  }, [sidePaneWidth]);

  useEffect(() => {
    saveSidePaneHeight(sidePaneHeight);
  }, [sidePaneHeight]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    const mediaQuery = window.matchMedia('(max-width: 900px)');
    const handleChange = (event) => {
      setIsMobileView(event.matches);
    };
    setIsMobileView(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!logsBodyRef.current) {
      return;
    }
    logsBodyRef.current.scrollTop = logsBodyRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    let cancelled = false;

    const bootstrapAuth = async () => {
      try {
        const [config, session] = await Promise.all([
          fetchJson('/api/auth/config'),
          fetchJson('/api/auth/session')
        ]);
        if (cancelled) {
          return;
        }
        setGoogleClientId(config.googleClientId || '');
        setUser(session.user || null);
      } catch (error) {
        if (!cancelled) {
          appendLog(`auth bootstrap failed: ${error.message}`);
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    };

    bootstrapAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) {
      const guestWorkspace = loadGuestWorkspace();
      setFiles(guestWorkspace.files);
      setSelectedFileId(guestWorkspace.selectedFileId);
      setLoginPromptOpen(false);
      return;
    }

    let cancelled = false;
    const loadFiles = async () => {
      try {
        const payload = await fetchJson('/api/files');
        if (cancelled) {
          return;
        }
        const nextFiles = payload.files || [];
        setFiles(nextFiles);
        setSelectedFileId((prev) => (prev && nextFiles.some((file) => file.id === prev) ? prev : nextFiles[0]?.id || null));
      } catch (error) {
        if (!cancelled) {
          appendLog(`file load failed: ${error.message}`);
        }
      }
    };

    loadFiles();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (user) {
      return;
    }
    saveGuestWorkspace(files, selectedFileId);
  }, [user, files, selectedFileId]);

  useEffect(() => {
    if (!googleClientId || user || !explorerOpen) {
      return;
    }

    let cancelled = false;
    const scriptId = 'google-gsi-script';
    const initGoogle = () => {
      if (cancelled || !window.google?.accounts?.id) {
        return;
      }
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          try {
            const payload = await fetchJson('/api/auth/google', {
              method: 'POST',
              body: JSON.stringify({ credential: response.credential })
            });
            setUser(payload.user || null);
            setLoginPromptOpen(false);
          } catch (error) {
            appendLog(`login failed: ${error.message}`);
          }
        }
      });
      const target = document.getElementById('google-login-button');
      if (target) {
        target.innerHTML = '';
        const slotWidth = Math.round(target.parentElement?.getBoundingClientRect?.().width || 160);
        window.google.accounts.id.renderButton(target, {
          theme: 'filled_black',
          size: 'medium',
          text: 'signin_with',
          width: Math.max(140, Math.min(slotWidth, 170))
        });
      }
    };

    const existing = document.getElementById(scriptId);
    if (existing) {
      initGoogle();
      return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [googleClientId, user, explorerOpen]);

  useEffect(() => {
    return () => {
      if (lspRef.current) {
        lspRef.current.stop();
      }
      saveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      saveTimersRef.current.clear();
      stdinSaveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      stdinSaveTimersRef.current.clear();
      modelStorageDisposablesRef.current.forEach((disposable) => disposable.dispose());
      modelStorageDisposablesRef.current = [];
      modelsRef.current.forEach((model) => model.dispose());
      modelsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const onWorkspaceMove = (event) => {
      const drag = workspaceResizeDragRef.current;
      if (!drag) {
        return;
      }

      const point = getClientPoint(event);
      if (!point) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }

      if (drag.axis === 'x') {
        const deltaX = point.x - drag.startX;
        if (drag.target === 'explorer') {
          const rawWidth = drag.startWidth + deltaX;
          const clampedWidth = Math.max(drag.minWidth, Math.min(rawWidth, drag.maxWidth));
          setExplorerWidth(clampedWidth);
        } else {
          const rawWidth = drag.startSideWidth - deltaX;
          const clampedWidth = Math.max(drag.minSideWidth, Math.min(rawWidth, drag.maxSideWidth));
          setSidePaneWidth(clampedWidth);
        }
        return;
      }

      const deltaY = point.y - drag.startY;
      const rawHeight = drag.startSideHeight - deltaY;
      const clampedHeight = Math.max(drag.minSideHeight, Math.min(rawHeight, drag.maxSideHeight));
      setSidePaneHeight(clampedHeight);
    };

    const onWorkspaceEnd = () => {
      if (!workspaceResizeDragRef.current) {
        return;
      }
      workspaceResizeDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onWorkspaceMove);
    window.addEventListener('mouseup', onWorkspaceEnd);
    window.addEventListener('touchmove', onWorkspaceMove, { passive: false });
    window.addEventListener('touchend', onWorkspaceEnd);
    window.addEventListener('touchcancel', onWorkspaceEnd);
    return () => {
      window.removeEventListener('mousemove', onWorkspaceMove);
      window.removeEventListener('mouseup', onWorkspaceEnd);
      window.removeEventListener('touchmove', onWorkspaceMove);
      window.removeEventListener('touchend', onWorkspaceEnd);
      window.removeEventListener('touchcancel', onWorkspaceEnd);
      onWorkspaceEnd();
    };
  }, []);

  useEffect(() => {
    const onPanelResizeMove = (event) => {
      const drag = resizeDragRef.current;
      if (!drag) {
        return;
      }

      const point = getClientPoint(event);
      if (!point) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }

      const deltaY = point.y - drag.startY;
      const nextHeights = [...drag.startHeights];
      const firstIndex = drag.index;
      const secondIndex = drag.index + 1;
      let firstHeight = drag.startHeights[firstIndex] + deltaY;
      let secondHeight = drag.startHeights[secondIndex] - deltaY;

      if (firstHeight < drag.minHeight) {
        secondHeight -= drag.minHeight - firstHeight;
        firstHeight = drag.minHeight;
      }
      if (secondHeight < drag.minHeight) {
        firstHeight -= drag.minHeight - secondHeight;
        secondHeight = drag.minHeight;
      }

      nextHeights[firstIndex] = firstHeight;
      nextHeights[secondIndex] = secondHeight;
      const nextRatios = nextHeights.map((height) => height / drag.availableHeight);
      const ratioSum = nextRatios.reduce((sum, value) => sum + value, 0) || 1;
      setPanelRatios(nextRatios.map((value) => value / ratioSum));
    };

    const onPanelResizeEnd = () => {
      if (!resizeDragRef.current) {
        return;
      }
      resizeDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onPanelResizeMove);
    window.addEventListener('mouseup', onPanelResizeEnd);
    window.addEventListener('touchmove', onPanelResizeMove, { passive: false });
    window.addEventListener('touchend', onPanelResizeEnd);
    window.addEventListener('touchcancel', onPanelResizeEnd);
    return () => {
      window.removeEventListener('mousemove', onPanelResizeMove);
      window.removeEventListener('mouseup', onPanelResizeEnd);
      window.removeEventListener('touchmove', onPanelResizeMove);
      window.removeEventListener('touchend', onPanelResizeEnd);
      window.removeEventListener('touchcancel', onPanelResizeEnd);
      onPanelResizeEnd();
    };
  }, []);

  const startWorkspaceResize = (event) => {
    event.preventDefault();
    const point = getClientPoint(event);
    if (!point) {
      return;
    }

    const workspace = workspaceRef.current;
    const sidePane = sidePaneRef.current;
    if (!workspace || !sidePane) {
      return;
    }

    if (!isMobileView) {
      const workspaceWidth = workspace.getBoundingClientRect().width;
      const splitterWidth = event.currentTarget.getBoundingClientRect().width;
      const startSideWidth = sidePane.getBoundingClientRect().width;
      const maxSideWidth = workspaceWidth - splitterWidth - WORKSPACE_RESIZER_MIN_EDITOR_PX;
      if (maxSideWidth <= WORKSPACE_RESIZER_MIN_SIDE_PX) {
        return;
      }

      workspaceResizeDragRef.current = {
        axis: 'x',
        startX: point.x,
        startSideWidth,
        minSideWidth: WORKSPACE_RESIZER_MIN_SIDE_PX,
        maxSideWidth
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      return;
    }

    const workspaceHeight = workspace.getBoundingClientRect().height;
    const splitterHeight = event.currentTarget.getBoundingClientRect().height;
    const startSideHeight = sidePane.getBoundingClientRect().height;
    const maxSideHeight = workspaceHeight - splitterHeight - WORKSPACE_RESIZER_MIN_EDITOR_HEIGHT_PX;
    if (maxSideHeight <= WORKSPACE_RESIZER_MIN_SIDE_HEIGHT_PX) {
      return;
    }

    workspaceResizeDragRef.current = {
      axis: 'y',
      startY: point.y,
      startSideHeight,
      minSideHeight: WORKSPACE_RESIZER_MIN_SIDE_HEIGHT_PX,
      maxSideHeight
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const startExplorerResize = (event) => {
    event.preventDefault();
    if (isMobileView) {
      return;
    }
    const point = getClientPoint(event);
    if (!point) {
      return;
    }

    const workspace = workspaceRef.current;
    const explorerPane = explorerPaneRef.current;
    const sidePane = sidePaneRef.current;
    if (!workspace || !explorerPane || !sidePane) {
      return;
    }

    const workspaceWidth = workspace.getBoundingClientRect().width;
    const sideWidth = sidePane.getBoundingClientRect().width;
    const splitterWidth = event.currentTarget.getBoundingClientRect().width;
    const rightSplitterAllowance = 8;
    const startWidth = explorerPane.getBoundingClientRect().width;
    const maxWidth = workspaceWidth - sideWidth - splitterWidth - rightSplitterAllowance - WORKSPACE_RESIZER_MIN_EDITOR_PX;
    if (maxWidth <= WORKSPACE_RESIZER_MIN_EXPLORER_PX) {
      return;
    }

    workspaceResizeDragRef.current = {
      axis: 'x',
      target: 'explorer',
      startX: point.x,
      startWidth,
      minWidth: WORKSPACE_RESIZER_MIN_EXPLORER_PX,
      maxWidth
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const startResize = (index, event) => {
    event.preventDefault();
    const point = getClientPoint(event);
    if (!point) {
      return;
    }

    const container = sidePaneRef.current;
    if (!container) {
      return;
    }

    const totalHeight = container.getBoundingClientRect().height;
    const availableHeight = totalHeight - RESIZER_HEIGHT_PX * 2;
    if (availableHeight <= 0) {
      return;
    }

    const minHeight = Math.min(MIN_PANEL_HEIGHT_PX, Math.floor(availableHeight / 3));
    const startHeights = panelRatios.map((ratio) => ratio * availableHeight);
    resizeDragRef.current = {
      index,
      startY: point.y,
      startHeights,
      availableHeight,
      minHeight
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const runCode = async () => {
    if (!activeFile) {
      setOutput('No file selected');
      return;
    }
    let openingTimer = null;
    let openingLogId = null;
    let compileLogId = null;
    let runLogId = null;
    let queueLogId = null;
    const runStartedAt = performance.now();
    const runId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `run-${Date.now()}`;
    const runAbortController = new AbortController();
    currentRunIdRef.current = runId;
    currentRunAbortRef.current = runAbortController;
    stopRequestedRef.current = false;
    const isCompiledLanguage = COMPILED_LANGUAGES.has(activeFile.language);
    const progress = {
      phase: 'opening',
      phaseStartedAt: runStartedAt,
      openStartedAt: runStartedAt,
      openMs: 0,
      compileMs: isCompiledLanguage ? 0 : null,
      executionMs: 0,
      queueWaitMs: null,
      queuePositionAtEnqueue: null,
      queueStartedAt: null,
      openFrozen: false,
      compileFrozen: false,
      executionFrozen: false,
      queueFrozen: true
    };
    let finalResult = null;
    let streamedStdout = '';
    let streamedStderr = '';

    const refreshProgressOutput = () => {
      const now = performance.now();
      if (progress.phase === 'opening' && !progress.openFrozen) {
        progress.openMs = Number((now - progress.openStartedAt).toFixed(3));
      } else if (progress.phase === 'compile' && !progress.compileFrozen) {
        progress.compileMs = Number((now - progress.phaseStartedAt).toFixed(3));
      } else if (progress.phase === 'run' && !progress.executionFrozen) {
        progress.executionMs = Number((now - progress.phaseStartedAt).toFixed(3));
      } else if (progress.phase === 'queue' && !progress.queueFrozen && progress.queueStartedAt) {
        progress.queueWaitMs = Number((now - progress.queueStartedAt).toFixed(3));
      }
      const statusBlock = buildStatusBlock(
        progress.openMs,
        progress.compileMs,
        progress.executionMs,
        null,
        null,
        null,
        null,
        progress.queueWaitMs,
        progress.queuePositionAtEnqueue
      );
      setOutput(buildOutputText(statusBlock, streamedStdout, streamedStderr));
    };

    const formatQueueLogLine = (queueWaitMs, queuePositionAtEnqueue = null) => {
      const waitLabel = typeof queueWaitMs === 'number' ? `${queueWaitMs.toFixed(0)} ms` : 'N/A';
      if (typeof queuePositionAtEnqueue === 'number') {
        return `  queue waiting... ${waitLabel} (#${queuePositionAtEnqueue})`;
      }
      return `  queue waiting... ${waitLabel}`;
    };

    try {
      setRunning(true);
      refreshProgressOutput();
      appendLog(`run requested (${activeFile.language})`);
      queueLogId = appendLogWithId('  queue waiting... 0 ms');
      openingLogId = appendLogWithId('  opening container... 0 ms');
      if (isCompiledLanguage) {
        compileLogId = appendLogWithId('  compile time... 0 ms');
      }
      runLogId = appendLogWithId('  code execution time... 0 ms');

      openingTimer = window.setInterval(() => {
        const line = `  opening container... ${progress.openMs.toFixed(0)} ms`;
        updateLogById(openingLogId, line);
        if (compileLogId) {
          updateLogById(compileLogId, `  compile time... ${progress.compileMs?.toFixed(0) || 0} ms`);
        }
        if (runLogId) {
          updateLogById(runLogId, `  code execution time... ${progress.executionMs.toFixed(0)} ms`);
        }
        if (queueLogId && progress.queueWaitMs !== null) {
          updateLogById(
            queueLogId,
            formatQueueLogLine(progress.queueWaitMs, progress.phase === 'queue' ? progress.queuePositionAtEnqueue : null)
          );
        }
        refreshProgressOutput();
      }, 80);

      const response = await fetch('/api/run/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: runAbortController.signal,
        body: JSON.stringify({
          runId,
          language: activeFile.language,
          stdin: stdinText,
          code: modelsRef.current.get(activeFile.id)?.getValue() || activeFile.content || ''
        })
      });

      if (!response.ok || !response.body) {
        const fallbackError = await response.json().catch(() => ({}));
        throw new Error(fallbackError.error || 'Failed to start streaming run');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const applyPhase = (phase, ms, eventPayload = null) => {
        if (phase === 'queue_wait_start') {
          progress.queuePositionAtEnqueue =
            typeof eventPayload?.position === 'number'
              ? eventPayload.position
              : progress.queuePositionAtEnqueue;
          progress.queueWaitMs = 0;
          progress.queueStartedAt = performance.now();
          progress.queueFrozen = false;
          progress.phase = 'queue';
          refreshProgressOutput();
          return;
        }

        if (phase === 'queue_wait_update') {
          if (typeof eventPayload?.position === 'number') {
            progress.queuePositionAtEnqueue = eventPayload.position;
          }
          refreshProgressOutput();
          return;
        }

        if (phase === 'queue_wait_end') {
          if (typeof ms === 'number') {
            progress.queueWaitMs = ms;
          } else if (progress.queueStartedAt) {
            progress.queueWaitMs = Number((performance.now() - progress.queueStartedAt).toFixed(3));
          }
          progress.queueFrozen = true;
          progress.phase = 'opening';
          progress.openStartedAt = performance.now();
          progress.openMs = 0;
          if (queueLogId && progress.queueWaitMs !== null) {
            updateLogById(queueLogId, `  queue waiting... ${progress.queueWaitMs.toFixed(3)} ms`);
          }
          progress.queuePositionAtEnqueue = null;
          refreshProgressOutput();
          return;
        }

        if (phase === 'open_done') {
          if (typeof ms === 'number') {
            progress.openMs = ms;
          }
          progress.openFrozen = true;
          progress.phase = isCompiledLanguage ? 'waiting_compile' : 'waiting_run';
          progress.phaseStartedAt = performance.now();
          refreshProgressOutput();
          return;
        }

        if (phase === 'compile_start') {
          if (progress.compileMs === null) {
            progress.compileMs = 0;
          }
          progress.compileFrozen = false;
          progress.phase = 'compile';
          progress.phaseStartedAt = performance.now();
          refreshProgressOutput();
          return;
        }

        if (phase === 'compile_end') {
          if (typeof ms === 'number') {
            progress.compileMs = ms;
          }
          progress.compileFrozen = true;
          progress.phase = 'waiting_run';
          progress.phaseStartedAt = performance.now();
          refreshProgressOutput();
          return;
        }

        if (phase === 'run_start') {
          progress.executionFrozen = false;
          progress.executionMs = 0;
          progress.phase = 'run';
          progress.phaseStartedAt = performance.now();
          refreshProgressOutput();
          return;
        }

        if (phase === 'run_end') {
          if (typeof ms === 'number') {
            progress.executionMs = ms;
          }
          progress.executionFrozen = true;
          refreshProgressOutput();
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf('\n');
          if (newlineIndex === -1) {
            break;
          }
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) {
            continue;
          }

          let eventPayload;
          try {
            eventPayload = JSON.parse(line);
          } catch {
            continue;
          }

          if (eventPayload.event === 'phase') {
            applyPhase(eventPayload.phase, eventPayload.ms, eventPayload);
            continue;
          }

          if (eventPayload.event === 'stdout' && typeof eventPayload.chunk === 'string') {
            streamedStdout += eventPayload.chunk;
            refreshProgressOutput();
            continue;
          }

          if (eventPayload.event === 'stderr' && typeof eventPayload.chunk === 'string') {
            streamedStderr += eventPayload.chunk;
            refreshProgressOutput();
            continue;
          }

          if (eventPayload.event === 'run' && typeof eventPayload.runId === 'string') {
            currentRunIdRef.current = eventPayload.runId;
            continue;
          }

          if (eventPayload.event === 'final') {
            finalResult = eventPayload;
          }
        }
      }

      if (buffer.trim()) {
        try {
          const eventPayload = JSON.parse(buffer.trim());
          if (eventPayload.event === 'phase') {
            applyPhase(eventPayload.phase, eventPayload.ms, eventPayload);
          } else if (eventPayload.event === 'stdout' && typeof eventPayload.chunk === 'string') {
            streamedStdout += eventPayload.chunk;
            refreshProgressOutput();
          } else if (eventPayload.event === 'stderr' && typeof eventPayload.chunk === 'string') {
            streamedStderr += eventPayload.chunk;
            refreshProgressOutput();
          } else if (eventPayload.event === 'run' && typeof eventPayload.runId === 'string') {
            currentRunIdRef.current = eventPayload.runId;
          } else if (eventPayload.event === 'final') {
            finalResult = eventPayload;
          }
        } catch {
          // Ignore trailing parse errors.
        }
      }

      if (!finalResult) {
        throw new Error('Run stream ended without final result');
      }

      const containerOpenMs =
        typeof finalResult.containerOpenMs === 'number'
          ? finalResult.containerOpenMs
          : Number((performance.now() - runStartedAt).toFixed(3));

      if (Array.isArray(finalResult.logs) && finalResult.logs.length > 0) {
        finalResult.logs.forEach((line) => appendLog(line));
      }

      updateLogById(
        openingLogId,
        Number.isFinite(containerOpenMs)
          ? `  opening container... ${containerOpenMs.toFixed(3)} ms`
          : '  opening container... done'
      );
      if (queueLogId) {
        const queueWaitMs = typeof finalResult.queueWaitMs === 'number' ? finalResult.queueWaitMs : 0;
        updateLogById(queueLogId, `  queue waiting... ${queueWaitMs.toFixed(3)} ms`);
      }
      if (compileLogId && typeof finalResult.compileMs === 'number') {
        updateLogById(compileLogId, `  compile time... ${finalResult.compileMs.toFixed(3)} ms`);
      }
      if (runLogId && typeof finalResult.executionMs === 'number') {
        updateLogById(runLogId, `  code execution time... ${finalResult.executionMs.toFixed(3)} ms`);
      }

      if (!finalResult.ok) {
        const statusBlock = buildStatusBlock(
          containerOpenMs,
          finalResult.compileMs,
          finalResult.executionMs,
          finalResult.sandboxCpuPercent,
          finalResult.sandboxCpuLimit,
          finalResult.sandboxMemoryPeakBytes,
          finalResult.sandboxMemoryLimitBytes,
          finalResult.queueWaitMs,
          null
        );

        const failureOutput = buildOutputText(
          statusBlock,
          finalResult.stdout ?? streamedStdout,
          finalResult.stderr ?? streamedStderr,
          finalResult.error
        );

        setOutput(failureOutput || 'Run failed');
        return;
      }

      const statusBlock = buildStatusBlock(
        containerOpenMs,
        finalResult.compileMs,
        finalResult.executionMs,
        finalResult.sandboxCpuPercent,
        finalResult.sandboxCpuLimit,
        finalResult.sandboxMemoryPeakBytes,
        finalResult.sandboxMemoryLimitBytes,
        finalResult.queueWaitMs,
        null
      );

      const next = buildOutputText(
        statusBlock,
        finalResult.stdout ?? streamedStdout,
        finalResult.stderr ?? streamedStderr
      );

      setOutput(next || 'No output');
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      if (isAbort || stopRequestedRef.current) {
        const stopMsg = 'Execution stopped by user';
        setOutput(`[status]\n${stopMsg}`);
        appendLog('run stopped by user');
      } else {
        setOutput(error.message || 'Network error');
        appendLog(`run failed: ${error.message || 'network error'}`);
      }
    } finally {
      if (openingTimer) {
        window.clearInterval(openingTimer);
      }
      currentRunIdRef.current = null;
      currentRunAbortRef.current = null;
      stopRequestedRef.current = false;
      setRunning(false);
    }
  };

  const stopRun = async () => {
    if (!running) {
      return;
    }
    stopRequestedRef.current = true;
    const runId = currentRunIdRef.current;
    if (runId) {
      try {
        await fetch('/api/run/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId })
        });
      } catch {
        // Ignore cancel request errors and still abort local stream.
      }
    }
    if (currentRunAbortRef.current) {
      currentRunAbortRef.current.abort();
    }
  };

  const handleLogout = async () => {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      // Ignore logout failures and still clear local state.
    }
    setUser(null);
    setRenameFileModalOpen(false);
    setCreateFileModalOpen(false);
    setLoginPromptOpen(false);
    saveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    saveTimersRef.current.clear();
    stdinSaveTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    stdinSaveTimersRef.current.clear();
    modelsRef.current.forEach((model) => model.dispose());
    modelsRef.current.clear();
    if (lspRef.current) {
      lspRef.current.stop();
      lspRef.current = null;
    }
  };

  const openCreateFileModal = () => {
    setNewFileName('');
    setNewFileLanguage(language);
    setCreateFileModalOpen(true);
  };

  const closeCreateFileModal = () => {
    setCreateFileModalOpen(false);
  };

  const createFile = async () => {
    if (!canCreateFile) {
      return;
    }
    try {
      let nextFile;
      if (user) {
        const payload = await fetchJson('/api/files', {
          method: 'POST',
          body: JSON.stringify({
            name: newFileName,
            language: newFileLanguage,
            content: getStarterForLanguage(newFileLanguage),
            stdin: ''
          })
        });
        nextFile = payload.file;
      } else {
        nextFile = createLocalFile(newFileLanguage, newFileName);
      }
      setFiles((prev) => [nextFile, ...prev]);
      setSelectedFileId(nextFile.id);
      setLanguage(nextFile.language);
      setStdinText(nextFile.stdin || '');
      closeCreateFileModal();
    } catch (error) {
      appendLog(`file create failed: ${error.message}`);
    }
  };

  const openRenameFileModal = (file) => {
    setRenameFileId(file.id);
    setRenameFileName(file.name.replace(/\.[^.]+$/, ''));
    setRenameFileLanguage(file.language);
    setRenameFileModalOpen(true);
  };

  const closeRenameFileModal = () => {
    setRenameFileModalOpen(false);
    setRenameFileId(null);
    setRenameFileName('');
    setRenameFileLanguage(DEFAULT_LANGUAGE);
  };

  const deleteFile = async () => {
    const targetFile = files.find((file) => file.id === renameFileId);
    if (!targetFile) {
      closeRenameFileModal();
      return;
    }
    try {
      if (user) {
        await fetchJson(`/api/files/${targetFile.id}`, { method: 'DELETE' });
      }
      const pendingSave = saveTimersRef.current.get(targetFile.id);
      if (pendingSave) {
        window.clearTimeout(pendingSave);
        saveTimersRef.current.delete(targetFile.id);
      }
      const pendingStdinSave = stdinSaveTimersRef.current.get(targetFile.id);
      if (pendingStdinSave) {
        window.clearTimeout(pendingStdinSave);
        stdinSaveTimersRef.current.delete(targetFile.id);
      }
      const existingModel = modelsRef.current.get(targetFile.id);
      if (existingModel) {
        existingModel.dispose();
        modelsRef.current.delete(targetFile.id);
      }
      const nextFiles = files.filter((file) => file.id !== targetFile.id);
      setFiles(nextFiles);
      if (selectedFileId === targetFile.id) {
        setSelectedFileId(nextFiles[0]?.id || null);
        setStdinText(nextFiles[0]?.stdin || '');
      }
      closeRenameFileModal();
    } catch (error) {
      appendLog(`file delete failed: ${error.message}`);
    }
  };

  const saveFileMetadata = async (targetFile, { name, language: nextLanguage }) => {
    if (!targetFile) {
      return;
    }
    const currentModel = ensureModelForFile(targetFile);
    const currentContent = currentModel?.getValue?.() ?? targetFile.content ?? '';
    let nextFile;
    if (user) {
      const payload = await fetchJson(`/api/files/${targetFile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          language: nextLanguage,
          content: currentContent,
          stdin: targetFile.stdin || ''
        })
      });
      nextFile = { ...targetFile, ...payload.file };
    } else {
      nextFile = {
        ...targetFile,
        name: normalizeFileName(name, nextLanguage),
        language: nextLanguage,
        content: currentContent,
        stdin: targetFile.stdin || ''
      };
    }
    const oldModel = modelsRef.current.get(targetFile.id);
    if (oldModel && monacoRef.current) {
      const replacement = monacoRef.current.editor.createModel(
        currentContent,
        getMonacoLanguageForLanguage(nextFile.language),
        getModelUri(monacoRef.current, nextFile)
      );
      const disposable = replacement.onDidChangeContent(() => {
        if (editorRef.current?.getModel() === replacement) {
          updateEditorStatusFromEditor(editorRef.current);
        }
        scheduleFileSave(nextFile.id, replacement.getValue());
      });
      modelStorageDisposablesRef.current.push(disposable);
      modelsRef.current.set(nextFile.id, replacement);
      oldModel.dispose();
    }
    setFiles((prev) => prev.map((file) => (file.id === nextFile.id ? nextFile : file)));
    if (selectedFileId === nextFile.id) {
      setLanguage(nextFile.language);
      setStdinText(nextFile.stdin || '');
      window.setTimeout(() => {
        syncSelectedFileModel(nextFile);
        bootLspForFile(nextFile);
      }, 0);
    }
    return nextFile;
  };

  const renameFile = async () => {
    const targetFile = files.find((file) => file.id === renameFileId);
    if (!targetFile) {
      closeRenameFileModal();
      return;
    }
    try {
      await saveFileMetadata(targetFile, {
        name: renameFileName,
        language: renameFileLanguage
      });
      closeRenameFileModal();
    } catch (error) {
      appendLog(`file update failed: ${error.message}`);
    }
  };

  const openResetModal = () => {
    setResetModalOpen(true);
  };

  const closeResetModal = () => {
    setResetModalOpen(false);
  };

  const resetCurrentCode = () => {
    const model = activeFile ? modelsRef.current.get(activeFile.id) : null;
    const editor = editorRef.current;
    const starter = getStarterForLanguage(language);

    if (!model || typeof starter !== 'string') {
      setResetModalOpen(false);
      return;
    }

    model.setValue(starter);
    if (editor && editor.getModel() === model) {
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.setSelection({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1
      });
      editor.focus();
    }

    setEditorStatus({
      lineCount: model.getLineCount(),
      lineNumber: 1,
      column: 1,
      selectedChars: 0,
      isFocused: true
    });
    if (selectedFile) {
      persistFilePatch(selectedFile.id, { content: starter }).catch((error) => appendLog(`save failed: ${error.message}`));
    }
    appendLog(`editor reset to default starter (${language})`);
    setResetModalOpen(false);
  };

  const renderOutput = () => {
    if (!output) {
      return output;
    }

    const sectionPattern = /^\[(status|stdout|stderr|error)\]\n/gm;
    const matches = Array.from(output.matchAll(sectionPattern));
    if (matches.length === 0) {
      return output;
    }

    const chunks = [];
    let key = 0;

    if (matches[0].index > 0) {
      chunks.push(
        <span key={`plain-${key++}`} className="output-plain-block">
          {output.slice(0, matches[0].index)}
        </span>
      );
    }

    for (let i = 0; i < matches.length; i += 1) {
      const current = matches[i];
      const next = matches[i + 1];
      const start = current.index;
      const end = next ? next.index : output.length;
      const raw = output.slice(start, end);
      const section = current[1];
      const className =
        section === 'status'
          ? 'output-status-block'
          : section === 'stderr' || section === 'error'
            ? 'output-stderr-block'
            : section === 'stdout'
              ? 'output-stdout-block'
              : 'output-plain-block';

      chunks.push(
        <span key={`section-${key++}`} className={className}>
          {raw}
        </span>
      );
    }

    return chunks;
  };

  const editorStatusLabel = editorStatus.isFocused
    ? `Ln ${editorStatus.lineNumber}, Col ${editorStatus.column}${
        editorStatus.selectedChars > 0 ? ` (${editorStatus.selectedChars} selected)` : ''
      }`
    : `Lines ${editorStatus.lineCount}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button
            type="button"
            className="control-btn secondary-btn mobile-menu-btn"
            onClick={() => setExplorerOpen((prev) => !prev)}
            aria-label="Toggle explorer"
          >
            ≡
          </button>
          <img className="brand-logo" src="/sc_logo.png" alt="SDY.CODER logo" />
          <span>SDY.CODER</span>
        </div>
        <div className="controls">
          <button
            type="button"
            className="control-btn danger-btn"
            onClick={openResetModal}
            disabled={running || !activeFile}
          >
            Reset
          </button>
          <button
            type="button"
            className={`run-btn${running ? ' stop-btn' : ''}`}
            onClick={running ? stopRun : runCode}
            disabled={!activeFile}
          >
            {running ? 'Stop' : 'Run'}
          </button>
        </div>
      </header>

      <main
        className="workspace"
        ref={workspaceRef}
        style={{
          '--explorer-width': `${Math.round(explorerWidth)}px`,
          '--side-pane-width': `${Math.round(sidePaneWidth)}px`,
          '--side-pane-height': `${Math.round(sidePaneHeight)}px`
        }}
      >
        {explorerOpen ? (
          <aside className="explorer-pane" ref={explorerPaneRef}>
            <div className="explorer-header">
              <button type="button" className="explorer-title-button" onClick={() => setExplorerOpen(false)}>
                Explorer
              </button>
              <button
                type="button"
                className="control-btn secondary-btn explorer-header-btn"
                onClick={() => setExplorerOpen(false)}
                title="Collapse explorer"
              >
                ‹
              </button>
              <button type="button" className="control-btn secondary-btn explorer-header-btn" onClick={openCreateFileModal}>
                +
              </button>
            </div>
            {user ? (
              <div className="explorer-user explorer-user-authenticated">
                {user.avatarUrl ? <img className="explorer-avatar" src={user.avatarUrl} alt={user.name} /> : null}
                <div className="explorer-user-meta">
                  <span>{user.name}</span>
                  <span>{user.email}</span>
                </div>
                <button type="button" className="control-btn secondary-btn explorer-auth-btn" onClick={handleLogout}>
                  Logout
                </button>
              </div>
            ) : (
              <div className="explorer-user explorer-user-logged-out">
                <div className="explorer-avatar explorer-avatar-placeholder">?</div>
                <div className="explorer-user-meta">
                  <span>로그인 필요</span>
                  <span>로그인하여 어디서든 코딩하기</span>
                </div>
                <div className="explorer-auth-slot">
                  {authLoading ? <span className="explorer-login-copy">Loading...</span> : null}
                  {!authLoading && !googleClientId ? (
                    <span className="login-error">`GOOGLE_CLIENT_ID`가 설정되지 않았습니다.</span>
                  ) : null}
                  {googleClientId ? <span id="google-login-button" className="google-login-button" /> : null}
                </div>
              </div>
            )}
            <div className="explorer-files">
              {files.length === 0 ? (
                <div className="explorer-empty">아직 파일이 없습니다. `+` 버튼으로 새 파일을 만드세요.</div>
              ) : (
                files.map((file) => (
                  <div key={file.id} className={`explorer-file-row${file.id === selectedFileId ? ' active' : ''}`}>
                    <button
                      type="button"
                      className={`explorer-file${file.id === selectedFileId ? ' active' : ''}`}
                      onClick={() => setSelectedFileId(file.id)}
                    >
                      {file.name}
                    </button>
                    <button
                      type="button"
                      className="explorer-file-action"
                      title="Rename file"
                      onClick={(event) => {
                        event.stopPropagation();
                        openRenameFileModal(file);
                      }}
                    >
                      ✎
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        ) : !isMobileView ? (
          <aside className="explorer-rail">
            <button
              type="button"
              className="control-btn secondary-btn explorer-header-btn"
              onClick={() => setExplorerOpen(true)}
              title="Expand explorer"
            >
              ›
            </button>
            {user?.avatarUrl ? (
              <img className="explorer-rail-avatar" src={user.avatarUrl} alt={user.name} />
            ) : (
              <div className="explorer-avatar explorer-avatar-placeholder explorer-rail-avatar">?</div>
            )}
            <div className="explorer-rail-files">
              {selectedFile ? (
                <button
                  type="button"
                  className="explorer-rail-file active"
                  title={selectedFile.name}
                >
                  <span className="explorer-rail-file-label">{selectedFile.name}</span>
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}

        {explorerOpen ? (
          <div
            className="workspace-resizer explorer-resizer"
            role="separator"
            aria-label="Resize explorer and editor panels"
            aria-orientation="vertical"
            onMouseDown={startExplorerResize}
            onTouchStart={startExplorerResize}
          />
        ) : null}

        <section className="editor-pane">
          <div className="editor-surface">
            <Editor
              height="100%"
              defaultLanguage="python"
              defaultValue={LANGUAGES[0].starter}
              theme="vscode-dark-modern"
              onMount={onEditorMount}
              options={{
                minimap: { enabled: false },
                'semanticHighlighting.enabled': true,
                fontSize: 14,
                fontLigatures: true,
                smoothScrolling: true,
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
                lineNumbersMinChars: 3,
                tabCompletion: 'on',
                snippetSuggestions: 'inline',
                acceptSuggestionOnEnter: 'on',
                suggest: {
                  showSnippets: true,
                  snippetsPreventQuickSuggestions: false
                }
              }}
            />
          </div>
          <div className="editor-statusbar">
            <span>{activeFile ? `${activeFile.name}  |  ${editorStatusLabel}` : editorStatusLabel}</span>
          </div>
        </section>

        {explorerOpen ? (
          <div
            className="workspace-resizer"
            role="separator"
            aria-label="Resize editor and side panels"
            aria-orientation="vertical"
            onMouseDown={startWorkspaceResize}
            onTouchStart={startWorkspaceResize}
          />
        ) : null}

        <section className="side-pane" ref={sidePaneRef}>
          <div className="panel-slot" style={{ flexGrow: panelRatios[0], flexBasis: 0 }}>
            <div className="panel">
              <div className="panel-title">Input</div>
              <textarea
                className="input-area"
                value={stdinText}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setStdinText(nextValue);
                  if (selectedFile) {
                    setFiles((prev) => prev.map((file) => (file.id === selectedFile.id ? { ...file, stdin: nextValue } : file)));
                    scheduleFileStdinSave(selectedFile.id, nextValue);
                  }
                }}
                placeholder={'Provide stdin here...\nExample:\n5\n1 2 3 4 5'}
                spellCheck={false}
              />
            </div>
          </div>
          <div
            className="panel-resizer"
            role="separator"
            aria-label="Resize input and output panels"
            aria-orientation="horizontal"
            onMouseDown={(event) => startResize(0, event)}
            onTouchStart={(event) => startResize(0, event)}
          />
          <div className="panel-slot" style={{ flexGrow: panelRatios[1], flexBasis: 0 }}>
            <div className="panel">
              <div className="panel-title">Output</div>
              <pre className="panel-body">{renderOutput()}</pre>
            </div>
          </div>
          <div
            className="panel-resizer"
            role="separator"
            aria-label="Resize output and logs panels"
            aria-orientation="horizontal"
            onMouseDown={(event) => startResize(1, event)}
            onTouchStart={(event) => startResize(1, event)}
          />
          <div className="panel-slot" style={{ flexGrow: panelRatios[2], flexBasis: 0 }}>
            <div className="panel">
              <div className="panel-title">Logs</div>
              <div className="panel-body logs-body" ref={logsBodyRef}>
                {logs.length === 0 ? (
                  'No logs yet.'
                ) : (
                  logs.map((entry, index) => (
                    <div className="log-line" key={entry.id || `${entry.timestamp}-${index}`}>
                      <span className="log-time">{entry.timestamp}</span>
                      <span className="log-text">{entry.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
      {resetModalOpen ? (
        <div className="modal-backdrop" onClick={closeResetModal}>
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-modal-title" id="reset-modal-title">
              Reset Code
            </div>
            <div className="confirm-modal-body">
              현재 언어의 코드를 기본 예제로 초기화하시겠습니까?
            </div>
            <div className="confirm-modal-actions">
              <button type="button" className="control-btn secondary-btn" onClick={closeResetModal}>
                Cancel
              </button>
              <button type="button" className="control-btn danger-btn" onClick={resetCurrentCode}>
                Reset
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {createFileModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateFileModal}>
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-file-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-modal-title" id="create-file-title">
              Create File
            </div>
            <div className="confirm-modal-body">
              <input
                className="file-name-input"
                value={newFileName}
                onChange={(event) => setNewFileName(event.target.value)}
                placeholder="File name"
                autoFocus
              />
              <select
                className="file-name-input modal-select"
                value={newFileLanguage}
                onChange={(event) => setNewFileLanguage(event.target.value)}
              >
                {LANGUAGES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.versionLabel ? `${item.label} ${item.versionLabel}` : item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="confirm-modal-actions">
              <button type="button" className="control-btn secondary-btn" onClick={closeCreateFileModal}>
                Cancel
              </button>
              <button type="button" className="control-btn primary-btn" onClick={createFile} disabled={!canCreateFile}>
                Create
              </button>
            </div>
            {!newFileName.trim() ? (
              <div className="confirm-modal-body modal-error">파일 이름을 입력해야 합니다.</div>
            ) : createNameTaken ? (
              <div className="confirm-modal-body modal-error">같은 이름의 파일이 이미 있습니다.</div>
            ) : null}
          </div>
        </div>
      ) : null}
      {renameFileModalOpen ? (
        <div className="modal-backdrop">
          <div
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-file-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-modal-title" id="rename-file-title">
              Edit File
            </div>
            <div className="confirm-modal-body">
              <input
                className="file-name-input"
                value={renameFileName}
                onChange={(event) => setRenameFileName(event.target.value)}
                placeholder="untitled"
                autoFocus
              />
              <select
                className="file-name-input modal-select"
                value={renameFileLanguage}
                onChange={(event) => setRenameFileLanguage(event.target.value)}
              >
                {LANGUAGES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.versionLabel ? `${item.label} ${item.versionLabel}` : item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="confirm-modal-actions">
              <button type="button" className="control-btn secondary-btn" onClick={closeRenameFileModal}>
                Cancel
              </button>
              <button type="button" className="control-btn danger-btn" onClick={deleteFile}>
                Delete
              </button>
              <button type="button" className="control-btn primary-btn" onClick={renameFile}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
