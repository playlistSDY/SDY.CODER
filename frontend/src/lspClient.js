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

const COMPLETION_KIND_MAP = {
  1: 'Text',
  2: 'Method',
  3: 'Function',
  4: 'Constructor',
  5: 'Field',
  6: 'Variable',
  7: 'Class',
  8: 'Interface',
  9: 'Module',
  10: 'Property',
  11: 'Unit',
  12: 'Value',
  13: 'Enum',
  14: 'Keyword',
  15: 'Snippet',
  16: 'Color',
  17: 'File',
  18: 'Reference',
  19: 'Folder',
  20: 'EnumMember',
  21: 'Constant',
  22: 'Struct',
  23: 'Event',
  24: 'Operator',
  25: 'TypeParameter'
};

const SUPPORTED_SEMANTIC_TOKEN_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator'
];

const SUPPORTED_SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary'
];

const TRANSPORT_NOISE_PATTERNS = [
  /^[IWE]\[\d{2}:\d{2}:\d{2}\.\d+\]/,
  /^<--/,
  /^-->/,
  /^PID:/,
  /^Features:/,
  /^Working directory:/,
  /^argv\[\d+\]:/,
  /^Starting LSP over stdin\/stdout$/,
  /^ASTWorker building file /,
  /^Auto-excluding /,
  /^Server root directory:/,
  /^Starting service instance /,
  /^Registered provider .*SLF4JServiceProvider/,
  /^Mar \d{2}, \d{4} /,
  /^\/usr\/bin\/clang\b/,
  /^\[\/.*\]$/
];

function isLowSignalRawLogLine(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line) {
    return true;
  }

  if (TRANSPORT_NOISE_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }

  if (/^INFO:\s+Registered provider .*SLF4JServiceProvider/i.test(line)) {
    return true;
  }

  if (/^Mar \d{1,2}, \d{4} /i.test(line)) {
    return true;
  }

  if (/^WARNING:\s+package\s+.+\s+not in java\.desktop$/i.test(line)) {
    return true;
  }

  if (/BadLocationException/i.test(line)) {
    return true;
  }

  if (/^\d{1,2}:\d{2}:\d{2}\.\d+\s+info:/i.test(line)) {
    return true;
  }

  if (/^initial server settings:/i.test(line)) {
    return true;
  }

  if (/^initializing,\s*csharp-ls version/i.test(line)) {
    return true;
  }

  if (/^csharp-ls is released under MIT license/i.test(line)) {
    return true;
  }

  if (/^SDK instances found, as reported by MSBuild:/i.test(line)) {
    return true;
  }

  if (/^MSBuildLocator:\s+will register/i.test(line)) {
    return true;
  }

  if (/^handleInitialize:\s+using workspaceFolders:/i.test(line)) {
    return true;
  }

  if (
    /^LogLevel\s*=/.test(line) ||
    /^ApplyFormattingOptions\s*=/.test(line) ||
    /^UseMetadataUris\s*=/.test(line) ||
    /^RazorSupport\s*=/.test(line) ||
    /^DebugMode\s*=/.test(line)
  ) {
    return true;
  }

  if (/^Will use MSBuild props:/i.test(line)) {
    return true;
  }

  if (/^\{\s*$/.test(line) || /^\}\s*$/.test(line) || /^"uri":/.test(line) || /^"name":/.test(line)) {
    return true;
  }

  if (/^[-]\s+SDK=/.test(line)) {
    return true;
  }

  return false;
}

const importSuggestionCache = new Map();

async function fetchImportSuggestions(language, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, value);
    }
  });
  const cacheKey = `${language}?${params.toString()}`;

  if (importSuggestionCache.has(cacheKey)) {
    return importSuggestionCache.get(cacheKey);
  }

  const promise = fetch(`/api/import-packages/${language}${params.size ? `?${params.toString()}` : ''}`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Failed to load import suggestions');
      }
      const payload = await response.json();
      return Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.packages)
          ? payload.packages
          : [];
    })
    .catch(() => [])
    .then((items) => {
      importSuggestionCache.set(cacheKey, items);
      return items;
    });

  importSuggestionCache.set(cacheKey, promise);
  return promise;
}

function getImportSuggestionContext(language, model, position) {
  const line = model.getLineContent(position.lineNumber);
  const beforeCursor = line.slice(0, position.column - 1);

  if (language === 'python') {
    let match = beforeCursor.match(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+([A-Za-z0-9_]*)$/);
    if (match) {
      return { mode: 'python-members', moduleName: match[1], prefix: match[2] || '' };
    }
    match = beforeCursor.match(/^\s*import\s+([A-Za-z0-9_\.]*)$/);
    if (match) {
      return { mode: 'packages', prefix: match[1] || '' };
    }
    match = beforeCursor.match(/^\s*from\s+([A-Za-z0-9_\.]*)$/);
    if (match) {
      return { mode: 'packages', prefix: match[1] || '' };
    }
    return null;
  }

  if (language === 'nodejs') {
    const match = beforeCursor.match(/(?:from\s+['"]|require\(\s*['"])([^'"]*)$/);
    if (match) {
      return { mode: 'packages', prefix: match[1] || '' };
    }
    return null;
  }

  if (language === 'go') {
    let match = beforeCursor.match(/^\s*import\s+"([^"]*)$/);
    if (match) {
      return { mode: 'packages', prefix: match[1] || '' };
    }
    match = beforeCursor.match(/^\s*"([^"]*)$/);
    if (match) {
      return { mode: 'packages', prefix: match[1] || '' };
    }
    return null;
  }

  if (language === 'java') {
    const match = beforeCursor.match(/^\s*import\s+([A-Za-z0-9_\.]*)$/);
    if (match) {
      return { mode: 'packages', prefix: match[1] || '' };
    }
    return null;
  }

  if (language === 'csharp') {
    const match = beforeCursor.match(/^\s*using\s+([A-Za-z0-9_\.]*)$/);
    if (match) {
      return { mode: 'packages', prefix: match[1] || '' };
    }
    return null;
  }

  return null;
}

function buildImportSuggestions(monaco, packages, prefix, position) {
  const startColumn = Math.max(1, position.column - prefix.length);
  const loweredPrefix = prefix.toLowerCase();

  return packages
    .filter((name) => !loweredPrefix || name.toLowerCase().startsWith(loweredPrefix))
    .slice(0, 200)
    .map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: name,
      range: {
        startLineNumber: position.lineNumber,
        startColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      }
    }));
}

function toMonacoRange(monaco, range) {
  if (!range?.start || !range?.end) {
    return undefined;
  }
  return {
    startLineNumber: (range.start.line ?? 0) + 1,
    startColumn: (range.start.character ?? 0) + 1,
    endLineNumber: (range.end.line ?? 0) + 1,
    endColumn: (range.end.character ?? 0) + 1
  };
}

function normalizeSnippetInsertText(language, insertText) {
  if (typeof insertText !== 'string') {
    return insertText;
  }

  // clangd often sends human-readable placeholder labels like
  // `${1:condition}` and `${0:statements}`. VS Code keeps snippet tabstops,
  // but the visible defaults feel noisy in this UI, so strip the labels for C/C++.
  if (language === 'c' || language === 'cpp') {
    return insertText.replace(/\$\{(\d+):[^}]*\}/g, '${$1}');
  }

  return insertText;
}

function simplifyLspServerMessage(raw, language) {
  let line = String(raw || '').trim();
  if (!line) {
    return null;
  }

  line = line.replace(/^[IWE]\[\d{2}:\d{2}:\d{2}\.\d+\]\s+/, '');
  if (!line) {
    return null;
  }

  if (TRANSPORT_NOISE_PATTERNS.some((pattern) => pattern.test(line))) {
    return null;
  }

  let match = line.match(/^Pyright language server ([0-9.]+) starting$/);
  if (match) {
    return `  server: pyright ${match[1]}`;
  }

  match = line.match(/^basedpyright language server ([0-9.]+) starting$/i);
  if (match) {
    return `  server: basedpyright ${match[1]}`;
  }

  match = line.match(/^pylsp v?([0-9.]+)$/i);
  if (match) {
    return `  server: pylsp ${match[1]}`;
  }

  match = line.match(/^initializing,\s*csharp-ls version\s+(.+)$/i);
  if (match) {
    return `  server: csharp-ls ${match[1]}`;
  }

  match = line.match(/^(?:Debian\s+)?clangd version (.+)$/i);
  if (match) {
    return `  server: clangd ${match[1]}`;
  }

  match = line.match(/^Assuming Python version (.+)$/);
  if (match) {
    return `  python runtime: ${match[1]}`;
  }

  match = line.match(/^No include entries specified; assuming (.+)$/);
  if (match) {
    return `  workspace: ${match[1]}`;
  }

  match = line.match(/^Found (\d+) source file/);
  if (match) {
    return `  workspace: ${match[1]} source file(s) indexed`;
  }

  match = line.match(/^File or directory "(.+)" does not exist\.$/);
  if (match) {
    return `  warning: workspace path not found (${match[1]})`;
  }

  if (line.startsWith('No LSP server found for ')) {
    return `  error: ${line}`;
  }

  if (line === 'No source files found.') {
    return '  warning: no source files found';
  }

  if (line.startsWith('Failed to find compilation database for ')) {
    return null;
  }

  if (/^WARNING:\s+package\s+.+\s+not in java\.desktop$/i.test(line)) {
    return null;
  }

  if (/BadLocationException/i.test(line)) {
    return null;
  }

  if (line.includes('no or .csproj/.fsproj or sln files found on')) {
    return '  error: csharp-ls needs a .csproj/.sln workspace';
  }

  if (/^INFO:/.test(line)) {
    return null;
  }

  if (/^\s*at\s+/.test(line)) {
    return null;
  }

  if (/^caused by:/i.test(line)) {
    return `  error: ${line}`;
  }

  if (/exception/i.test(line)) {
    return `  error: ${line}`;
  }

  if (/\berror\b/i.test(line)) {
    return `  error: ${line}`;
  }

  if (/warn/i.test(line)) {
    return `  warning: ${line}`;
  }

  return null;
}

export class LSPClient {
  constructor({
    monaco,
    language,
    languageId = language,
    model,
    onLog,
    isActive = () => true,
    workspaceUri = 'file:///tmp/web-vscode-workspace'
  }) {
    this.monaco = monaco;
    this.language = language;
    this.languageId = languageId;
    this.model = model;
    this.onLog = onLog;
    this.isActive = isActive;
    this.workspaceUri = workspaceUri.replace(/\/+$/, '');

    this.socket = null;
    this.pending = new Map();
    this.requestId = 0;
    this.docVersion = 1;
    this.disposables = [];
    this.isReady = false;
    this.providersRegistered = false;
    this.manuallyStopped = false;
    this.disconnectHandled = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectTimer = null;
    this.lastLogLine = '';
    this.lastLogAt = 0;
    this.semanticTokensEmitter = new this.monaco.Emitter();

    const fileName = FILE_NAME_BY_LANG[language] || `main.${EXT_BY_LANG[language]}`;
    this.uri = `${this.workspaceUri}/${fileName}`;
    this.disposables.push(this.semanticTokensEmitter);
  }

  start() {
    this.manuallyStopped = false;
    this.connect();
  }

  connect() {
    if (!this.isActive()) {
      return;
    }
    this.disconnectHandled = false;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/lsp/${this.language}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = async () => {
      if (!this.isActive()) {
        this.manuallyStopped = true;
        this.socket?.close();
        return;
      }
      this.clearReconnectTimer();
      this.reconnectAttempts = 0;
      this.log(`${this.language} lsp connected`);

      try {
        const initializeResult = await this.sendRequest('initialize', {
          processId: null,
          rootUri: this.workspaceUri,
          workspaceFolders: [{ uri: this.workspaceUri, name: 'workspace' }],
          capabilities: {
            textDocument: {
              publishDiagnostics: { relatedInformation: true },
              completion: {
                completionItem: {
                  snippetSupport: true,
                  documentationFormat: ['markdown', 'plaintext']
                }
              },
              hover: {
                contentFormat: ['markdown', 'plaintext']
              },
              semanticTokens: {
                dynamicRegistration: false,
                tokenTypes: SUPPORTED_SEMANTIC_TOKEN_TYPES,
                tokenModifiers: SUPPORTED_SEMANTIC_TOKEN_MODIFIERS,
                formats: ['relative'],
                requests: {
                  full: true
                },
                multilineTokenSupport: true,
                overlappingTokenSupport: false
              }
            },
            workspace: {
              configuration: true
            }
          },
          initializationOptions: {}
        });

        this.sendNotification('initialized', {});
        this.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: this.uri,
            languageId: this.languageId,
            version: this.docVersion,
            text: this.model.getValue()
          }
        });
        if (!this.isActive()) {
          this.manuallyStopped = true;
          this.socket?.close();
          return;
        }
        this.isReady = true;
        if (!this.providersRegistered) {
          this.registerProviders(initializeResult?.capabilities || {});
          this.providersRegistered = true;
        }
      } catch (error) {
        this.log(`${this.language} lsp initialize failed`);
        this.handleDisconnect();
      }
    };

    this.socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      this.handleMessage(msg);
    };

    this.socket.onclose = () => {
      this.log(`${this.language} lsp disconnected`);
      this.handleDisconnect();
    };

    this.socket.onerror = () => {
      this.log(`${this.language} lsp socket error`);
    };

    if (!this.changeDisposable) {
      this.changeDisposable = this.model.onDidChangeContent(() => {
        if (!this.isReady) {
          return;
        }
        this.docVersion += 1;
        this.sendNotification('textDocument/didChange', {
          textDocument: {
            uri: this.uri,
            version: this.docVersion
          },
          contentChanges: [{ text: this.model.getValue() }]
        });
      });

      this.disposables.push(this.changeDisposable);
    }
  }

  async stop() {
    this.manuallyStopped = true;
    this.clearReconnectTimer();

    if (this.isReady) {
      this.sendNotification('textDocument/didClose', {
        textDocument: { uri: this.uri }
      });
      try {
        await this.sendRequest('shutdown', null);
      } catch {
        // Ignore shutdown failures while closing.
      }
      this.sendNotification('exit');
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }

    this.dispose();
  }

  handleDisconnect() {
    if (this.disconnectHandled) {
      return;
    }
    this.disconnectHandled = true;
    this.isReady = false;
    this.pending.forEach(({ reject }) => reject(new Error('LSP disconnected')));
    this.pending.clear();

    if (this.manuallyStopped || !this.isActive()) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log(`${this.language} lsp reconnect failed after 3 attempts`);
      return;
    }

    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    this.log(`${this.language} lsp reconnecting (${attempt}/3)`);
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manuallyStopped || !this.isActive()) {
        return;
      }
      this.connect();
    }, 1000 * attempt);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  dispose() {
    this.pending.forEach(({ reject }) => reject(new Error('LSP disconnected')));
    this.pending.clear();
    this.clearReconnectTimer();
    this.monaco.editor.setModelMarkers(this.model, 'lsp', []);
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.isReady = false;
  }

  log(message) {
    const next = String(message || '').trimEnd();
    if (!next) {
      return;
    }

    const now = Date.now();
    if (next === this.lastLogLine && now - this.lastLogAt < 2000) {
      return;
    }

    this.lastLogLine = next;
    this.lastLogAt = now;
    if (this.onLog) {
      this.onLog(next);
    }
  }

  sendNotification(method, params = null) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = { jsonrpc: '2.0', method };
    if (params !== null) {
      payload.params = params;
    }
    this.socket.send(JSON.stringify(payload));
  }

  sendResponse(id, result = null) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result
      })
    );
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('Socket not open'));
        return;
      }

      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params
        })
      );
    });
  }

  handleMessage(msg) {
    if (typeof msg.id !== 'undefined' && !msg.method) {
      const pending = this.pending.get(msg.id);
      if (!pending) {
        return;
      }
      this.pending.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(msg.error.message || 'LSP error'));
        return;
      }
      pending.resolve(msg.result);
      return;
    }

    if (!msg.method) {
      return;
    }

    if (typeof msg.id !== 'undefined') {
      this.handleServerRequest(msg);
      return;
    }

    if (msg.method === 'textDocument/publishDiagnostics') {
      this.applyDiagnostics(msg.params?.diagnostics || []);
      return;
    }

    if (msg.method === 'workspace/semanticTokens/refresh') {
      this.semanticTokensEmitter.fire();
      return;
    }

    if (msg.method === 'window/logMessage') {
      const rawText = msg.params?.message ?? '';
      const logType = Number(msg.params?.type ?? 3);
      const rawLines = String(rawText)
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);
      const lines = String(rawText)
        .split(/\r?\n/g)
        .map((line) => simplifyLspServerMessage(line, this.language))
        .filter(Boolean);
      if (lines.length > 0) {
        lines.forEach((line) => this.log(line));
        return;
      }

      // Only surface raw errors; warnings are shown only when simplified to user-friendly text.
      if (rawLines.length > 0 && logType === 1) {
        const prefix = '  error:';
        rawLines
          .filter((line) => !isLowSignalRawLogLine(line))
          .forEach((line) => this.log(`${prefix} ${line}`));
      }
    }
  }

  handleServerRequest(msg) {
    switch (msg.method) {
      case 'workspace/configuration':
        this.sendResponse(msg.id, []);
        break;
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/workDoneProgress/create':
        this.sendResponse(msg.id, null);
        break;
      default:
        this.sendResponse(msg.id, null);
        break;
    }
  }

  applyDiagnostics(diagnostics) {
    const severityMap = {
      1: this.monaco.MarkerSeverity.Error,
      2: this.monaco.MarkerSeverity.Warning,
      3: this.monaco.MarkerSeverity.Info,
      4: this.monaco.MarkerSeverity.Hint
    };

    const markers = diagnostics.map((d) => {
      const startLineNumber = (d.range?.start?.line ?? 0) + 1;
      const startColumn = (d.range?.start?.character ?? 0) + 1;
      const endLineNumber = (d.range?.end?.line ?? 0) + 1;
      const endColumn = (d.range?.end?.character ?? 0) + 1;

      return {
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
        severity: severityMap[d.severity] || this.monaco.MarkerSeverity.Info,
        message: d.message || 'Unknown diagnostic',
        source: d.source || 'lsp'
      };
    });

    this.monaco.editor.setModelMarkers(this.model, 'lsp', markers);
  }

  registerProviders(capabilities = {}) {
    const importCompletionDisposable = this.monaco.languages.registerCompletionItemProvider(
      this.languageId,
      {
        triggerCharacters: ['"', "'", '.', '/'],
        provideCompletionItems: async (model, position) => {
          if (model !== this.model) {
            return { suggestions: [] };
          }

          const context = getImportSuggestionContext(this.language, model, position);
          if (!context) {
            return { suggestions: [] };
          }

          const packages = await fetchImportSuggestions(this.language, {
            mode: context.mode,
            module: context.moduleName
          });
          return {
            suggestions: buildImportSuggestions(
              this.monaco,
              packages,
              context.prefix,
              position
            )
          };
        }
      }
    );

    const completionDisposable = this.monaco.languages.registerCompletionItemProvider(this.languageId, {
      triggerCharacters: ['.', '>', ':'],
      provideCompletionItems: async (model, position) => {
        if (model !== this.model || !this.isReady) {
          return { suggestions: [] };
        }

        try {
          const response = await this.sendRequest('textDocument/completion', {
            textDocument: { uri: this.uri },
            position: {
              line: position.lineNumber - 1,
              character: position.column - 1
            },
            context: { triggerKind: 1 }
          });

          const items = Array.isArray(response) ? response : response?.items ?? [];

          return {
            suggestions: items.map((item) => {
              const textEdit = item.textEdit?.newText ? item.textEdit : null;
              const insertText = normalizeSnippetInsertText(
                this.language,
                textEdit?.newText || item.insertText || item.label
              );
              const insertTextFormat = item.insertTextFormat === 2
                ? this.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined;

              return {
                label: item.label,
                kind:
                  this.monaco.languages.CompletionItemKind[
                    COMPLETION_KIND_MAP[item.kind] || 'Text'
                  ],
                detail: item.detail,
                documentation:
                  typeof item.documentation === 'string'
                    ? item.documentation
                    : item.documentation?.value,
                insertText,
                insertTextRules: insertTextFormat,
                range: toMonacoRange(this.monaco, textEdit?.range)
              };
            })
          };
        } catch {
          return { suggestions: [] };
        }
      }
    });

    const hoverDisposable = this.monaco.languages.registerHoverProvider(this.languageId, {
      provideHover: async (model, position) => {
        if (model !== this.model || !this.isReady) {
          return null;
        }

        try {
          const hover = await this.sendRequest('textDocument/hover', {
            textDocument: { uri: this.uri },
            position: {
              line: position.lineNumber - 1,
              character: position.column - 1
            }
          });

          if (!hover?.contents) {
            return null;
          }

          const asArray = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
          const value = asArray
            .map((entry) => {
              if (typeof entry === 'string') {
                return entry;
              }
              if (entry?.value) {
                return entry.value;
              }
              return '';
            })
            .filter(Boolean)
            .join('\n\n');

          if (!value) {
            return null;
          }

          return {
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column + 1
            },
            contents: [{ value }]
          };
        } catch {
          return null;
        }
      }
    });

    this.disposables.push(importCompletionDisposable, completionDisposable, hoverDisposable);

    const semanticProvider = capabilities.semanticTokensProvider;
    const legend = semanticProvider?.legend;
    const tokenTypes = legend?.tokenTypes;
    const tokenModifiers = legend?.tokenModifiers;

    if (Array.isArray(tokenTypes) && Array.isArray(tokenModifiers)) {
      const semanticTokensDisposable = this.monaco.languages.registerDocumentSemanticTokensProvider(
        this.languageId,
        {
          onDidChange: this.semanticTokensEmitter.event,
          getLegend: () => ({
            tokenTypes,
            tokenModifiers
          }),
          provideDocumentSemanticTokens: async (model) => {
            if (model !== this.model || !this.isReady) {
              return { data: new Uint32Array() };
            }

            try {
              const tokens = await this.sendRequest('textDocument/semanticTokens/full', {
                textDocument: { uri: this.uri }
              });

              const data = Array.isArray(tokens?.data) ? tokens.data : [];
              return {
                resultId: tokens?.resultId,
                data: new Uint32Array(data)
              };
            } catch {
              return { data: new Uint32Array() };
            }
          },
          releaseDocumentSemanticTokens: () => {}
        }
      );

      this.disposables.push(semanticTokensDisposable);
      this.log('  semantic highlighting: enabled');
    }
  }
}
