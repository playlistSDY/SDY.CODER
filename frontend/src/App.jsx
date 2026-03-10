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
const CODE_STORAGE_KEY_PREFIX = 'web-vscode:code:';
const SIDE_PANE_WIDTH_STORAGE_KEY = 'web-vscode:side-pane-width';
const SIDE_PANE_HEIGHT_STORAGE_KEY = 'web-vscode:side-pane-height';
const DEFAULT_SIDE_PANE_WIDTH_PX = 360;
const DEFAULT_SIDE_PANE_HEIGHT_PX = 380;
const WORKSPACE_RESIZER_MIN_EDITOR_PX = 420;
const WORKSPACE_RESIZER_MIN_SIDE_PX = 280;
const WORKSPACE_RESIZER_MIN_EDITOR_HEIGHT_PX = 260;
const WORKSPACE_RESIZER_MIN_SIDE_HEIGHT_PX = 220;
const RESIZER_HEIGHT_PX = 8;
const DEFAULT_PANEL_RATIOS = [0.26, 0.46, 0.28];
const MIN_PANEL_HEIGHT_PX = 96;
const LEGACY_CSHARP_STARTER =
  `using System;\n\npublic class Main {\n    public static void Main(string[] args) {\n        Console.WriteLine(\"Hello, C#\");\n    }\n}\n`;

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

function loadLastCode(lang) {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(`${CODE_STORAGE_KEY_PREFIX}${lang}`);
  } catch {
    return null;
  }
}

function saveLastCode(lang, code) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(`${CODE_STORAGE_KEY_PREFIX}${lang}`, code);
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

function normalizeLoadedCode(languageId, code) {
  if (languageId === 'csharp' && code === LEGACY_CSHARP_STARTER) {
    const csharpLang = LANGUAGES.find((item) => item.id === 'csharp');
    return csharpLang?.starter || code;
  }
  return code;
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

  if (typeof sandboxCpuPercent === 'number' || typeof sandboxCpuLimit === 'number') {
    const usage =
      typeof sandboxCpuPercent === 'number' ? `${sandboxCpuPercent.toFixed(3)} %` : 'N/A';
    const limit = typeof sandboxCpuLimit === 'number' ? `${sandboxCpuLimit} vCPU` : 'N/A';
    lines.push(`CPU usage: ${usage} / max ${limit}`);
  }

  if (typeof sandboxMemoryPeakBytes === 'number' || typeof sandboxMemoryLimitBytes === 'number') {
    lines.push(
      `Memory peak: ${formatBytes(sandboxMemoryPeakBytes)} / max ${formatBytes(sandboxMemoryLimitBytes)}`
    );
  }

  return lines.join('\n');
}

function defineDarkModernTheme(monaco) {
  monaco.editor.defineTheme('vscode-dark-modern', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955' },
      { token: 'keyword', foreground: '569CD6' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'type.identifier', foreground: '4EC9B0' },
      { token: 'function', foreground: 'DCDCAA' },
      { token: 'method', foreground: 'DCDCAA' },
      { token: 'entity.name.function', foreground: 'DCDCAA' },
      { token: 'support.function', foreground: 'DCDCAA' }
    ],
    colors: {
      'editor.background': '#1f1f1f',
      'editor.foreground': '#cccccc',
      'editor.lineHighlightBackground': '#2a2d2e',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#3a3d41',
      'editorCursor.foreground': '#aeafad',
      'editorLineNumber.foreground': '#858585',
      'editorLineNumber.activeForeground': '#c6c6c6',
      'editorIndentGuide.background1': '#404040',
      'editorIndentGuide.activeBackground1': '#707070'
    }
  });
}

export default function App() {
  const [language, setLanguage] = useState(() => loadLastLanguage());
  const [stdinText, setStdinText] = useState('');
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
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

  const bootLspForLanguage = async (lang) => {
    if (!monacoRef.current) {
      return;
    }

    const sessionId = lspSessionRef.current + 1;
    lspSessionRef.current = sessionId;

    if (lspRef.current) {
      await lspRef.current.stop();
      lspRef.current = null;
    }

    const model = modelsRef.current.get(lang);
    if (!model) {
      return;
    }

    const nextClient = new LSPClient({
      monaco: monacoRef.current,
      language: lang,
      languageId: model.getLanguageId(),
      model,
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

    const updateEditorStatus = () => {
      const model = editor.getModel();
      const position = editor.getPosition();
      const selection = editor.getSelection();
      const selectedChars =
        model && selection ? model.getValueLengthInRange(selection) : 0;

      setEditorStatus({
        lineCount: model ? model.getLineCount() : 0,
        lineNumber: position?.lineNumber || 1,
        column: position?.column || 1,
        selectedChars,
        isFocused: editor.hasTextFocus()
      });
    };

    defineDarkModernTheme(monaco);
    monaco.editor.setTheme('vscode-dark-modern');

    LANGUAGES.forEach((langItem) => {
      const uri = monaco.Uri.parse(`${LSP_WORKSPACE_URI}/${getFileNameForLanguage(langItem.id)}`);
      const savedCode = loadLastCode(langItem.id);
      const initialCode = savedCode !== null ? normalizeLoadedCode(langItem.id, savedCode) : langItem.starter;
      const model = monaco.editor.createModel(
        initialCode,
        langItem.monacoLanguage || langItem.id,
        uri
      );
      const storageDisposable = model.onDidChangeContent(() => {
        saveLastCode(langItem.id, model.getValue());
        if (editor.getModel() === model) {
          const position = editor.getPosition();
          const selection = editor.getSelection();
          setEditorStatus({
            lineCount: model.getLineCount(),
            lineNumber: position?.lineNumber || 1,
            column: position?.column || 1,
            selectedChars: selection ? model.getValueLengthInRange(selection) : 0,
            isFocused: editor.hasTextFocus()
          });
        }
      });
      modelStorageDisposablesRef.current.push(storageDisposable);
      modelsRef.current.set(langItem.id, model);
    });

    const initialModel = modelsRef.current.get(language);
    editor.setModel(initialModel);
    updateEditorStatus();
    modelStorageDisposablesRef.current.push(editor.onDidChangeCursorPosition(updateEditorStatus));
    modelStorageDisposablesRef.current.push(editor.onDidChangeCursorSelection(updateEditorStatus));
    modelStorageDisposablesRef.current.push(editor.onDidFocusEditorText(updateEditorStatus));
    modelStorageDisposablesRef.current.push(editor.onDidBlurEditorText(updateEditorStatus));
    modelStorageDisposablesRef.current.push(editor.onDidChangeModel(updateEditorStatus));
    bootLspForLanguage(language);
  };

  useEffect(() => {
    saveLastLanguage(language);

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const model = modelsRef.current.get(language);
    if (model && editor.getModel() !== model) {
      editor.setModel(model);
      setEditorStatus((prev) => ({
        ...prev,
        lineCount: model.getLineCount(),
        lineNumber: 1,
        column: 1,
        selectedChars: 0
      }));
      bootLspForLanguage(language);
    }
  }, [language]);

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
    return () => {
      if (lspRef.current) {
        lspRef.current.stop();
      }
      modelStorageDisposablesRef.current.forEach((disposable) => disposable.dispose());
      modelStorageDisposablesRef.current = [];
      modelsRef.current.forEach((model) => model.dispose());
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
        const rawWidth = drag.startSideWidth - deltaX;
        const clampedWidth = Math.max(drag.minSideWidth, Math.min(rawWidth, drag.maxSideWidth));
        setSidePaneWidth(clampedWidth);
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
    const isCompiledLanguage = COMPILED_LANGUAGES.has(language);
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
      setOutput(
        buildStatusBlock(
          progress.openMs,
          progress.compileMs,
          progress.executionMs,
          null,
          null,
          null,
          null,
          progress.queueWaitMs,
          progress.queuePositionAtEnqueue
        )
      );
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
      appendLog(`run requested (${language})`);
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
          language,
          stdin: stdinText,
          code:
            modelsRef.current.get(language)?.getValue() ||
            LANGUAGES.find((item) => item.id === language)?.starter ||
            ''
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

        const failureOutput = [
          statusBlock,
          finalResult.stdout ? `[stdout]\n${finalResult.stdout}` : '',
          finalResult.stderr ? `[stderr]\n${finalResult.stderr}` : '',
          finalResult.error ? `[error]\n${finalResult.error}` : ''
        ]
          .filter(Boolean)
          .join('\n\n');

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

      const next = [
        statusBlock,
        finalResult.stdout ? `[stdout]\n${finalResult.stdout}` : '',
        finalResult.stderr ? `[stderr]\n${finalResult.stderr}` : ''
      ]
        .filter(Boolean)
        .join('\n\n');

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
          <img className="brand-logo" src="/sc_logo.png" alt="SDY.CODER logo" />
          <span>SDY.CODER</span>
        </div>
        <div className="controls">
          <select
            className="lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            {LANGUAGES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.versionLabel ? `${item.label} ${item.versionLabel}` : item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`run-btn${running ? ' stop-btn' : ''}`}
            onClick={running ? stopRun : runCode}
          >
            {running ? 'Stop' : 'Run'}
          </button>
        </div>
      </header>

      <main
        className="workspace"
        ref={workspaceRef}
        style={{
          '--side-pane-width': `${Math.round(sidePaneWidth)}px`,
          '--side-pane-height': `${Math.round(sidePaneHeight)}px`
        }}
      >
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
            <span>{editorStatusLabel}</span>
          </div>
        </section>

        <div
          className="workspace-resizer"
          role="separator"
          aria-label="Resize editor and side panels"
          aria-orientation="vertical"
          onMouseDown={startWorkspaceResize}
          onTouchStart={startWorkspaceResize}
        />

        <section className="side-pane" ref={sidePaneRef}>
          <div className="panel-slot" style={{ flexGrow: panelRatios[0], flexBasis: 0 }}>
            <div className="panel">
              <div className="panel-title">Input</div>
              <textarea
                className="input-area"
                value={stdinText}
                onChange={(e) => setStdinText(e.target.value)}
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
    </div>
  );
}
