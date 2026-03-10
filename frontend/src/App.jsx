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
const DEFAULT_PANEL_RATIOS = [0.34, 0.33, 0.33];
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

    if (lspRef.current) {
      await lspRef.current.stop();
      lspRef.current = null;
    }

    const model = modelsRef.current.get(lang);
    if (!model) {
      return;
    }

    lspRef.current = new LSPClient({
      monaco: monacoRef.current,
      language: lang,
      languageId: model.getLanguageId(),
      model,
      onLog: appendLog,
      workspaceUri: LSP_WORKSPACE_URI
    });
    lspRef.current.start();
  };

  const onEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

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
      });
      modelStorageDisposablesRef.current.push(storageDisposable);
      modelsRef.current.set(langItem.id, model);
    });

    const initialModel = modelsRef.current.get(language);
    editor.setModel(initialModel);
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
    const runStartedAt = performance.now();

    try {
      setRunning(true);
      setOutput('Opening container... 0 ms');
      appendLog(`run requested (${language})`);
      openingLogId = appendLogWithId('  opening container... 0 ms');

      openingTimer = window.setInterval(() => {
        const elapsedMs = performance.now() - runStartedAt;
        const line = `  opening container... ${elapsedMs.toFixed(0)} ms`;
        updateLogById(openingLogId, line);
        if (elapsedMs >= 1200) {
          setOutput(`Opening container... ${elapsedMs.toFixed(0)} ms\nCode execution in progress...`);
          return;
        }
        setOutput(`Opening container... ${elapsedMs.toFixed(0)} ms`);
      }, 80);

      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language,
          stdin: stdinText,
          code:
            modelsRef.current.get(language)?.getValue() ||
            LANGUAGES.find((item) => item.id === language)?.starter ||
            ''
        })
      });

      const result = await response.json();
      const containerOpenMs =
        typeof result.containerOpenMs === 'number'
          ? result.containerOpenMs
          : Number((performance.now() - runStartedAt).toFixed(3));

      updateLogById(
        openingLogId,
        Number.isFinite(containerOpenMs)
          ? `  opening container... ${containerOpenMs.toFixed(3)} ms`
          : '  opening container... done'
      );

      if (Array.isArray(result.logs) && result.logs.length > 0) {
        result.logs.forEach((line) => appendLog(line));
      }
      if (!response.ok) {
        const statusBlock = [
          '[status]',
          Number.isFinite(containerOpenMs)
            ? `Opening container: ${formatDurationWithSeconds(containerOpenMs)}`
            : 'Opening container: N/A',
          typeof result.executionMs === 'number'
            ? `Code execution time: ${formatDurationWithSeconds(result.executionMs)}`
            : 'Code execution time: N/A'
        ].join('\n');

        const failureOutput = [
          statusBlock,
          result.stdout ? `[stdout]\n${result.stdout}` : '',
          result.stderr ? `[stderr]\n${result.stderr}` : '',
          result.error ? `[error]\n${result.error}` : ''
        ]
          .filter(Boolean)
          .join('\n\n');

        setOutput(failureOutput || 'Run failed');
        return;
      }

      if (typeof result.executionMs === 'number') {
        appendLog(`  code execution finished: ${result.executionMs.toFixed(3)} ms`);
      }

      const statusBlock = [
        '[status]',
        Number.isFinite(containerOpenMs)
          ? `Opening container: ${formatDurationWithSeconds(containerOpenMs)}`
          : 'Opening container: N/A',
        typeof result.executionMs === 'number'
          ? `Code execution time: ${formatDurationWithSeconds(result.executionMs)}`
          : 'Code execution time: N/A'
      ].join('\n');

      const next = [
        statusBlock,
        result.stdout ? `[stdout]\n${result.stdout}` : '',
        result.stderr ? `[stderr]\n${result.stderr}` : ''
      ]
        .filter(Boolean)
        .join('\n\n');

      setOutput(next || 'No output');
    } catch (error) {
      setOutput(error.message || 'Network error');
      appendLog(`run failed: ${error.message || 'network error'}`);
    } finally {
      if (openingTimer) {
        window.clearInterval(openingTimer);
      }
      setRunning(false);
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
          <button type="button" className="run-btn" onClick={runCode} disabled={running}>
            {running ? 'Running...' : 'Run'}
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
              lineNumbersMinChars: 3
            }}
          />
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
