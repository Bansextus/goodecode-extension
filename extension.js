const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");
const http = require("http");
const https = require("https");
const YAML = require("yaml");

const DOWNLOAD_URL = "https://github.com/Bansextus/Goodebot-Downloads/releases";
const RELEASES_API_URL = "https://api.github.com/repos/Bansextus/Goodebot-Downloads/releases";
const REPO_URL = "https://github.com/Bansextus/Goodebot";
const DISCUSSIONS_URL = "https://github.com/Bansextus/Goodebot/discussions";
const GOODEBOT_DESTINATION_APP = path.join(os.homedir(), "Applications", "Goodebot.app");
const GOODEBOT_APP_SUPPORT_ROOT = path.join(os.homedir(), "Library", "Application Support", "Goodebot");
const GOODEBOT_UPDATE_BACKUP_ROOT = path.join(GOODEBOT_APP_SUPPORT_ROOT, "updates", "backups");
const GOODEBOT_APP_NAMES = ["Goodebot.app"];
const GOODEBOT_INSTALLER_NAMES = ["Goodebot Installer.app"];
const GOODEBOT_LOCAL_REPO = path.join(os.homedir(), "Documents", "GitHub", "Goodebot");
const GOODEBOT_DOWNLOAD_REPO = path.join(os.homedir(), "Documents", "GitHub", "Goodebot-Downloads");
const GOODEBOT_BUILD_ASSET_NAMES = ["Goodebot-macOS.zip", "Goodebot-beta-macOS.zip"];
const GOODEBOT_APP_SCAN_ROOTS = [
  path.join(os.homedir(), "Applications"),
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Documents"),
  path.join(os.homedir(), "Downloads"),
  path.join(os.homedir(), "Library", "CloudStorage"),
  path.join(os.homedir(), "Library", "Mobile Documents"),
  path.join(os.homedir(), "GoodebotDevBuilds"),
  "/Applications",
  "/Users/Shared",
  "/Volumes",
  GOODEBOT_LOCAL_REPO,
  GOODEBOT_DOWNLOAD_REPO,
];
const GOODEBOT_PROFILE_SCAN_ROOTS = [
  path.join(os.homedir(), "Applications"),
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Documents"),
  path.join(os.homedir(), "Downloads"),
  path.join(os.homedir(), "GoodebotDevBuilds"),
  "/Users/Shared",
  "/Applications",
];
const GOODEBOT_PROFILE_SCHEMA_VERSION = 2;
const GOODECODE_CONFIG_DIR = ".goodecode";
const GOODECODE_RUNTIME_DIR = "runtime";
const GOODECODE_RUNTIME_FILE_NAME = "goodebot_runtime.txt";
const INSTALL_PAGE_FILE_NAME = "goodebot-install-page.yaml";
const BUNDLED_INSTALL_PAGE_PATH = path.join(__dirname, "content", INSTALL_PAGE_FILE_NAME);
const SYNTAX_GUIDE_FILE_NAME = "goodecode-syntax-guide.md";
const BUNDLED_SYNTAX_GUIDE_PATH = path.join(__dirname, "content", SYNTAX_GUIDE_FILE_NAME);
const PYTHON_EXTENSION_ID = "ms-python.python";
const PYLANCE_EXTENSION_ID = "ms-python.vscode-pylance";
const PYTHON_DOWNLOAD_URL = "https://www.python.org/downloads/";
const STUDIO_STATE_CACHE_MS = 2500;
const GOODECODE_FILE_SCAN_BUDGET_MS = 35;

let pythonSupportPrompted = false;
let cachedPythonCommand = undefined;
let cachedPythonCommandAt = 0;
let cachedStudioState = undefined;
let cachedStudioStateKey = "";
let cachedStudioStateAt = 0;

class GoodecodeSidebarProvider {
  static viewType = "goodecode.sidebar";

  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = undefined;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message?.type) {
        case "openStudio":
          GoodecodeStudioPanel.createOrShow(this.extensionUri);
          return;
        case "createStarterFiles":
          await createStarterFiles();
          this.refresh();
          return;
        case "createScreenTemplate":
          await createScreenTemplate();
          this.refresh();
          return;
        case "createSingleScriptTemplate":
          await createSingleScriptTemplate();
          this.refresh();
          return;
        case "convertForGoodebot":
          await buildForGoodebot({ revealRuntimeFile: false });
          this.refresh();
          return;
        case "openFile":
          if (typeof message.path === "string" && message.path) {
            await openFile(message.path);
          }
          return;
        case "insertSnippet":
          if (typeof message.code === "string") {
            await insertSnippetIntoActiveEditor(message.code);
          }
          return;
        case "refresh":
          this.refresh();
          return;
        default:
          return;
      }
    });

    this.refresh();
  }

  refresh() {
    if (!this.view) {
      return;
    }
    this.view.webview.html = renderSidebarHtml(this.view.webview, this.extensionUri);
  }
}

class GoodecodeStudioPanel {
  static currentPanel = undefined;
  static viewType = "goodecode.studio";

  static createOrShow(extensionUri) {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (GoodecodeStudioPanel.currentPanel) {
      GoodecodeStudioPanel.currentPanel.panel.reveal(column);
      GoodecodeStudioPanel.currentPanel.refresh();
      return GoodecodeStudioPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      GoodecodeStudioPanel.viewType,
      "Goodecode Studio",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    GoodecodeStudioPanel.currentPanel = new GoodecodeStudioPanel(panel, extensionUri);
    return GoodecodeStudioPanel.currentPanel;
  }

  static refreshCurrent() {
    if (GoodecodeStudioPanel.currentPanel) {
      GoodecodeStudioPanel.currentPanel.refresh();
    }
  }

  constructor(panel, extensionUri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    panel.onDidDispose(() => {
      if (GoodecodeStudioPanel.currentPanel === this) {
        GoodecodeStudioPanel.currentPanel = undefined;
      }
    });

    panel.webview.onDidReceiveMessage(async (message) => {
      await handleStudioMessage(message, this);
    });

    this.refresh();
  }

  refresh() {
    this.panel.webview.html = renderStudioHtml(this.panel.webview, this.extensionUri);
  }
}

function isConvertableGoodecodeDocument(document) {
  if (!document || document.uri.scheme !== "file") {
    return false;
  }

  const filePath = document.uri.fsPath;
  const fileName = path.basename(filePath).toLowerCase();
  return fileName.endsWith(".goode.py") || (document.languageId === "goodecode" && fileName.endsWith(".py"));
}

function refreshGoodecodeEditorContext(editor = vscode.window.activeTextEditor) {
  const enabled = isConvertableGoodecodeDocument(editor?.document);
  return vscode.commands.executeCommand("setContext", "goodecode.canConvertForGoodebot", enabled);
}

function clearStudioStateCache() {
  cachedStudioState = undefined;
  cachedStudioStateKey = "";
  cachedStudioStateAt = 0;
}

function detectPythonCommand() {
  const now = Date.now();
  if (cachedPythonCommand !== undefined && now - cachedPythonCommandAt < 30000) {
    return cachedPythonCommand;
  }

  const candidates = ["python3", "python"];
  for (const command of candidates) {
    try {
      childProcess.execFileSync(command, ["--version"], { stdio: "ignore", timeout: 350 });
      cachedPythonCommand = command;
      cachedPythonCommandAt = now;
      return cachedPythonCommand;
    } catch {
      continue;
    }
  }
  cachedPythonCommand = "";
  cachedPythonCommandAt = now;
  return cachedPythonCommand;
}

function essentialGoodecodeSnippets() {
  return [
    {
      id: "lifecycle",
      title: "Lifecycle",
      code: `from typing import Any


def initialize(ctx: Any) -> None:
    ctx.project_title("My Robot")
    ctx.status("Ready")
    ctx.use_brain_icon("goodecode")


def autonomous(ctx: Any) -> None:
    ctx.status("Autonomous")


def opcontrol(ctx: Any) -> None:
    while ctx.enabled():
        ctx.sleep_ms(20)
`,
    },
    {
      id: "drive",
      title: "Drive Loop",
      code: `while ctx.enabled():
    left = ctx.axis3()
    right = ctx.axis2()
    ctx.drive_tank(left, right)
    ctx.sleep_ms(20)
`,
    },
    {
      id: "turn",
      title: "Turn Step",
      code: `def turn_right(ctx: Any, degrees: float = 90) -> None:
    ctx.status(f"Turn right {degrees} deg")
    ctx.turn_right(degrees)
`,
    },
    {
      id: "screen",
      title: "Info Screen",
      code: `def build_info_screen(ctx):
    ctx.title("My Robot")
    ctx.info("Goodecode")
    ctx.hardware_status()
`,
    },
  ];
}

async function ensurePythonSupportInstalled() {
  if (pythonSupportPrompted) {
    return;
  }
  pythonSupportPrompted = true;

  if (!vscode.extensions.getExtension(PYTHON_EXTENSION_ID)) {
    const choice = await vscode.window.showInformationMessage(
      "Goodecode works best with the VS Code Python extension.",
      "Install Python Extension",
      "Not Now"
    );
    if (choice === "Install Python Extension") {
      await vscode.commands.executeCommand("workbench.extensions.installExtension", PYTHON_EXTENSION_ID);
      await vscode.commands.executeCommand("workbench.extensions.installExtension", PYLANCE_EXTENSION_ID);
    }
  }

  if (!detectPythonCommand()) {
    const choice = await vscode.window.showWarningMessage(
      "Python is not installed on this Mac yet. Goodecode can still scaffold files, but Python tooling will stay limited until Python is installed.",
      "Open Python Download",
      "Not Now"
    );
    if (choice === "Open Python Download") {
      await vscode.env.openExternal(vscode.Uri.parse(PYTHON_DOWNLOAD_URL));
    }
  }
}

function activate(context) {
  const provider = new GoodecodeSidebarProvider(context.extensionUri);

  const refreshAll = () => {
    clearStudioStateCache();
    provider.refresh();
    GoodecodeStudioPanel.refreshCurrent();
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(GoodecodeSidebarProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("goodecode.openStudio", () => {
      GoodecodeStudioPanel.createOrShow(context.extensionUri);
    }),
    vscode.commands.registerCommand("goodecode.refreshSidebar", refreshAll),
    vscode.commands.registerCommand("goodecode.installGoodebot", async () => {
      await installGoodebotForMac();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.reinstallGoodebot", async () => {
      await reinstallGoodebotForMac();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.updateGoodebot", async () => {
      await updateGoodebotForMac();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.openGoodebot", async () => {
      await openInstalledGoodebot();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.openGoodebotDownload", async () => {
      await vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
    }),
    vscode.commands.registerCommand("goodecode.openWorkspaceFolder", async () => {
      await openWorkspaceFolderInOS();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.createStarterFiles", async () => {
      await createStarterFiles();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.openSyntaxGuidePreview", async () => {
      await openSyntaxGuidePreview(false);
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.createScreenTemplate", async () => {
      await createScreenTemplate();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.createSingleScriptTemplate", async () => {
      await createSingleScriptTemplate();
      refreshAll();
    }),
    vscode.commands.registerCommand("goodecode.convertForGoodebot", async () => {
      await buildForGoodebot({ revealRuntimeFile: false });
      refreshAll();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll),
    vscode.workspace.onDidSaveTextDocument(refreshAll),
    vscode.workspace.onDidDeleteFiles(refreshAll),
    vscode.workspace.onDidCreateFiles(refreshAll),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      refreshGoodecodeEditorContext(editor);
      refreshAll();
    })
  );

  refreshGoodecodeEditorContext();
  void ensurePythonSupportInstalled();
}

function deactivate() {}

async function handleStudioMessage(message, panelInstance) {
  switch (message?.type) {
    case "refresh":
      panelInstance.refresh();
      return;
    case "installGoodebot":
      await installGoodebotForMac();
      panelInstance.refresh();
      return;
    case "openGoodebot":
      await openInstalledGoodebot();
      panelInstance.refresh();
      return;
    case "reinstallGoodebot":
      await reinstallGoodebotForMac();
      panelInstance.refresh();
      return;
    case "updateGoodebot":
      await updateGoodebotForMac();
      panelInstance.refresh();
      return;
    case "openDownload":
      await vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
      return;
    case "openRepo":
      await vscode.env.openExternal(vscode.Uri.parse(REPO_URL));
      return;
    case "openDiscussions":
      await vscode.env.openExternal(vscode.Uri.parse(DISCUSSIONS_URL));
      return;
    case "openWorkspaceFolder":
      await openWorkspaceFolderInOS();
      panelInstance.refresh();
      return;
    case "createStarterFiles":
      await createStarterFiles();
      panelInstance.refresh();
      return;
    case "openSyntaxGuidePreview":
      await openSyntaxGuidePreview(false);
      panelInstance.refresh();
      return;
    case "createScreenTemplate":
      await createScreenTemplate();
      panelInstance.refresh();
      return;
    case "convertForGoodebot":
      await buildForGoodebot({ revealRuntimeFile: false });
      panelInstance.refresh();
      return;
    case "createSingleScriptTemplate":
      await createSingleScriptTemplate();
      panelInstance.refresh();
      return;
    case "insertSnippet":
      if (typeof message.code === "string") {
        await insertSnippetIntoActiveEditor(message.code);
      }
      panelInstance.refresh();
      return;
    case "openFile":
      if (typeof message.path === "string") {
        await openFile(message.path);
      }
      panelInstance.refresh();
      return;
    default:
      return;
  }
}

function renderSidebarHtml(webview, extensionUri) {
  const nonce = createNonce();
  const state = collectStudioState();
  const iconUri = imageDataUri(path.join(__dirname, "media", "goodecode-icon.png"), "image/png");
  const hasWorkspace = Boolean(state.workspaceRoot);
  const workspaceStatus = hasWorkspace ? state.workspaceName : "No folder open";
  const fileStatus = state.workspaceRoot
    ? `${state.goodecodeFiles.length} file${state.goodecodeFiles.length === 1 ? "" : "s"}`
    : "Open a folder";
  const canBuild = state.goodecodeFiles.length > 0;
  const snippetsMarkup = state.activeGoodecodeFile
    ? essentialGoodecodeSnippets()
        .map(
          (snippet) => `
            <div class="snippet" draggable="true" data-code="${escapeAttribute(snippet.code)}">
              <div class="snippet-top">
                <strong>${escapeHtml(snippet.title)}</strong>
                <button class="tiny" data-command="insertSnippet" data-code="${escapeAttribute(snippet.code)}">Insert</button>
              </div>
              <pre>${escapeHtml(snippet.code)}</pre>
            </div>
          `
        )
        .join("")
    : `<div class="hint">Open a <code>.goode.py</code> file to insert snippets.</div>`;
  const fileButtons = state.goodecodeFiles.length
    ? state.goodecodeFiles
        .map(
          (filePath) => `
            <button class="file-button secondary" data-command="openFile" data-path="${escapeAttribute(filePath)}">
              <span class="file-name">${escapeHtml(path.basename(filePath))}</span>
              <span class="file-path">${escapeHtml(toDisplayPath(filePath, state.workspaceRoot))}</span>
            </button>
          `
        )
        .join("")
    : `<div class="hint">Create a Goodecode file to start building.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Goodecode</title>
    <style>
      body {
        margin: 0;
        padding: 14px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: linear-gradient(180deg, #0a1724 0%, #16304a 100%);
      }
      .card {
        border-radius: 20px;
        padding: 16px;
        display: grid;
        gap: 12px;
        background: linear-gradient(180deg, rgba(11, 22, 36, 0.96) 0%, rgba(8, 18, 30, 0.94) 100%);
        border: 1px solid rgba(78, 215, 255, 0.18);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.26);
      }
      .top {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .icon-shell {
        width: 46px;
        height: 46px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: rgba(8, 16, 27, 0.92);
        border: 1px solid rgba(120, 166, 194, 0.22);
      }
      .icon {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        border-radius: inherit;
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #a9cfe3;
      }
      h1, p {
        margin: 0;
      }
      h1 {
        font-size: 20px;
        line-height: 1.05;
      }
      p {
        color: #c8d6e4;
        line-height: 1.45;
      }
      .meta {
        display: grid;
        gap: 10px;
      }
      .meta-row {
        display: grid;
        gap: 4px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .meta-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #a9cfe3;
      }
      .meta-value {
        color: #eff5fb;
        font-size: 13px;
        font-weight: 700;
        line-height: 1.35;
      }
      .button-row {
        display: grid;
        gap: 8px;
      }
      .button-grid {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .chip-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .chip {
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-size: 12px;
        color: #d7e3ee;
      }
      details {
        display: grid;
        gap: 8px;
      }
      .section {
        display: grid;
        gap: 10px;
      }
      .section-title {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9eb3c7;
      }
      summary {
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9eb3c7;
      }
      .snippet-list {
        display: grid;
        gap: 8px;
      }
      .snippet {
        display: grid;
        gap: 8px;
        padding: 10px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .snippet-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .snippet pre {
        margin: 0;
        white-space: pre-wrap;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 11px;
        line-height: 1.45;
        color: #d9e7f1;
      }
      .tiny {
        padding: 7px 10px;
        font-size: 11px;
        border-radius: 10px;
      }
      .hint {
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        color: #c8d6e4;
        line-height: 1.4;
      }
      code {
        font-family: var(--vscode-editor-font-family, monospace);
      }
      button {
        border: none;
        border-radius: 12px;
        padding: 11px 12px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        color: #08101b;
        background: linear-gradient(180deg, #f8cb5f 0%, #e5b94d 100%);
      }
      button.secondary {
        color: #eff5fb;
        background: rgba(255, 255, 255, 0.08);
      }
      .file-list {
        display: grid;
        gap: 8px;
      }
      .file-button {
        display: grid;
        gap: 2px;
        text-align: left;
      }
      .file-name {
        font-weight: 700;
      }
      .file-path {
        font-size: 11px;
        color: #c3d2df;
        line-height: 1.35;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="top">
        <div class="icon-shell">
          <img class="icon" src="${escapeAttribute(iconUri)}" alt="" />
        </div>
        <div>
          <div class="eyebrow">Goodecode</div>
          <h1>Quick Actions</h1>
        </div>
      </div>
      <p>Open, build, and edit without leaving the sidebar.</p>
      <div class="meta">
        <div class="meta-row">
          <span class="meta-label">Workspace</span>
          <span class="meta-value">${escapeHtml(workspaceStatus)}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Files</span>
          <span class="meta-value">${escapeHtml(fileStatus)}</span>
        </div>
      </div>
      <div class="chip-row">
        <span class="chip">${state.pythonExtensionInstalled ? "Python ext ready" : "Install Python ext"}</span>
        <span class="chip">${state.pythonCommand ? `${escapeHtml(state.pythonCommand)} ready` : "Install Python"}</span>
      </div>
      <div class="section">
        <div class="section-title">Run</div>
        <div class="button-row">
          <button data-command="openStudio">Open Goodecode</button>
          ${canBuild ? '<button data-command="convertForGoodebot">Build Project</button>' : ""}
          <button class="secondary" data-command="refresh">Refresh</button>
        </div>
      </div>
      ${hasWorkspace ? `
        <div class="section">
          <div class="section-title">Start</div>
          <div class="button-row">
            <button data-command="createStarterFiles">Make Python File</button>
            <button class="secondary" data-command="createSingleScriptTemplate">One-Script File</button>
          </div>
        </div>
      ` : `
        <div class="hint">Open a workspace folder to create Goodecode Python files.</div>
      `}
      ${state.goodecodeFiles.length ? `
        <div class="section">
          <div class="section-title">Open Files</div>
          <div class="file-list">
            ${fileButtons}
          </div>
        </div>
      ` : ""}
      <details open>
        <summary>Snippets</summary>
        <div class="snippet-list">
          ${snippetsMarkup}
        </div>
      </details>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll("button[data-command]").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({
            type: button.dataset.command,
            code: button.dataset.code || "",
            path: button.dataset.path || ""
          });
        });
      });
      document.querySelectorAll(".snippet[data-code]").forEach((snippet) => {
        snippet.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", snippet.dataset.code || "");
          event.dataTransfer?.setData("text/goodecode-snippet", snippet.dataset.code || "");
        });
      });
    </script>
  </body>
</html>`;
}

function renderStudioHtml(webview, extensionUri) {
  const nonce = createNonce();
  const state = collectStudioState();
  const iconUri = imageDataUri(path.join(__dirname, "media", "goodecode-icon.png"), "image/png");
  const vexUri = imageDataUri(path.join(__dirname, "media", "vex-robotics-logo.svg"), "image/svg+xml");
  const bansextusUri = imageDataUri(path.join(__dirname, "media", "bansextus-343k-logo.png"), "image/png")
    || imageDataUri(path.join(__dirname, "media", "bansextus-343k.jpeg"), "image/jpeg");
  const workspaceBadge = state.workspaceRoot ? state.workspaceName : "Open a folder to begin";
  const installBadge = state.goodebotInstalled
    ? "Goodebot installed"
    : state.goodebotSource
      ? "Installer ready"
      : "Download needed";

  const installPageCard = renderInstallPageCard(state);
  const syntaxGuideCard = renderSyntaxGuideCard();
  const snippetCard = renderSnippetCard();
  const templateCard = `
    <section class="card utility-card">
      <div class="eyebrow">Starter</div>
      <h2>Single-file robot</h2>
      <div class="button-row">
        <button data-command="createSingleScriptTemplate">Create Single File</button>
      </div>
    </section>
  `;

  const workspaceCard = state.workspaceRoot
    ? `
      <section class="card">
        <div class="eyebrow">Workspace</div>
        <h2>${escapeHtml(state.workspaceName)}</h2>
        <p class="muted">${escapeHtml(state.workspaceRoot)}</p>
        <div class="chip-row">
          <span class="chip">${state.goodecodeRootExists ? "Goodecode package ready" : "No Goodecode package"}</span>
          <span class="chip">${state.goodecodeFiles.length} Python file${state.goodecodeFiles.length === 1 ? "" : "s"}</span>
        </div>
        <div class="button-row">
          <button data-command="openWorkspaceFolder">Reveal Workspace</button>
          <button data-command="refresh">Refresh</button>
        </div>
      </section>
    `
    : `
      <section class="card">
        <div class="eyebrow">Workspace</div>
        <h2>No folder open</h2>
        <p class="muted">Open a folder first.</p>
      </section>
    `;

  const fileButtons = state.goodecodeFiles.length
    ? state.goodecodeFiles
        .map(
          (filePath) => `
            <button class="file-button" data-command="openFile" data-path="${escapeAttribute(filePath)}">
              <span>${escapeHtml(path.basename(filePath))}</span>
              <span class="file-subtitle">${escapeHtml(toDisplayPath(filePath, state.workspaceRoot))}</span>
            </button>
          `
        )
        .join("")
    : `<div class="empty-state">No Goodecode files yet.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Goodecode Studio</title>
    <style>
      :root {
        --goodecode-blue: #4dd7ff;
        --goodebot-yellow: #f8cb5f;
        --goodebotdev-green: #56e39f;
      }
      body {
        margin: 0;
        font-family: var(--vscode-font-family);
        background: linear-gradient(180deg, #0a1724 0%, #132a42 100%);
        color: var(--vscode-foreground);
      }
      .shell {
        max-width: 1180px;
        margin: 0 auto;
        padding: 20px;
        display: grid;
        gap: 18px;
      }
      .hero, .card {
        border-radius: 22px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(8, 16, 27, 0.92);
      }
      .hero {
        padding: 22px;
        background:
          radial-gradient(circle at top left, rgba(78, 215, 255, 0.20), transparent 40%),
          radial-gradient(circle at top right, rgba(86, 227, 159, 0.13), transparent 36%),
          rgba(8, 16, 27, 0.96);
      }
      .hero-layout {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
        align-items: start;
      }
      .hero-top {
        display: flex;
        gap: 16px;
        align-items: flex-start;
      }
      .hero-icon-shell {
        width: 72px;
        height: 72px;
        flex: 0 0 72px;
        display: grid;
        place-items: center;
        border-radius: 22px;
        overflow: hidden;
        background: rgba(8, 16, 27, 0.96);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .hero-icon {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        border-radius: inherit;
      }
      .hero-copy-wrap {
        display: grid;
        gap: 10px;
      }
      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9eb3c7;
      }
      h1, h2, h3, p {
        margin: 0;
      }
      h1 {
        font-size: 22px;
        line-height: 1.05;
      }
      h2 {
        font-size: 18px;
        line-height: 1.15;
      }
      h3 {
        font-size: 14px;
        line-height: 1.2;
      }
      .hero-copy, .muted, .file-subtitle, .empty-state {
        color: #c7d3df;
      }
      .hero-copy {
        line-height: 1.5;
        max-width: 720px;
        font-size: 14px;
      }
      .hero-badges {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .hero-badge {
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #dce7f1;
        font-size: 12px;
        font-weight: 600;
      }
      .hero-side {
        display: grid;
        gap: 10px;
      }
      .hero-stat {
        display: grid;
        gap: 4px;
        padding: 14px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .hero-stat-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #8fa8bf;
      }
      .hero-stat-value {
        color: #f2f7fb;
        font-size: 14px;
        font-weight: 700;
        line-height: 1.3;
      }
      .grid {
        display: grid;
        gap: 18px;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        align-items: start;
      }
      .card {
        padding: 18px;
        display: grid;
        gap: 14px;
        align-content: start;
        min-height: 0;
      }
      .install-card {
        align-content: start;
      }
      .chip-row, .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: flex-start;
      }
      .chip {
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(78, 215, 255, 0.13);
        border: 1px solid rgba(78, 215, 255, 0.28);
        font-size: 12px;
      }
      button {
        border: none;
        border-radius: 12px;
        padding: 11px 13px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        color: #eff5fb;
        background: rgba(255, 255, 255, 0.08);
        transition: background 120ms ease, transform 120ms ease;
        flex: 0 0 auto;
        align-self: flex-start;
      }
      button:hover {
        background: rgba(255, 255, 255, 0.14);
        transform: translateY(-1px);
      }
      button.primary {
        color: #08101b;
        background: linear-gradient(180deg, var(--goodebot-yellow) 0%, #e5b94d 100%);
      }
      input[type="password"] {
        width: min(100%, 420px);
        box-sizing: border-box;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 12px 13px;
        color: #eff5fb;
        background: rgba(255, 255, 255, 0.07);
        outline: none;
      }
      input[type="password"]:focus {
        border-color: rgba(248, 203, 95, 0.58);
        box-shadow: 0 0 0 3px rgba(248, 203, 95, 0.12);
      }
      .file-list {
        display: grid;
        gap: 8px;
      }
      .file-button {
        display: grid;
        gap: 4px;
        text-align: left;
      }
      .install-status {
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        line-height: 1.45;
      }
      .install-preserve-grid {
        display: grid;
        gap: 8px;
      }
      .install-meta-row {
        display: grid;
        gap: 3px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(78, 215, 255, 0.08);
        border: 1px solid rgba(78, 215, 255, 0.18);
      }
      .install-meta-row span {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #a9c7d9;
        font-weight: 800;
      }
      .install-meta-row strong {
        color: #eef8ff;
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }
      .install-section-list, .install-step-list {
        margin: 0;
        padding-left: 18px;
        display: grid;
        gap: 8px;
      }
      .install-step-list li, .install-section-list li {
        color: #dbe7f3;
      }
      .install-block {
        display: grid;
        gap: 8px;
        padding: 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }
      .install-block.info {
        border-color: rgba(78, 215, 255, 0.22);
        background: rgba(78, 215, 255, 0.09);
      }
      .snippet-card {
        max-height: min(760px, 76vh);
      }
      .snippet-scroll {
        display: grid;
        gap: 12px;
        min-height: 0;
        max-height: min(620px, 58vh);
        overflow: auto;
        padding-right: 4px;
      }
      .credit-row {
        display: flex;
        align-items: center;
        gap: 22px;
        flex-wrap: wrap;
      }
      .credit-mark {
        min-width: 94px;
        height: 54px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        padding: 0 14px;
        background: rgba(255, 255, 255, 0.055);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: #effaff;
        font-size: 20px;
        font-weight: 900;
        letter-spacing: 0.08em;
      }
      .credit-logo {
        display: block;
        object-fit: contain;
        background: transparent;
        border: 0;
      }
      .credit-logo.vex {
        width: min(210px, 45vw);
        max-height: 78px;
      }
      .credit-logo.bansextus {
        width: min(360px, 74vw);
        max-height: 96px;
      }
      .install-block.warning {
        border-color: rgba(248, 203, 95, 0.25);
        background: rgba(248, 203, 95, 0.08);
      }
      .install-block.error {
        border-color: rgba(255, 122, 122, 0.25);
        background: rgba(255, 122, 122, 0.08);
      }
      .install-meta {
        font-size: 11px;
        color: #9eb3c7;
      }
      .file-subtitle {
        font-size: 11px;
      }
      @media (max-width: 900px) {
        .shell {
          padding: 16px;
        }
        .hero-layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <section class="hero">
        <div class="hero-layout">
          <div class="hero-top">
            <div class="hero-icon-shell">
              <img class="hero-icon" src="${escapeAttribute(iconUri)}" alt="" />
            </div>
            <div class="hero-copy-wrap">
              <div class="eyebrow">Editor Tab</div>
              <h1>Goodecode Studio</h1>
              <p class="hero-copy">Build Python. Open Goodebot.</p>
              <div class="hero-badges">
                <span class="hero-badge">${escapeHtml(installBadge)}</span>
                <span class="hero-badge">${escapeHtml(workspaceBadge)}</span>
              </div>
            </div>
          </div>
          <div class="hero-side">
            <div class="hero-stat">
              <span class="hero-stat-label">Workspace</span>
              <span class="hero-stat-value">${escapeHtml(state.workspaceRoot ? state.workspaceName : "No folder open")}</span>
            </div>
            <div class="hero-stat">
              <span class="hero-stat-label">Activated Path</span>
              <span class="hero-stat-value">${escapeHtml(state.goodecodeRoot || state.workspaceRoot || "Open a folder")}</span>
            </div>
            <div class="hero-stat">
              <span class="hero-stat-label">Goodecode Files</span>
              <span class="hero-stat-value">${state.goodecodeFiles.length} Python file${state.goodecodeFiles.length === 1 ? "" : "s"} detected</span>
            </div>
            <div class="hero-stat">
              <span class="hero-stat-label">Goodebot</span>
              <span class="hero-stat-value">${escapeHtml(state.goodebotInstalled ? `Installed: ${goodebotBuildLabel(state.goodebotInstalledBuild)}` : "Not installed")}</span>
            </div>
          </div>
        </div>
      </section>

      <div class="grid">
        ${installPageCard}

        <section class="card">
          <div class="eyebrow">Actions</div>
          <h2>Tools</h2>
          <div class="button-row">
            <button class="primary" data-command="createStarterFiles">New Workspace</button>
            <button data-command="createScreenTemplate">Screen File</button>
            <button data-command="convertForGoodebot">Build Runtime</button>
            <button data-command="openGoodebot">Open Goodebot</button>
          </div>
        </section>
      </div>

      <div class="grid">
        ${syntaxGuideCard}
        ${snippetCard}
        ${templateCard}
      </div>

      ${workspaceCard}

      <section class="card">
        <div class="eyebrow">Credits</div>
        <h2>Robotics Platform</h2>
        <div class="credit-row">
          ${vexUri ? `<img class="credit-logo vex" src="${escapeAttribute(vexUri)}" alt="VEX Robotics" />` : `<div class="credit-mark" aria-label="VEX Robotics">VEX</div>`}
          ${bansextusUri ? `<img class="credit-logo bansextus" src="${escapeAttribute(bansextusUri)}" alt="Bansextus(343K);" />` : `<div class="credit-mark">343K</div>`}
        </div>
        <p class="muted">VEX and V5 are trademarks of VEX Robotics. Goodebot and Goodecode are independent tools by Bansextus(343K):.</p>
      </section>

      <section class="card">
        <div class="eyebrow">Files</div>
        <h2>Python files</h2>
        <div class="file-list">
          ${fileButtons}
        </div>
      </section>
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelectorAll("button[data-command]").forEach((button) => {
        button.addEventListener("click", () => {
          vscode.postMessage({
            type: button.dataset.command,
            path: button.dataset.path || ""
          });
        });
      });
    </script>
  </body>
</html>`;
}

function collectStudioState() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const activeDocument = vscode.window.activeTextEditor?.document;
  const workspaceRoot = workspaceFolder?.uri.fsPath ?? "";
  const workspaceName = workspaceFolder?.name ?? "No folder open";
  const activePath = activeDocument?.uri?.scheme === "file" ? activeDocument.uri.fsPath : "";
  const cacheKey = `${workspaceRoot}\n${activePath}`;
  const now = Date.now();
  if (cachedStudioState && cachedStudioStateKey === cacheKey && now - cachedStudioStateAt < STUDIO_STATE_CACHE_MS) {
    return cachedStudioState;
  }

  const goodecodeRoot = workspaceRoot ? resolvePreferredGoodecodeRoot(workspaceRoot, workspaceName) : "";
  const goodecodeRootExists = goodecodeRoot ? pathExists(goodecodeRoot) : false;
  const goodecodeFiles = workspaceRoot ? findGoodecodeFiles(workspaceRoot) : [];
  const activeGoodecodeFile = isConvertableGoodecodeDocument(activeDocument);
  const pythonCommand = detectPythonCommand();
  const pythonExtensionInstalled = Boolean(vscode.extensions.getExtension(PYTHON_EXTENSION_ID));
  const goodebotInstalled = detectInstalledGoodebotApp();
  const goodebotSource = detectGoodebotInstallSource(workspaceRoot);
  const goodebotInstalledBuild = goodebotInstalled
    ? { ...readGoodebotBuildInfo(goodebotInstalled.path), ...readGoodebotBundleInfo(goodebotInstalled.path) }
    : {};
  const installPage = loadInstallPageSpec(workspaceRoot);

  cachedStudioState = {
    workspaceRoot,
    workspaceName,
    activePath,
    goodecodeRoot,
    goodecodeRootExists,
    goodecodeFiles,
    activeGoodecodeFile,
    pythonCommand,
    pythonExtensionInstalled,
    goodebotInstalled,
    goodebotInstalledBuild,
    goodebotSource,
    installPage,
  };
  cachedStudioStateKey = cacheKey;
  cachedStudioStateAt = now;
  return cachedStudioState;
}

function renderInstallPageCard(state) {
  const spec = state.installPage?.data ?? defaultInstallPageData();
  const page = spec.page ?? {};
  const status = spec.status ?? {};
  const actions = spec.actions ?? {};
  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  const statusTitle = state.goodebotInstalled
    ? status.installed_title || "Installed for macOS"
    : state.goodebotSource
      ? status.ready_title || "Installer Ready"
      : status.missing_title || "Download first";
  const statusBody = state.goodebotInstalled
    ? `${status.installed_prefix || "Installed at"} ${state.goodebotInstalled.path}`
    : state.goodebotSource
      ? `${status.source_prefix || "Local install source found at"} ${state.goodebotSource.path}`
      : status.missing_body || "No local Goodebot Mac package was found yet. Download a Goodebot Mac zip, then come back and click install.";
  const primaryLabel = state.goodebotInstalled
    ? actions.installed_secondary_label || "Open Goodebot"
    : actions.primary_label || "Install Goodebot for Mac";
  const primaryCommand = state.goodebotInstalled ? "openGoodebot" : "installGoodebot";
  const secondaryLabel = state.goodebotInstalled
    ? actions.installed_reinstall_label || "Remove and Redownload Goodebot"
    : actions.missing_secondary_label || "Download Page";
  const secondaryCommand = state.goodebotInstalled ? "reinstallGoodebot" : "openDownload";
  const updateLine = state.goodebotInstalled
    ? `<div class="muted small">Installed build: ${escapeHtml(goodebotBuildLabel(state.goodebotInstalledBuild))}</div>`
    : "";
  const updateButton = `<button data-command="updateGoodebot">Scan Profiles + Update</button>`;
  const goodecodePath = state.goodecodeRoot || (state.workspaceRoot ? path.join(state.workspaceRoot, GOODECODE_CONFIG_DIR) : "");
  const preservationRows = [
    ["Workspace", state.workspaceRoot || "No VS Code folder open"],
    ["Goodecode path", goodecodePath || "Open a folder to create .goodecode files"],
    ["Installed app", state.goodebotInstalled?.path || "Not installed"],
    ["Profile to preserve", "Choose after scanning this Mac"],
    ["Legacy file", state.workspaceRoot ? path.join(state.workspaceRoot, GOODECODE_CONFIG_DIR, "LegacyV3.xx.json") : "Created after opening a folder"],
  ]
    .map(([label, value]) => `
      <div class="install-meta-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    `)
    .join("");

  return `
    <section class="card install-card">
      <div class="eyebrow">${escapeHtml(page.eyebrow || "Goodebot")}</div>
      <h2>${escapeHtml(page.title || "Install Goodebot for Mac")}</h2>
      <p class="muted">${escapeHtml(page.intro || "Install, open, or update Goodebot for macOS from Goodecode Studio.")}</p>
      <div class="install-status">
        <strong>${escapeHtml(statusTitle)}</strong><br />
        ${escapeHtml(statusBody)}
        ${updateLine}
      </div>
      <div class="install-preserve-grid">
        ${preservationRows}
      </div>
      <div class="button-row">
        <button class="primary" data-command="${primaryCommand}">${escapeHtml(primaryLabel)}</button>
        <button data-command="${secondaryCommand}">${escapeHtml(secondaryLabel)}</button>
        ${updateButton}
      </div>
      ${renderInstallPageSections(sections)}
    </section>
  `;
}

function renderSyntaxGuideCard() {
  return `
    <section class="card utility-card">
      <div class="eyebrow">Guide</div>
      <h2>Syntax guide</h2>
      <div class="button-row">
        <button class="primary" data-command="openSyntaxGuidePreview">Open Guide</button>
      </div>
    </section>
  `;
}

function renderSnippetCard() {
  const snippets = essentialGoodecodeSnippets()
    .map(
      (snippet) => `
        <div class="install-block info">
          <h3>${escapeHtml(snippet.title)}</h3>
          <pre class="muted" style="margin:0;white-space:pre-wrap;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;">${escapeHtml(snippet.code)}</pre>
          <div class="button-row">
            <button data-command="insertSnippet" data-code="${escapeAttribute(snippet.code)}">Insert</button>
          </div>
        </div>
      `
    )
    .join("");

  return `
    <section class="card snippet-card">
      <div class="eyebrow">Snippets</div>
      <h2>Core Python blocks</h2>
      <p class="muted">Use these for lifecycle, drive, turning, and screen basics.</p>
      <div class="snippet-scroll">
        ${snippets}
      </div>
    </section>
  `;
}

function renderInstallPageSections(sections) {
  return sections
    .map((section) => {
      const kind = typeof section?.kind === "string" ? section.kind : "note";
      const style = typeof section?.style === "string" ? section.style : "info";
      const title = typeof section?.title === "string" ? section.title : "";
      const body = typeof section?.body === "string" ? section.body : "";

      if (kind === "list" && Array.isArray(section.items)) {
        return `
          <div class="install-block ${escapeAttribute(style)}">
            ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
            ${body ? `<p class="muted">${escapeHtml(body)}</p>` : ""}
            <ul class="install-section-list">
              ${section.items.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}
            </ul>
          </div>
        `;
      }

      if (kind === "steps" && Array.isArray(section.steps)) {
        return `
          <div class="install-block ${escapeAttribute(style)}">
            ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
            ${body ? `<p class="muted">${escapeHtml(body)}</p>` : ""}
            <ol class="install-step-list">
              ${section.steps
                .map((step) => {
                  const stepTitle = typeof step?.title === "string" ? `${step.title}: ` : "";
                  const stepBody = typeof step?.body === "string" ? step.body : String(step ?? "");
                  return `<li><strong>${escapeHtml(stepTitle)}</strong>${escapeHtml(stepBody)}</li>`;
                })
                .join("")}
            </ol>
          </div>
        `;
      }

      return `
        <div class="install-block ${escapeAttribute(style)}">
          ${title ? `<h3>${escapeHtml(title)}</h3>` : ""}
          ${body ? `<p class="muted">${escapeHtml(body)}</p>` : ""}
        </div>
      `;
    })
    .join("");
}

function loadInstallPageSpec(workspaceRoot) {
  const workspaceOverridePath = workspaceRoot
    ? path.join(workspaceRoot, GOODECODE_CONFIG_DIR, INSTALL_PAGE_FILE_NAME)
    : "";
  const activePath = workspaceOverridePath && pathExists(workspaceOverridePath)
    ? workspaceOverridePath
    : BUNDLED_INSTALL_PAGE_PATH;

  try {
    const raw = fs.readFileSync(activePath, "utf8");
    const data = YAML.parse(raw);
    return {
      activePath,
      workspaceOverridePath,
      data: isInstallPageSpec(data) ? data : defaultInstallPageData(),
      error: isInstallPageSpec(data) ? "" : "The YAML file did not match the expected install-page structure.",
    };
  } catch (error) {
    return {
      activePath,
      workspaceOverridePath,
      data: defaultInstallPageData(),
      error: error.message,
    };
  }
}

function isInstallPageSpec(value) {
  return Boolean(value && typeof value === "object" && value.page && value.actions);
}

function defaultInstallPageData() {
  return {
    page: {
      eyebrow: "Goodebot",
      title: "Install Goodebot",
      intro: "Install or open the Mac app.",
    },
    status: {
      installed_title: "Installed",
      ready_title: "Ready",
      missing_title: "Download first",
      installed_prefix: "Installed:",
      source_prefix: "Found:",
      missing_body: "Download the Mac zip, then install.",
    },
    actions: {
      primary_label: "Install",
      installed_secondary_label: "Open Goodebot",
      installed_reinstall_label: "Reinstall Goodebot",
      missing_secondary_label: "Download",
    },
    sections: [
      {
        kind: "note",
        style: "info",
        title: "Need",
        body: "Keep the zip or app on this Mac.",
      },
    ],
  };
}

function candidateModifiedTime(candidatePath) {
  try {
    return fs.statSync(candidatePath).mtimeMs;
  } catch {
    return 0;
  }
}

function newestExistingCandidate(candidates) {
  return candidates
    .filter((candidate) => pathExists(candidate.path))
    .map((candidate) => ({
      ...candidate,
      modifiedTime: candidateModifiedTime(candidate.path),
    }))
    .sort((lhs, rhs) => {
      if (rhs.modifiedTime !== lhs.modifiedTime) {
        return rhs.modifiedTime - lhs.modifiedTime;
      }
      return lhs.path.localeCompare(rhs.path);
    })[0] ?? null;
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    if (typeof value !== "string" || !value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }

  return output;
}

function normalizeGoodecodeContainerBaseName(value) {
  const trimmed = String(value || "").replace(/[\\/]+/g, " ").trim();
  return trimmed || "Goodecode";
}

function preferredGoodecodePackageName(workspaceName) {
  return `${normalizeGoodecodeContainerBaseName(workspaceName)}.goodecode`;
}

function listPackagedGoodecodeRoots(workspaceRoot) {
  if (!pathExists(workspaceRoot)) {
    return [];
  }

  const preferredName = preferredGoodecodePackageName(path.basename(workspaceRoot));
  try {
    return fs.readdirSync(workspaceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().endsWith(".goodecode"))
      .map((entry) => path.join(workspaceRoot, entry.name))
      .filter((candidate) => directoryLooksLikeStandaloneGoodecodeProject(candidate))
      .sort((lhs, rhs) => {
        const lhsPreferred = path.basename(lhs).toLowerCase() === preferredName.toLowerCase();
        const rhsPreferred = path.basename(rhs).toLowerCase() === preferredName.toLowerCase();
        if (lhsPreferred !== rhsPreferred) {
          return lhsPreferred ? -1 : 1;
        }
        return lhs.localeCompare(rhs);
      });
  } catch {
    return [];
  }
}

function preferredGoodecodePackagePath(workspaceRoot, workspaceName = path.basename(workspaceRoot)) {
  return path.join(workspaceRoot, preferredGoodecodePackageName(workspaceName));
}

function resolvePreferredGoodecodeRoot(workspaceRoot, workspaceName = path.basename(workspaceRoot)) {
  if (!workspaceRoot) {
    return "";
  }

  const packagedRoot = listPackagedGoodecodeRoots(workspaceRoot)[0];
  if (packagedRoot) {
    return packagedRoot;
  }

  const legacyRoot = path.join(workspaceRoot, "Goodecode");
  if (pathExists(legacyRoot)) {
    return legacyRoot;
  }

  if (directoryLooksLikeStandaloneGoodecodeProject(workspaceRoot)) {
    return workspaceRoot;
  }

  return preferredGoodecodePackagePath(workspaceRoot, workspaceName);
}

function ensureGoodecodeRootForWrite(workspaceRoot, workspaceName = path.basename(workspaceRoot)) {
  const packagedRoot = listPackagedGoodecodeRoots(workspaceRoot)[0];
  if (packagedRoot) {
    return packagedRoot;
  }

  const preferredPackageRoot = preferredGoodecodePackagePath(workspaceRoot, workspaceName);
  const legacyRoot = path.join(workspaceRoot, "Goodecode");
  if (pathExists(legacyRoot)) {
    try {
      if (!pathExists(preferredPackageRoot)) {
        fs.renameSync(legacyRoot, preferredPackageRoot);
        return preferredPackageRoot;
      }
    } catch {
      return legacyRoot;
    }
    return legacyRoot;
  }

  if (directoryLooksLikeStandaloneGoodecodeProject(workspaceRoot)) {
    return workspaceRoot;
  }

  return preferredPackageRoot;
}

function commonGoodebotSearchRoots(workspaceRoot) {
  const home = os.homedir();
  return uniqueStrings([
    workspaceRoot || "",
    path.join(home, "Applications"),
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    path.join(home, "Library", "CloudStorage"),
    path.join(home, "Library", "Mobile Documents"),
    "/Applications",
    "/Users/Shared",
    GOODEBOT_LOCAL_REPO,
    GOODEBOT_DOWNLOAD_REPO,
  ]).filter((candidate) => pathExists(candidate));
}

function spotlightMatchesByName(fileNames, searchRoots) {
  if (process.platform !== "darwin") {
    return [];
  }

  const results = [];

  for (const fileName of fileNames) {
    for (const searchRoot of searchRoots) {
      try {
        const stdout = childProcess.execFileSync(
          "mdfind",
          ["-onlyin", searchRoot, `kMDItemFSName == "${fileName}"c`],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
        );
        for (const line of stdout.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) {
            results.push(trimmed);
          }
        }
      } catch {
        continue;
      }
    }
  }

  return uniqueStrings(results).filter((candidate) => pathExists(candidate));
}

function candidateDescriptor(candidatePath) {
  const lower = candidatePath.toLowerCase();
  const isInstaller = lower.includes("installer");
  const isZip = lower.endsWith(".zip");
  return {
    path: candidatePath,
    label: path.basename(candidatePath),
    kind: isInstaller ? "installer" : isZip ? "zip" : "app",
  };
}

function goodebotAppScanRoots(workspaceRoot = "") {
  return uniqueStrings([
    workspaceRoot || "",
    ...GOODEBOT_APP_SCAN_ROOTS,
  ]).filter((candidate) => pathExists(candidate));
}

function isGoodebotAppBundle(candidatePath) {
  if (path.basename(candidatePath) !== "Goodebot.app") {
    return false;
  }
  return pathExists(path.join(candidatePath, "Contents", "Info.plist"));
}

function goodebotAppDescriptor(appPath) {
  const buildInfo = {
    ...readGoodebotBuildInfo(appPath),
    ...readGoodebotBundleInfo(appPath),
  };
  return {
    ...candidateDescriptor(appPath),
    kind: "app",
    modifiedTime: candidateModifiedTime(appPath),
    buildInfo,
  };
}

function findGoodebotAppsWithSpotlight(searchRoots) {
  if (process.platform !== "darwin") {
    return [];
  }

  const matches = [...spotlightMatchesByName(GOODEBOT_APP_NAMES, searchRoots)];
  try {
    const stdout = childProcess.execFileSync(
      "mdfind",
      ['kMDItemFSName == "Goodebot.app"c'],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }
    );
    for (const line of stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        matches.push(trimmed);
      }
    }
  } catch {
    // Spotlight can be disabled or unavailable. The filesystem scan below is the fallback.
  }
  return matches;
}

function findGoodebotAppsWithFind(searchRoots) {
  const matches = [];
  for (const searchRoot of searchRoots) {
    try {
      const stdout = childProcess.execFileSync(
        "/usr/bin/find",
        [
          searchRoot,
          "-path", "*/Library/*", "-prune",
          "-o", "-path", "*/.Trash/*", "-prune",
          "-o", "-path", "*/node_modules/*", "-prune",
          "-o", "-path", "*/.git/*", "-prune",
          "-o", "-name", "Goodebot.app", "-type", "d", "-print", "-prune",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 9000 }
      );
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          matches.push(trimmed);
        }
      }
    } catch {
      continue;
    }
  }
  return matches;
}

function scanMacForGoodebotApps(workspaceRoot = "") {
  const explicitCandidates = [
    GOODEBOT_DESTINATION_APP,
    "/Applications/Goodebot.app",
    path.join(os.homedir(), "Downloads", "Goodebot.app"),
    path.join(GOODEBOT_LOCAL_REPO, "builds", "Goodebot", "Goodebot.app"),
  ];
  const searchRoots = goodebotAppScanRoots(workspaceRoot);
  const candidates = uniqueStrings([
    ...explicitCandidates,
    ...findGoodebotAppsWithSpotlight(searchRoots),
    ...findGoodebotAppsWithFind(searchRoots),
  ].map((candidate) => path.resolve(candidate)));

  return candidates
    .filter(isGoodebotAppBundle)
    .map(goodebotAppDescriptor)
    .sort((lhs, rhs) => {
      if (rhs.modifiedTime !== lhs.modifiedTime) {
        return rhs.modifiedTime - lhs.modifiedTime;
      }
      return lhs.path.localeCompare(rhs.path);
    });
}

function goodebotProfileScanRoots(workspaceRoot = "") {
  return uniqueStrings([
    workspaceRoot || "",
    ...GOODEBOT_PROFILE_SCAN_ROOTS,
  ]).filter((candidate) => pathExists(candidate));
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function appBundleAncestor(filePath) {
  let current = path.dirname(filePath);
  while (current && current !== path.dirname(current)) {
    if (path.extname(current).toLowerCase() === ".app") {
      return current;
    }
    current = path.dirname(current);
  }
  return "";
}

function profileSeedPathsForApp(appPath) {
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  return [
    path.join(resourcesPath, "goodebot_seed.json"),
    path.join(resourcesPath, "Workspace Data", "goodebot_workspace_blueprint.json"),
    path.join(resourcesPath, "Workspace Data", "goodebot_seed.json"),
  ];
}

function goodebotProfileAppName(appPath) {
  if (!appPath) {
    return "";
  }

  const infoPlist = path.join(appPath, "Contents", "Info.plist");
  for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
    try {
      const value = childProcess.execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", `Print :${key}`, infoPlist],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }
      ).trim();
      if (value) {
        return value;
      }
    } catch {
      continue;
    }
  }

  return path.basename(appPath, ".app");
}

function isGoodebotProfileJsonPath(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  const base = path.basename(filePath).toLowerCase();
  const appPath = appBundleAncestor(filePath);
  if (appPath) {
    return path.basename(appPath) !== "Goodebot.app"
      && profileSeedPathsForApp(appPath).some((candidate) => path.resolve(candidate) === path.resolve(filePath));
  }

  if (!base.endsWith(".json")) {
    return false;
  }

  return normalized.includes("/GoodebotProfiles/")
    || normalized.includes("/Developer Extras/Workspace Profiles/")
    || (base === "goodebot_workspace_blueprint.json"
      && normalized.includes("/Developer Extras/Additional Goodebot Profiles/"));
}

function isGoodebotProfileDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return false;
  }
  return typeof document.workspaceName === "string"
    || Number.isFinite(document.schemaVersion)
    || Boolean(document.robotBuilder)
    || Boolean(document.ports)
    || Boolean(document.runtime)
    || Array.isArray(document.driveLeftPorts)
    || Array.isArray(document.driveRightPorts);
}

function goodebotProfileBuildInfo(document, profilePath, appBundlePath) {
  if (appBundlePath) {
    return {
      ...readGoodebotBuildInfo(appBundlePath),
      ...readGoodebotBundleInfo(appBundlePath),
    };
  }

  const documentBuildInfo = {};
  const documentVersion = document?.goodebotVersion
    || document?.goodebotAppVersion
    || document?.createdWithGoodebotVersion
    || "";
  const documentStamp = document?.goodebotBuildStamp
    || document?.buildStamp
    || document?.createdWithBuildStamp
    || "";
  if (documentVersion) {
    documentBuildInfo["CFBundleShortVersionString"] = String(documentVersion).replace(/^V/i, "");
  }
  if (documentStamp) {
    documentBuildInfo["GoodebotBuildStamp"] = String(documentStamp);
  }

  const adjacentBuildInfo = path.join(path.dirname(profilePath), "BUILD_INFO.txt");
  if (pathExists(adjacentBuildInfo)) {
    try {
      return {
        ...parseGoodebotBuildInfoText(fs.readFileSync(adjacentBuildInfo, "utf8")),
        ...documentBuildInfo,
      };
    } catch {
      return documentBuildInfo;
    }
  }

  return documentBuildInfo;
}

function goodebotProfileMadeWithLabel(buildInfo) {
  const label = goodebotBuildLabel(buildInfo || {});
  return label && label !== "unknown" ? `Goodebot ${label}` : "unknown Goodebot version";
}

function goodebotProfileDescriptor(profilePath) {
  if (!isGoodebotProfileJsonPath(profilePath)) {
    return null;
  }

  const document = readJsonFileSafe(profilePath);
  if (!isGoodebotProfileDocument(document)) {
    return null;
  }

  const appBundlePath = appBundleAncestor(profilePath);
  const sourceFolder = appBundlePath || path.dirname(profilePath);
  const rawSchemaVersion = Number.isFinite(document.schemaVersion) ? Number(document.schemaVersion) : 1;
  const schemaVersion = Math.max(rawSchemaVersion, GOODEBOT_PROFILE_SCHEMA_VERSION);
  const migratedFromSchemaVersion = rawSchemaVersion < schemaVersion ? rawSchemaVersion : null;
  const fallbackName = appBundlePath
    ? goodebotProfileAppName(appBundlePath)
    : path.basename(profilePath, path.extname(profilePath));
  const name = String(document.workspaceName || "").trim() || fallbackName;
  const buildInfo = goodebotProfileBuildInfo(document, profilePath, appBundlePath);

  return {
    name,
    path: profilePath,
    sourceFolder,
    appBundlePath,
    schemaVersion,
    migratedFromSchemaVersion,
    madeWithBuildInfo: buildInfo,
    madeWithVersion: goodebotProfileMadeWithLabel(buildInfo),
    modifiedTime: candidateModifiedTime(appBundlePath || profilePath),
  };
}

function findGoodebotProfileJsonsWithFind(searchRoots) {
  const matches = [];
  for (const searchRoot of searchRoots) {
    try {
      const stdout = childProcess.execFileSync(
        "/usr/bin/find",
        [
          searchRoot,
          "-path", "*/Library/*", "-prune",
          "-o", "-path", "*/.Trash/*", "-prune",
          "-o", "-path", "*/node_modules/*", "-prune",
          "-o", "-path", "*/.git/*", "-prune",
          "-o", "-path", "*/.build/*", "-prune",
          "-o", "-path", "*/DerivedData/*", "-prune",
          "-o", "-path", "*/GitHub/*", "-prune",
          "-o", "-path", "*/GoodebotWorkspaces/*", "-prune",
          "-o", "-path", "*/Photos Library.photoslibrary/*", "-prune",
          "-o", "-type", "f", "(",
          "-name", "goodebot_seed.json",
          "-o", "-path", "*/GoodebotProfiles/*.json",
          "-o", "-path", "*/Developer Extras/Workspace Profiles/*.json",
          ")", "-print",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 9000, maxBuffer: 6_000_000 }
      );
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          matches.push(trimmed);
        }
      }
    } catch {
      continue;
    }
  }
  return matches;
}

function scanMacForGoodebotProfiles(workspaceRoot = "") {
  const searchRoots = goodebotProfileScanRoots(workspaceRoot);
  const candidates = uniqueStrings([
    ...spotlightMatchesByName(["goodebot_seed.json"], searchRoots),
    ...findGoodebotProfileJsonsWithFind(searchRoots),
  ].map((candidate) => path.resolve(candidate)));
  const seenProfileKeys = new Set();
  const profiles = [];

  for (const candidate of candidates) {
    const descriptor = goodebotProfileDescriptor(candidate);
    if (!descriptor) {
      continue;
    }
    const key = descriptor.appBundlePath || descriptor.path;
    if (seenProfileKeys.has(key)) {
      continue;
    }
    seenProfileKeys.add(key);
    profiles.push(descriptor);
  }

  return profiles.sort((lhs, rhs) => {
    const nameCompare = lhs.name.localeCompare(rhs.name, undefined, { numeric: true, sensitivity: "base" });
    if (nameCompare) {
      return nameCompare;
    }
    return lhs.sourceFolder.localeCompare(rhs.sourceFolder);
  });
}

function readGoodebotBuildInfo(appPath) {
  const buildInfoPath = path.join(appPath, "Contents", "Resources", "BUILD_INFO.txt");
  if (!pathExists(buildInfoPath)) {
    return {};
  }

  try {
    return parseGoodebotBuildInfoText(fs.readFileSync(buildInfoPath, "utf8"));
  } catch {
    return {};
  }
}

function parseGoodebotBuildInfoText(text) {
  const output = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      output[match[1].trim()] = match[2].trim();
    }
  }
  return output;
}

function readGoodebotBundleInfo(appPath) {
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  const output = {};
  if (!pathExists(plistPath) || process.platform !== "darwin") {
    return output;
  }

  const keys = ["CFBundleShortVersionString", "CFBundleVersion", "GoodebotBuildStamp", "GoodebotBuildChannel"];
  for (const key of keys) {
    try {
      const value = childProcess.execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", `Print :${key}`, plistPath],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }
      ).trim();
      if (value) {
        output[key] = value;
      }
    } catch {
      continue;
    }
  }
  return output;
}

function goodebotBuildLabel(buildInfo) {
  const shortVersion = buildInfo?.["CFBundleShortVersionString"] || buildInfo?.["Bundle Short Version"] || "";
  const stamp = buildInfo?.["GoodebotBuildStamp"] || buildInfo?.["Build Stamp"] || "";
  if (shortVersion && stamp) {
    return `V${shortVersion} (${stamp})`;
  }
  return buildInfo?.["Goodebot Version"] || (shortVersion ? `V${shortVersion}` : "") || stamp || buildInfo?.["Built At (UTC)"] || "unknown";
}

function goodebotArtifactVersionToken(source) {
  const fileText = [
    source?.buildRecord?.artifact || "",
    source?.path || "",
    source?.assetName || "",
    source?.label || "",
  ].join(" ");
  const artifactVersion = fileText.match(/\bV\d+(?:\.\d+)?\b/i)?.[0];
  if (artifactVersion) {
    return artifactVersion.toUpperCase();
  }

  const buildInfo = source?.buildInfo || {};
  const shortVersion = buildInfo["CFBundleShortVersionString"] || buildInfo["Bundle Short Version"] || "";
  if (shortVersion) {
    return `V${shortVersion}`;
  }

  const explicitVersion = buildInfo["Goodebot Version"] || "";
  if (explicitVersion) {
    return explicitVersion.startsWith("V") ? explicitVersion : `V${explicitVersion}`;
  }

  const stamp = buildInfo["GoodebotBuildStamp"] || buildInfo["Build Stamp"] || "";
  if (stamp) {
    return `build ${stamp}`;
  }

  const releaseTag = source?.releaseTag || source?.label || "";
  const releaseToken = releaseTag.match(/20\d{12}|20\d{6}/)?.[0] || "";
  if (releaseToken.length === 14) {
    return `${releaseToken.slice(0, 4)}-${releaseToken.slice(4, 6)}-${releaseToken.slice(6, 8)} ${releaseToken.slice(8, 10)}:${releaseToken.slice(10, 12)}`;
  }
  if (releaseToken.length === 8) {
    return `${releaseToken.slice(0, 4)}-${releaseToken.slice(4, 6)}-${releaseToken.slice(6, 8)}`;
  }

  return "unknown version";
}

function goodebotHasNumberedVersion(source) {
  return /^V3\.\d+/i.test(goodebotArtifactVersionToken(source));
}

function goodebotSourceKindLabel(source) {
  const sourcePath = source?.path || "";
  const fileName = path.basename(sourcePath || source?.assetName || source?.label || "Goodebot build");
  if (source?.sourceKind === "github") {
    return "released build";
  }
  if (sourcePath.includes(`${path.sep}Goodebot${path.sep}dev${path.sep}`)) {
    return "Goodebot dev build";
  }
  if (sourcePath.includes(`${path.sep}Goodebot${path.sep}beta${path.sep}`)) {
    return "Goodebot beta build";
  }
  if (source?.kind === "app") {
    return "Goodebot app";
  }
  return fileName;
}

function goodebotPickerLabel(source, icon) {
  return `${icon} ${goodebotArtifactVersionToken(source)} - ${goodebotSourceKindLabel(source)}`;
}

function goodebotSourceSortValue(source) {
  const token = goodebotArtifactVersionToken(source);
  const versionMatch = token.match(/^V(\d+)(?:\.(\d+))?/i);
  if (versionMatch) {
    return Number(versionMatch[1]) * 100000 + Number(versionMatch[2] || 0);
  }

  const stampText = [
    source?.buildInfo?.["GoodebotBuildStamp"] || "",
    source?.buildInfo?.["Build Stamp"] || "",
    source?.releaseTag || "",
    source?.label || "",
  ].join(" ");
  const stamp = stampText.match(/20\d{12}|20\d{6}/)?.[0];
  if (stamp) {
    return Number(stamp.padEnd(14, "0"));
  }

  return Number(source?.modifiedTime || 0);
}

function detectInstalledGoodebotApp() {
  const home = os.homedir();
  const explicitCandidates = [
    GOODEBOT_DESTINATION_APP,
    "/Applications/Goodebot.app",
    path.join(home, "Downloads", "Goodebot.app"),
    path.join(GOODEBOT_LOCAL_REPO, "builds", "Goodebot", "Goodebot.app"),
  ];

  return newestExistingCandidate(uniqueStrings(explicitCandidates).map(candidateDescriptor));
}

function detectGoodebotInstallSource(workspaceRoot) {
  return null;
}

function isPublicGoodebotReleaseTag(tagName) {
  const tag = String(tagName || "").toLowerCase();
  if (tag.includes("dev") || tag.includes("shared-beta")) {
    return false;
  }
  return /^goodebot-beta-\d{14}$/.test(tag)
    || /^goodebot-release-v?\d+(?:\.\d+)*$/.test(tag)
    || /^goodebot-v\d+(?:\.\d+)*$/.test(tag);
}

function goodebotSourceDisplayLabel(source) {
  if (!source) {
    return "No build selected";
  }
  const buildLabel = goodebotBuildLabel(source.buildInfo || {});
  if (source.sourceKind === "github") {
    return `${goodebotArtifactVersionToken(source)} - ${source.label || source.releaseTag || "GitHub build"}${buildLabel && buildLabel !== "unknown" ? ` (${buildLabel})` : ""}`;
  }
  return `${goodebotArtifactVersionToken(source)} - ${path.basename(source.path || source.label || "Goodebot build")}${buildLabel && buildLabel !== "unknown" ? ` (${buildLabel})` : ""}`;
}

async function fetchGoodebotReleaseBuildSources(limit = 20) {
  const releases = await fetchJson(RELEASES_API_URL);
  if (!Array.isArray(releases)) {
    return [];
  }

  const sources = [];
  for (const release of releases) {
    const tagName = typeof release.tag_name === "string" ? release.tag_name : "";
    if (!isPublicGoodebotReleaseTag(tagName)) {
      continue;
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const zipAsset = assets.find((asset) => {
      const name = String(asset?.name || "");
      return GOODEBOT_BUILD_ASSET_NAMES.includes(name)
        || (/goodebot/i.test(name) && /macos/i.test(name) && /\.zip$/i.test(name));
    });
    if (!zipAsset?.browser_download_url) {
      continue;
    }
    const buildInfoAsset = assets.find((asset) => String(asset?.name || "").toLowerCase() === "build_info.txt");
    const metadataAsset = assets.find((asset) => String(asset?.name || "").toLowerCase() === "build-metadata.json");
    let buildInfo = {};
    if (buildInfoAsset?.browser_download_url) {
      try {
        buildInfo = parseGoodebotBuildInfoText(await fetchText(buildInfoAsset.browser_download_url));
      } catch {
        buildInfo = {};
      }
    }
    let buildRecord = {};
    if (metadataAsset?.browser_download_url) {
      try {
        buildRecord = JSON.parse(await fetchText(metadataAsset.browser_download_url));
      } catch {
        buildRecord = {};
      }
    }
    const source = {
      path: zipAsset.browser_download_url,
      label: tagName || release.name || zipAsset.name,
      kind: "download",
      sourceKind: "github",
      releaseTag: tagName,
      releaseName: typeof release.name === "string" ? release.name : "",
      htmlUrl: typeof release.html_url === "string" ? release.html_url : DOWNLOAD_URL,
      assetName: zipAsset.name || "Goodebot-macOS.zip",
      assetUrl: zipAsset.browser_download_url,
      modifiedTime: Date.parse(release.published_at || "") || 0,
      buildInfo,
      buildRecord,
    };
    if (!goodebotHasNumberedVersion(source)) {
      continue;
    }
    sources.push(source);
    if (sources.length >= limit) {
      break;
    }
  }
  return sources.sort((lhs, rhs) => {
    const versionDelta = goodebotSourceSortValue(rhs) - goodebotSourceSortValue(lhs);
    if (versionDelta) {
      return versionDelta;
    }
    return (rhs.modifiedTime || 0) - (lhs.modifiedTime || 0);
  });
}

async function chooseGoodebotInstallSource(title = "Choose Goodebot Build To Install") {
  let githubSources = [];
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Checking released Goodebot builds",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Reading Goodebot releases from GitHub..." });
      try {
        githubSources = await fetchGoodebotReleaseBuildSources();
      } catch {
        githubSources = [];
      }
    }
  );

  const items = [];
  if (githubSources.length) {
    const makeItem = (source, labelPrefix = "$(cloud-download)") => {
      const published = source.modifiedTime ? new Date(source.modifiedTime).toLocaleString() : "unknown publish time";
      return {
        label: goodebotPickerLabel(source, labelPrefix),
        description: source.assetName,
        detail: `${source.htmlUrl}\nPublished ${published}`,
        source,
      };
    };

    items.push({ label: "Latest Release", kind: vscode.QuickPickItemKind.Separator });
    items.push(makeItem(githubSources[0], "$(cloud-download)"));

    if (githubSources.length > 1) {
      items.push({ label: "Previous Releases", kind: vscode.QuickPickItemKind.Separator });
      for (const source of githubSources.slice(1)) {
        items.push(makeItem(source, "$(history)"));
      }
    }
  }

  if (!items.some((item) => item.source)) {
    return null;
  }

  const choice = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: "Pick the released Goodebot build VS Code should install",
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });

  return choice?.source || null;
}

async function openInstalledGoodebot() {
  const state = collectStudioState();
  const installed = state.goodebotInstalled;
  const source = state.goodebotSource;

  let install = installed ?? source;
  if (source?.kind === "app" && (!installed || source.modifiedTime > installed.modifiedTime)) {
    install = source;
  }

  if (!install) {
    const source = await chooseGoodebotInstallSource();
    if (!source) {
      await vscode.window.showWarningMessage("No released Goodebot build was found on GitHub.");
      return;
    }
    await installGoodebotForMacWithOptions({ forceRedownload: true, installSource: source });
    return;
  }

  if (install.kind === "zip" || install.kind === "installer") {
    await installGoodebotForMacWithOptions({ forceRedownload: false });
    return;
  }

  await openTarget(install.path);
}

async function installGoodebotForMac() {
  await installGoodebotForMacWithOptions({ forceRedownload: false });
}

async function reinstallGoodebotForMac() {
  if (process.platform !== "darwin") {
    await vscode.window.showWarningMessage("This reinstall flow is currently for macOS only.");
    await vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    "This removes the installed Goodebot app and downloads a fresh macOS build.",
    { modal: true },
    "Remove and Redownload"
  );

  if (choice !== "Remove and Redownload") {
    return;
  }

  const source = await chooseGoodebotInstallSource();
  if (!source) {
    await vscode.window.showWarningMessage("No released Goodebot build was found on GitHub.");
    return;
  }
  await installGoodebotForMacWithOptions({ forceRedownload: true, installSource: source });
}

async function updateGoodebotForMac() {
  if (process.platform !== "darwin") {
    await vscode.window.showWarningMessage("Goodebot update checks are currently for macOS only.");
    await vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
    return;
  }

  const selectedProfile = await chooseGoodebotUpdateProfile();
  if (!selectedProfile) {
    const choice = await vscode.window.showInformationMessage(
      "No Goodebot robot profiles were found on this Mac. Choose a released Goodebot build and install it normally?",
      "Install Released Build",
      "Cancel"
    );
    if (choice === "Install Released Build") {
      const source = await chooseGoodebotInstallSource();
      if (!source) {
        await vscode.window.showWarningMessage("No released Goodebot build was found on GitHub.");
        return;
      }
      await installGoodebotForMacWithOptions({
        forceRedownload: true,
        updateMode: true,
        targetAppPath: GOODEBOT_DESTINATION_APP,
        installSource: source,
      });
    }
    return;
  }

  const installed = selectedProfile.appBundlePath
    ? goodebotAppDescriptor(selectedProfile.appBundlePath)
    : detectInstalledGoodebotApp();
  const installedBuild = installed?.buildInfo || (installed?.path
    ? {
      ...readGoodebotBuildInfo(installed.path),
      ...readGoodebotBundleInfo(installed.path),
    }
    : {});

  const source = await chooseGoodebotInstallSource();
  if (!source) {
    const choice = await vscode.window.showWarningMessage(
      "No released Goodebot build was found on GitHub. Open the downloads page?",
      "Open Downloads"
    );
    if (choice === "Open Downloads") {
      await vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
    }
    return;
  }

  const installedLabel = goodebotBuildLabel(installedBuild);
  const targetAppPath = selectedProfile.appBundlePath || installed?.path || GOODEBOT_DESTINATION_APP;
  const choice = await vscode.window.showInformationMessage(
    `Ready to update the selected Goodebot profile.\nProfile: ${selectedProfile.name}\nTarget app: ${targetAppPath}\nInstalled: ${installedLabel}\nBuild to install: ${goodebotSourceDisplayLabel(source)}`,
    { modal: true },
    "Install Selected Build",
    "Open Downloads"
  );

  if (choice === "Install Selected Build") {
    await installGoodebotForMacWithOptions({
      forceRedownload: true,
      updateMode: true,
      installSource: source,
      targetAppPath,
      selectedInstalled: installed,
      selectedProfile,
    });
  } else if (choice === "Open Downloads") {
    await vscode.env.openExternal(vscode.Uri.parse(source.htmlUrl || DOWNLOAD_URL));
  }
}

async function chooseGoodebotUpdateProfile() {
  const state = collectStudioState();
  const profiles = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Scanning this Mac for Goodebot profiles",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Checking exported profile apps and saved Goodebot profile JSON files..." });
      return scanMacForGoodebotProfiles(state.workspaceRoot);
    }
  );

  if (!profiles.length) {
    return null;
  }

  const items = profiles.map((profile) => {
    const version = `v${profile.schemaVersion}`;
    const sourceKind = profile.appBundlePath ? "profile app" : "profile json";
    const madeWith = profile.madeWithVersion || "unknown Goodebot version";
    const upgrade = profile.migratedFromSchemaVersion
      ? `\nLegacy profile v${profile.migratedFromSchemaVersion} will be upgraded to ${version}.`
      : "";
    return {
      label: `$(check) ${profile.name}`,
      description: `${version} • made with ${madeWith}`,
      detail: `${profile.sourceFolder}\n${sourceKind}${upgrade}`,
      profile,
    };
  });

  const choice = await vscode.window.showQuickPick(items, {
    title: "Choose Goodebot Profile To Update",
    placeHolder: "Select the robot profile VS Code should preserve while updating Goodebot",
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });

  return choice?.profile || null;
}

function preserveGoodebotProfileResources(profile) {
  if (!profile?.appBundlePath || !pathExists(profile.appBundlePath)) {
    return null;
  }

  const resourceRoot = path.join(profile.appBundlePath, "Contents", "Resources");
  const seedPath = profile.path && pathExists(profile.path)
    ? profile.path
    : profileSeedPathsForApp(profile.appBundlePath).find(pathExists);
  const resourceFiles = [
    "goodebot_branding.json",
    "goodebot_workspace_branding.json",
    "custom_app_icon.png",
    "AppIcon.icns",
  ];
  const preserved = {
    name: profile.name || goodebotProfileAppName(profile.appBundlePath),
    schemaVersion: profile.schemaVersion,
    migratedFromSchemaVersion: profile.migratedFromSchemaVersion,
    appBundlePath: profile.appBundlePath,
    profilePath: profile.path,
    seedData: seedPath ? fs.readFileSync(seedPath) : null,
    files: [],
  };

  for (const relativePath of resourceFiles) {
    const filePath = path.join(resourceRoot, relativePath);
    if (pathExists(filePath)) {
      preserved.files.push({
        relativePath,
        data: fs.readFileSync(filePath),
      });
    }
  }

  return preserved;
}

function restoreGoodebotProfileResources(targetAppPath, preserved) {
  if (!preserved || !pathExists(targetAppPath)) {
    return;
  }

  const resourceRoot = path.join(targetAppPath, "Contents", "Resources");
  if (preserved.seedData) {
    const seedTargets = [
      path.join(resourceRoot, "goodebot_seed.json"),
      path.join(resourceRoot, "Workspace Data", "goodebot_seed.json"),
    ];
    for (const seedTarget of seedTargets) {
      fs.mkdirSync(path.dirname(seedTarget), { recursive: true });
      fs.writeFileSync(seedTarget, preserved.seedData);
    }
  }

  for (const file of preserved.files || []) {
    const target = path.join(resourceRoot, file.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.data);
  }

  const infoPlist = path.join(targetAppPath, "Contents", "Info.plist");
  if (preserved.name && pathExists(infoPlist)) {
    for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
      try {
        childProcess.execFileSync(
          "/usr/libexec/PlistBuddy",
          ["-c", `Set :${key} ${preserved.name}`, infoPlist],
          { stdio: "ignore", timeout: 1000 }
        );
      } catch {
        try {
          childProcess.execFileSync(
            "/usr/libexec/PlistBuddy",
            ["-c", `Add :${key} string ${preserved.name}`, infoPlist],
            { stdio: "ignore", timeout: 1000 }
          );
        } catch {
          // Display name preservation is helpful, but the profile seed is the critical data.
        }
      }
    }
  }
}

async function installGoodebotForMacWithOptions(options) {
  if (process.platform !== "darwin") {
    await vscode.window.showWarningMessage("This install flow is currently for macOS only.");
    await vscode.env.openExternal(vscode.Uri.parse(DOWNLOAD_URL));
    return;
  }

  const targetAppPath = options.targetAppPath || GOODEBOT_DESTINATION_APP;
  const selectedInstalled = options.selectedInstalled
    || (pathExists(targetAppPath) && isGoodebotAppBundle(targetAppPath) ? goodebotAppDescriptor(targetAppPath) : null);
  const installed = selectedInstalled || detectInstalledGoodebotApp();
  if (!options.forceRedownload && installed) {
    const choice = await vscode.window.showWarningMessage(
      `Goodebot is already installed at ${installed.path}.`,
      { modal: true },
      "Open Installed Goodebot",
      "Remove and Redownload"
    );

    if (choice === "Open Installed Goodebot") {
      await openTarget(installed.path);
      return;
    }

    if (choice === "Remove and Redownload") {
      await installGoodebotForMacWithOptions({
        forceRedownload: true,
        targetAppPath: installed.path,
        selectedInstalled: installed,
      });
    }
    return;
  }

  const state = collectStudioState();
  const source = options.installSource || (options.forceRedownload ? null : state.goodebotSource);
  const preservedProfileResources = preserveGoodebotProfileResources(options.selectedProfile);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing Goodebot for macOS",
      cancellable: false,
    },
    async (progress) => {
      const installRoot = path.join(os.tmpdir(), `goodecode-goodebot-install-${Date.now()}`);
      const zipRoot = path.join(installRoot, "zip");
      const downloadZipPath = path.join(installRoot, "Goodebot-macOS.zip");
      fs.mkdirSync(installRoot, { recursive: true });
      fs.mkdirSync(zipRoot, { recursive: true });
      fs.mkdirSync(path.dirname(targetAppPath), { recursive: true });

      let resolvedSource = source;
      if (resolvedSource?.kind === "download") {
        progress.report({ message: `Downloading ${resolvedSource.assetName || "selected Goodebot build"}...` });
        try {
          await downloadFile(resolvedSource.assetUrl || resolvedSource.path, downloadZipPath);
        } catch (error) {
          throw new Error(goodebotDownloadFailureMessage(error));
        }
        resolvedSource = {
          path: downloadZipPath,
          label: resolvedSource.assetName || path.basename(downloadZipPath),
          kind: "zip",
          releaseTag: resolvedSource.releaseTag || "",
          originalUrl: resolvedSource.assetUrl || resolvedSource.path,
        };
      }
      if (!resolvedSource) {
        progress.report({ message: "Downloading the latest released Goodebot build..." });
        const latestRelease = options.release || await fetchLatestGoodebotRelease();
        try {
          await downloadFile(latestRelease.zipUrl, downloadZipPath);
        } catch (error) {
          throw new Error(goodebotDownloadFailureMessage(error));
        }
        resolvedSource = {
          path: downloadZipPath,
          label: latestRelease.name || latestRelease.tagName || path.basename(downloadZipPath),
          kind: "zip",
          releaseTag: latestRelease.tagName || "",
          originalUrl: latestRelease.zipUrl,
        };
      }

      if (!resolvedSource) {
        throw new Error("No Goodebot install source is available.");
      }

      let appSourcePath = resolvedSource.path;

      if (resolvedSource.kind === "installer") {
        progress.report({ message: "Opening Goodebot Installer..." });
        await openTarget(resolvedSource.path);
        return;
      }

      if (resolvedSource.kind === "zip") {
        progress.report({ message: "Unpacking Goodebot zip..." });
        await execFileAsync("ditto", ["-x", "-k", resolvedSource.path, zipRoot]);
        const unpackedApp = findAppBundle(zipRoot);
        if (!unpackedApp) {
          throw new Error("The Goodebot zip did not contain Goodebot.app.");
        }
        appSourcePath = unpackedApp;
      }

      if (!pathExists(appSourcePath)) {
        throw new Error(`Install source missing at ${appSourcePath}`);
      }

      const targetBuild = {
        ...readGoodebotBuildInfo(appSourcePath),
        ...readGoodebotBundleInfo(appSourcePath),
        Release: options.release?.tagName || options.release?.name || resolvedSource.releaseTag || resolvedSource.label || "",
      };

      progress.report({ message: "Saving Goodebot personalization and legacy migration..." });
      const snapshot = writeGoodebotPersonalizationSnapshot(state, targetBuild, {
        selectedProfile: options.selectedProfile,
      });
      const backupPath = await backupInstalledGoodebotApp(selectedInstalled || installed, state);
      const legacyPath = writeGoodebotLegacyMigrationFile(state, targetBuild, {
        backupPath,
        targetAppPath,
        oldAppPath: (selectedInstalled || installed)?.path || "",
        oldBuild: (selectedInstalled || installed)?.buildInfo || (installed?.path
          ? { ...readGoodebotBuildInfo(installed.path), ...readGoodebotBundleInfo(installed.path) }
          : {}),
        sourcePath: resolvedSource.originalUrl || resolvedSource.path,
        appSourcePath,
        snapshot,
        selectedProfile: options.selectedProfile,
      });

      progress.report({ message: "Copying Goodebot into the selected app..." });
      fs.rmSync(targetAppPath, { recursive: true, force: true });
      await execFileAsync("ditto", [appSourcePath, targetAppPath]);
      restoreGoodebotProfileResources(targetAppPath, preservedProfileResources);

      progress.report({ message: "Removing macOS quarantine flags..." });
      await execFileAsync("xattr", ["-dr", "com.apple.quarantine", targetAppPath]).catch(() => {});

      progress.report({ message: "Launching Goodebot..." });
      await openTarget(targetAppPath);
      cachedStudioState = undefined;
      const legacyNote = legacyPath ? ` Legacy file: ${legacyPath}` : "";
      await vscode.window.showInformationMessage(`Goodebot installed at ${targetAppPath}.${legacyNote}`);
    }
  ).catch(async (error) => {
    await vscode.window.showErrorMessage(`Goodebot install failed: ${error.message}`);
  });
}

function goodebotDownloadFailureMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("status 404") || message.includes("status 403")) {
    return "Goodebot could not download a released Mac zip from GitHub. Open the releases page, then try again.";
  }
  return message || "Goodebot download failed.";
}

async function fetchLatestGoodebotRelease() {
  const [release] = await fetchGoodebotReleaseBuildSources(1);
  if (!release) {
    throw new Error("No Goodebot macOS release zip was found.");
  }
  return {
    tagName: release.releaseTag || release.label || "",
    name: release.releaseName || release.label || "",
    htmlUrl: release.htmlUrl || DOWNLOAD_URL,
    publishedAt: release.modifiedTime ? new Date(release.modifiedTime).toISOString() : "",
    zipUrl: release.assetUrl || release.path || "",
  };
}

function releaseLooksNewerForExtension(release, installedBuild) {
  const installedBuiltAt = Date.parse(installedBuild?.["Built At (UTC)"] || "");
  const releasePublishedAt = Date.parse(release?.publishedAt || "");
  if (Number.isFinite(installedBuiltAt) && Number.isFinite(releasePublishedAt)) {
    return releasePublishedAt > installedBuiltAt + 60_000;
  }

  const installedStamp = installedBuild?.["Build Stamp"] || "";
  const installedDay = Number.parseInt(installedStamp.slice(0, 8), 10);
  const releaseDay = releaseDateTokenForExtension(release);
  if (Number.isFinite(installedDay) && Number.isFinite(releaseDay)) {
    return releaseDay > installedDay;
  }

  const installedLabel = goodebotBuildLabel(installedBuild).toLowerCase();
  if (!installedLabel || installedLabel === "unknown") {
    return true;
  }
  const releaseText = [release.tagName, release.name, release.publishedAt]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return !releaseText.includes(installedLabel);
}

function releaseDateTokenForExtension(release) {
  const text = [release?.tagName, release?.name, release?.publishedAt].filter(Boolean).join(" ");
  const match = text.match(/20\d{2}[-_]?\d{2}[-_]?\d{2}/);
  if (!match) {
    return Number.NaN;
  }
  return Number.parseInt(match[0].replace(/\D/g, ""), 10);
}

function goodebotProfileSnapshot(profile) {
  if (!profile) {
    return null;
  }
  return {
    name: profile.name || "",
    path: profile.path || "",
    sourceFolder: profile.sourceFolder || "",
    appBundlePath: profile.appBundlePath || "",
    schemaVersion: profile.schemaVersion || 0,
    migratedFromSchemaVersion: profile.migratedFromSchemaVersion || null,
    madeWithVersion: profile.madeWithVersion || "",
    madeWithBuildInfo: profile.madeWithBuildInfo || {},
  };
}

function writeGoodebotPersonalizationSnapshot(state, targetBuild = {}, details = {}) {
  const snapshot = {
    savedAt: new Date().toISOString(),
    source: "goodecode-vscode-extension",
    workspaceRoot: state?.workspaceRoot || "",
    workspaceName: state?.workspaceName || "",
    activePath: state?.activePath || "",
    goodecodeRoot: state?.goodecodeRoot || "",
    goodecodeRootExists: Boolean(state?.goodecodeRootExists),
    goodecodeFiles: Array.isArray(state?.goodecodeFiles) ? state.goodecodeFiles : [],
    installedGoodebot: state?.goodebotInstalled?.path || "",
    installedBuild: state?.goodebotInstalled?.path
      ? { ...readGoodebotBuildInfo(state.goodebotInstalled.path), ...readGoodebotBundleInfo(state.goodebotInstalled.path) }
      : {},
    selectedProfile: goodebotProfileSnapshot(details.selectedProfile),
    targetBuild,
  };

  fs.mkdirSync(GOODEBOT_APP_SUPPORT_ROOT, { recursive: true });
  const appSupportSnapshot = path.join(GOODEBOT_APP_SUPPORT_ROOT, "goodebot_personalization.json");
  fs.writeFileSync(appSupportSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`);

  if (state?.workspaceRoot) {
    const workspaceSnapshotRoot = path.join(state.workspaceRoot, GOODECODE_CONFIG_DIR);
    fs.mkdirSync(workspaceSnapshotRoot, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceSnapshotRoot, "goodebot_personalization.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`
    );
  }

  return snapshot;
}

async function backupInstalledGoodebotApp(installed, state) {
  if (!installed?.path || !pathExists(installed.path) || installed.kind !== "app") {
    return "";
  }

  const installedBuild = {
    ...readGoodebotBuildInfo(installed.path),
    ...readGoodebotBundleInfo(installed.path),
  };
  const label = sanitizeFileToken(goodebotBuildLabel(installedBuild) || path.basename(installed.path));
  const workspaceToken = sanitizeFileToken(state?.workspaceName || "workspace");
  const backupPath = path.join(
    GOODEBOT_UPDATE_BACKUP_ROOT,
    `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${workspaceToken}-${label}.app`
  );

  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  await execFileAsync("ditto", [installed.path, backupPath]);
  return backupPath;
}

function writeGoodebotLegacyMigrationFile(state, targetBuild = {}, details = {}) {
  const targetLabel = goodebotBuildLabel(targetBuild);
  const legacyFileName = `LegacyV${sanitizeFileToken(targetLabel === "unknown" ? "current" : targetLabel)}.json`;
  const migration = {
    schema: "goodebot.legacy-migration",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "goodecode-vscode-extension",
    sourceWorkspace: {
      root: state?.workspaceRoot || "",
      name: state?.workspaceName || "",
      activeFile: state?.activePath || "",
      goodecodeRoot: state?.goodecodeRoot || "",
    },
    oldGoodebot: {
      appPath: details.oldAppPath || state?.goodebotInstalled?.path || "",
      build: details.oldBuild || state?.goodebotInstalledBuild || {},
    },
    targetGoodebot: {
      build: targetBuild,
      installPath: details.targetAppPath || GOODEBOT_DESTINATION_APP,
      sourcePath: details.sourcePath || "",
      appSourcePath: details.appSourcePath || "",
    },
    selectedProfile: goodebotProfileSnapshot(details.selectedProfile),
    preservedFiles: [
      path.join(GOODEBOT_APP_SUPPORT_ROOT, "goodebot_personalization.json"),
      state?.workspaceRoot ? path.join(state.workspaceRoot, GOODECODE_CONFIG_DIR, "goodebot_personalization.json") : "",
      details.selectedProfile?.path || "",
      details.selectedProfile?.appBundlePath || "",
      ...(Array.isArray(state?.goodecodeFiles) ? state.goodecodeFiles : []),
    ].filter(Boolean),
    backupPath: details.backupPath || "",
    migrationActions: [
      "detected active VS Code workspace",
      details.selectedProfile ? "selected a Goodebot robot profile to preserve" : "no Goodebot robot profile was selected",
      "saved Goodebot personalization snapshot",
      "recorded existing Goodebot build metadata",
      details.backupPath ? "backed up existing Goodebot.app" : "no installed app backup was needed",
      "prepared replacement Goodebot.app",
    ],
    warnings: state?.workspaceRoot ? [] : ["No VS Code workspace was open, so only the Application Support snapshot was written."],
    snapshot: details.snapshot || {},
  };

  fs.mkdirSync(GOODEBOT_APP_SUPPORT_ROOT, { recursive: true });
  const appSupportPath = path.join(GOODEBOT_APP_SUPPORT_ROOT, legacyFileName);
  fs.writeFileSync(appSupportPath, `${JSON.stringify(migration, null, 2)}\n`);

  if (!state?.workspaceRoot) {
    return appSupportPath;
  }

  const workspaceSnapshotRoot = path.join(state.workspaceRoot, GOODECODE_CONFIG_DIR);
  fs.mkdirSync(workspaceSnapshotRoot, { recursive: true });
  const workspacePath = path.join(workspaceSnapshotRoot, legacyFileName);
  fs.writeFileSync(workspacePath, `${JSON.stringify(migration, null, 2)}\n`);
  return workspacePath;
}

function sanitizeFileToken(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^v/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "current";
}

async function openWorkspaceFolderInOS() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage("Open a workspace folder first.");
    return;
  }
  await openTarget(workspaceFolder.uri.fsPath);
}

async function revealPathInOS(targetPath) {
  try {
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(targetPath));
  } catch {
    const fallbackTarget = pathExists(targetPath) && fs.statSync(targetPath).isDirectory()
      ? targetPath
      : path.dirname(targetPath);
    await openTarget(fallbackTarget);
  }
}

async function offerGoodebotImportHandoff(targetPath) {
  const targetDirectory = path.dirname(targetPath);
  const goodecodeRoot = path.basename(targetDirectory) === "src"
    ? path.dirname(targetDirectory)
    : targetDirectory;

  const choice = await vscode.window.showInformationMessage(
    `Ready: ${path.basename(targetPath)}`,
    "Reveal File",
    "Reveal Goodecode Project",
    "Open Goodebot"
  );

  if (choice === "Reveal File") {
    await revealPathInOS(targetPath);
    return;
  }

  if (choice === "Reveal Goodecode Project") {
    await revealPathInOS(goodecodeRoot);
    return;
  }

  if (choice === "Open Goodebot") {
    await openInstalledGoodebot();
  }
}

async function openSyntaxGuidePreview(preserveFocus) {
  const guideUri = vscode.Uri.file(BUNDLED_SYNTAX_GUIDE_PATH);
  try {
    await vscode.commands.executeCommand("markdown.showPreviewToSide", guideUri);
    if (preserveFocus) {
      await vscode.commands.executeCommand("workbench.action.focusPreviousGroup");
    }
  } catch (error) {
    await openFile(BUNDLED_SYNTAX_GUIDE_PATH);
    await vscode.window.showWarningMessage(`Could not open Markdown preview automatically: ${error.message}`);
  }
}

async function openFile(targetPath) {
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    await vscode.window.showErrorMessage(`Could not open ${targetPath}: ${error.message}`);
  }
}

function resolveWorkspacePaths(document) {
  const workspaceFolder = document
    ? (vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0])
    : vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return null;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const activePath = document?.uri?.scheme === "file" ? document.uri.fsPath : "";
  const activeDirectory = activePath ? path.dirname(activePath) : "";

  if (activeDirectory) {
    if (path.basename(activeDirectory) === "src") {
      const parentRoot = path.dirname(activeDirectory);
      if (path.basename(parentRoot) === "Goodecode" || parentRoot.toLowerCase().endsWith(".goodecode")) {
        return { workspaceRoot, goodecodeRoot: parentRoot };
      }
      return { workspaceRoot, goodecodeRoot: parentRoot };
    }

    if (path.basename(activeDirectory) === "Goodecode" || activeDirectory.toLowerCase().endsWith(".goodecode")) {
      return { workspaceRoot, goodecodeRoot: activeDirectory };
    }
  }

  const preferredRoot = resolvePreferredGoodecodeRoot(workspaceRoot, workspaceFolder.name);
  if (pathExists(preferredRoot)) {
    return { workspaceRoot, goodecodeRoot: preferredRoot };
  }

  if (directoryLooksLikeStandaloneGoodecodeProject(workspaceRoot)) {
    return { workspaceRoot, goodecodeRoot: workspaceRoot };
  }

  return { workspaceRoot, goodecodeRoot: preferredRoot };
}

function directoryLooksLikeStandaloneGoodecodeProject(directoryPath) {
  if (!pathExists(directoryPath)) {
    return false;
  }

  try {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      if (entry.name === "goodecode.toml" || isGoodecodeFile(entry.name)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

function collectGoodecodePythonFiles(goodecodeRoot) {
  if (!pathExists(goodecodeRoot)) {
    return [];
  }

  const skipped = new Set([".git", ".vscode", ".idea", "node_modules", "dist", "out", "__pycache__"]);
  const results = [];

  function walk(currentPath, depth) {
    if (depth > 5 || !pathExists(currentPath)) {
      return;
    }

    const stat = fs.statSync(currentPath);
    if (stat.isFile()) {
      const lower = currentPath.toLowerCase();
      if (lower.endsWith(".goode.py") || lower.endsWith(".py")) {
        results.push(currentPath);
      }
      return;
    }

    if (!stat.isDirectory()) {
      return;
    }

    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (skipped.has(entry.name)) {
        continue;
      }
      walk(path.join(currentPath, entry.name), depth + 1);
    }
  }

  walk(goodecodeRoot, 0);
  return results
    .filter((filePath) => !filePath.endsWith(GOODECODE_RUNTIME_FILE_NAME))
    .sort((lhs, rhs) => lhs.localeCompare(rhs));
}

function preferredPrimaryGoodecodeFile(files, fallbackPath) {
  const loweredFallback = fallbackPath ? fallbackPath.toLowerCase() : "";
  return files.find((filePath) => filePath.toLowerCase() === loweredFallback)
    || files.find((filePath) => filePath.toLowerCase().endsWith("robot.goode.py"))
    || files.find((filePath) => filePath.toLowerCase().endsWith(`${path.sep}src${path.sep}main.goode.py`))
    || files.find((filePath) => filePath.toLowerCase().endsWith("main.goode.py"))
    || files.find((filePath) => {
      const lower = filePath.toLowerCase();
      return lower.endsWith(".py") && !lower.includes("screen") && !lower.includes("tahera_template");
    })
    || files[0];
}

function extractFunctionBody(source, functionName) {
  const lines = source.split(/\r?\n/);
  const body = [];
  let capturing = false;
  let definitionIndent = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const indent = rawLine.match(/^\s*/)?.[0]?.length ?? 0;

    if (!capturing) {
      if (trimmed.startsWith(`def ${functionName}(`)) {
        capturing = true;
        definitionIndent = indent;
      }
      continue;
    }

    if (trimmed && indent <= definitionIndent && !trimmed.startsWith("#")) {
      break;
    }

    body.push(trimmed);
  }

  const joined = body.join("\n").trim();
  return joined || "";
}

function manifestValue(manifest, section, key) {
  if (!manifest) {
    return "";
  }

  const lines = manifest.split(/\r?\n/);
  let currentSection = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1).trim();
      continue;
    }
    if (currentSection.toLowerCase() !== section.toLowerCase()) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const rawKey = line.slice(0, separator).trim();
    if (rawKey.toLowerCase() !== key.toLowerCase()) {
      continue;
    }
    let value = line.slice(separator + 1).trim();
    const commentIndex = value.indexOf("#");
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trim();
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return "";
}

function goodecodeInlineMetadataValue(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^#\\s*@goodecode\\.${escapedKey}\\s*[:=]\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"),
    new RegExp(`^#\\s*goodecode\\.${escapedKey}\\s*[:=]\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function resolveGoodecodeProjectName({ manifest, sources, fallbackName }) {
  const manifestName = manifestValue(manifest, "project", "name");
  if (manifestName) {
    return manifestName;
  }

  for (const source of sources) {
    const inlineName = goodecodeInlineMetadataValue(source, "name");
    if (inlineName) {
      return inlineName;
    }
    const projectTitle = source.match(/ctx\.project_title\(\s*["']([^"']+)["']/)?.[1]?.trim();
    if (projectTitle) {
      return projectTitle;
    }
    const title = source.match(/ctx\.title\(\s*["']([^"']+)["']/)?.[1]?.trim();
    if (title) {
      return title;
    }
  }

  return fallbackName;
}

function resolveGoodecodeBrainIcon({ manifest, sources }) {
  const manifestIcon = manifestValue(manifest, "brain", "icon");
  if (manifestIcon) {
    return manifestIcon;
  }

  for (const source of sources) {
    const inlineIcon = goodecodeInlineMetadataValue(source, "icon");
    if (inlineIcon) {
      return inlineIcon;
    }
    const icon = source.match(/ctx\.use_brain_icon\(\s*["']([^"']+)["']/)?.[1]?.trim();
    if (icon) {
      return icon;
    }
  }

  return "goodecode";
}

function resolveGoodecodeSlotName({ manifest, sources, fallbackName }) {
  const manifestSlot = manifestValue(manifest, "export", "default_slot_name") || manifestValue(manifest, "project", "name");
  if (manifestSlot) {
    return manifestSlot;
  }

  for (const source of sources) {
    const inlineSlot = goodecodeInlineMetadataValue(source, "slot");
    if (inlineSlot) {
      return inlineSlot;
    }
  }

  return fallbackName;
}

function detectCallbacks(sources) {
  const callbackOrder = [
    "initialize",
    "configure_robot",
    "autonomous",
    "opcontrol",
    "when_started",
    "pre_auton",
    "vexcode_auton_function",
    "vexcode_driver_function",
    "build_info_screen",
  ];

  return callbackOrder.filter((name) => sources.some((source) => source.includes(`def ${name}(`)));
}

function extractScreenLines({ workspaceName, primaryScriptRelativePath, runtimeRelativePath, fileCount, sources }) {
  const lines = [];
  const pattern = /ctx\.(?:title|project_title|info|status)\(\s*["']([^"']+)["']/g;

  for (const source of sources) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        lines.push(match[1].trim());
      }
    }
  }

  const fallback = [
    workspaceName,
    "Goodecode Runtime Ready",
    `Primary: ${primaryScriptRelativePath}`,
    `Artifact: ${runtimeRelativePath}`,
    `Files: ${fileCount}`,
  ];

  const deduped = [];
  const seen = new Set();
  for (const line of (lines.length ? lines : fallback)) {
    const trimmed = line.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(trimmed);
  }
  return deduped;
}

function compileBasicSteps(sources) {
  const steps = [];

  for (const source of sources) {
    const relevant = [
      extractFunctionBody(source, "initialize"),
      extractFunctionBody(source, "pre_auton"),
      extractFunctionBody(source, "when_started"),
      extractFunctionBody(source, "autonomous"),
      extractFunctionBody(source, "vexcode_auton_function"),
    ].filter(Boolean).join("\n") || source;

    for (const rawLine of relevant.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const waitMatch = line.match(/(?:wait_ms|sleep_ms)\(\s*(-?\d+)/);
      if (waitMatch) {
        steps.push(`WAIT_MS,${Math.max(20, Math.abs(Number(waitMatch[1])))},0,0`);
        continue;
      }

      const driveMatch = line.match(/drive_for\(\s*(-?\d+(?:\.\d+)?)/);
      if (driveMatch) {
        const distance = Math.abs(Number(driveMatch[1] || 12));
        const speed = Math.abs(Number(line.match(/speed\s*=\s*(-?\d+)/)?.[1] || 70));
        const duration = Math.max(250, Math.min(2600, Math.round(distance * 32)));
        steps.push(`DRIVE_MS,${Math.max(20, Math.min(127, speed))},${duration},0`);
        continue;
      }

      const turnMatch = line.match(/(?:turn_to|turn_for)\(\s*(-?\d+(?:\.\d+)?)/);
      if (turnMatch) {
        steps.push(`TURN_HEADING,${Math.round(Number(turnMatch[1] || 45))},0,0`);
        continue;
      }

      if (line.includes("ctx.intake_on(") || line.includes("ctx.intake_on()")) {
        steps.push("INTAKE_ON,0,0,0");
        continue;
      }
      if (line.includes("ctx.intake_off(") || line.includes("ctx.intake_off()")) {
        steps.push("INTAKE_OFF,0,0,0");
        continue;
      }
      if (line.includes("ctx.outtake_on(") || line.includes("ctx.outtake_on()")) {
        steps.push("OUTTAKE_ON,0,0,0");
        continue;
      }
      if (line.includes("ctx.outtake_off(") || line.includes("ctx.outtake_off()")) {
        steps.push("OUTTAKE_OFF,0,0,0");
        continue;
      }
      if (line.includes("ctx.pneumatic_on(") || line.includes("ctx.pneumatic_on()")) {
        steps.push("PNEUMATIC_ON,0,0,0");
        continue;
      }
      if (line.includes("ctx.pneumatic_off(") || line.includes("ctx.pneumatic_off()")) {
        steps.push("PNEUMATIC_OFF,0,0,0");
      }
    }
  }

  if (!steps.length) {
    return [
      "WAIT_MS,200,0,0",
      "DRIVE_MS,60,650,0",
      "WAIT_MS,120,0,0",
    ];
  }

  return steps;
}

function buildGoodebotRuntimeArtifact({ workspaceName, primaryScriptRelativePath, brainIcon, slotName, pythonRelativePaths, sources }) {
  const runtimeRelativePath = `${GOODECODE_RUNTIME_DIR}/${GOODECODE_RUNTIME_FILE_NAME}`;
  const callbacks = detectCallbacks(sources);
  const summaryLines = [
    "Runtime artifact generated from Goodecode Python.",
    "Goodebot can load this file directly into the Digital Brain.",
    `Primary script: ${primaryScriptRelativePath}`,
    `Python files: ${pythonRelativePaths.length}`,
  ];

  if (callbacks.length) {
    summaryLines.push(`Callbacks detected: ${callbacks.join(", ")}`);
  }

  return {
    workspaceName,
    workspaceMode: "vscode-goodecode",
    generatedAtISO8601: new Date().toISOString(),
    primaryScriptRelativePath,
    brainIcon,
    slotName,
    pythonRelativePaths,
    screenLines: extractScreenLines({
      workspaceName,
      primaryScriptRelativePath,
      runtimeRelativePath,
      fileCount: pythonRelativePaths.length,
      sources,
    }),
    summaryLines,
    basicSteps: compileBasicSteps(sources),
  };
}

function renderGoodebotRuntimeFile(artifact) {
  const sections = [
    "# Goodebot Goodecode Runtime v1",
    "",
    "[METADATA]",
    `Workspace: ${artifact.workspaceName}`,
    `Workspace Mode: ${artifact.workspaceMode}`,
    `Generated At: ${artifact.generatedAtISO8601}`,
    `Primary Script: ${artifact.primaryScriptRelativePath}`,
    `Brain Icon: ${artifact.brainIcon}`,
    `Slot Name: ${artifact.slotName}`,
    "",
    "[PYTHON FILES]",
    ...artifact.pythonRelativePaths,
    "",
    "[SCREEN]",
    ...artifact.screenLines,
    "",
    "[SUMMARY]",
    ...artifact.summaryLines,
    "",
    "[BASIC]",
    ...artifact.basicSteps,
    "",
  ];

  return sections.join("\n");
}

async function prepareGoodebotBuild(editorDocument) {
  const activeDocument = editorDocument && isConvertableGoodecodeDocument(editorDocument)
    ? editorDocument
    : undefined;

  if (activeDocument?.isDirty) {
    await activeDocument.save();
  }

  const paths = resolveWorkspacePaths(activeDocument);
  if (!paths) {
    throw new Error("Open a Goodecode workspace folder first.");
  }

  const { workspaceRoot, goodecodeRoot } = paths;
  const pythonFiles = collectGoodecodePythonFiles(goodecodeRoot);
  if (!pythonFiles.length) {
    throw new Error("No Goodecode Python files were found in this workspace.");
  }

  const primaryPath = preferredPrimaryGoodecodeFile(pythonFiles, activeDocument?.uri.fsPath || "");
  const sources = pythonFiles.map((filePath) => fs.readFileSync(filePath, "utf8"));
  const relativePaths = pythonFiles.map((filePath) => toDisplayPath(filePath, goodecodeRoot).replaceAll(path.sep, "/"));
  const runtimeRoot = path.join(goodecodeRoot, GOODECODE_RUNTIME_DIR);
  const runtimePath = path.join(runtimeRoot, GOODECODE_RUNTIME_FILE_NAME);
  const manifestPath = path.join(goodecodeRoot, "goodecode.toml");
  const manifest = pathExists(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : "";
  const fallbackName = path.basename(primaryPath, path.extname(primaryPath)) || path.basename(workspaceRoot);
  const workspaceName = resolveGoodecodeProjectName({
    manifest,
    sources,
    fallbackName,
  });
  const brainIcon = resolveGoodecodeBrainIcon({ manifest, sources });
  const slotName = resolveGoodecodeSlotName({
    manifest,
    sources,
    fallbackName: workspaceName,
  });
  const artifact = buildGoodebotRuntimeArtifact({
    workspaceName,
    primaryScriptRelativePath: toDisplayPath(primaryPath, goodecodeRoot).replaceAll(path.sep, "/"),
    brainIcon,
    slotName,
    pythonRelativePaths: relativePaths,
    sources,
  });
  const runtimeContents = renderGoodebotRuntimeFile(artifact);

  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(runtimePath, runtimeContents, "utf8");

  return {
    workspaceRoot,
    goodecodeRoot,
    runtimeRoot,
    runtimePath,
    runtimeContents,
    artifact,
  };
}

async function buildForGoodebot(options = {}) {
  try {
    const result = await prepareGoodebotBuild(vscode.window.activeTextEditor?.document);
    if (options.revealRuntimeFile) {
      await openFile(result.runtimePath);
    }
    if (options.notify !== false) {
      await vscode.window.showInformationMessage("Goodebot runtime build finished for this Goodecode workspace.");
    }
    return result;
  } catch (error) {
    await vscode.window.showWarningMessage(error.message);
    return null;
  }
}

async function convertActiveDocumentForGoodebot() {
  await buildForGoodebot({ revealRuntimeFile: true });
}

async function buildWorkspaceForGoodebot() {
  await buildForGoodebot({ revealRuntimeFile: false });
}

async function createStarterFiles() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage("Open a folder in VS Code before creating starter files.");
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const workspaceName = path.basename(workspaceRoot);
  const goodecodeRoot = ensureGoodecodeRootForWrite(workspaceRoot, workspaceName);
  const srcRoot = path.join(goodecodeRoot, "src");
  const vscodeRoot = path.join(goodecodeRoot, ".vscode");

  fs.mkdirSync(srcRoot, { recursive: true });
  fs.mkdirSync(vscodeRoot, { recursive: true });

  const manifestPath = path.join(goodecodeRoot, "goodecode.toml");
  const mainPath = path.join(srcRoot, "main.goode.py");
  const extensionsPath = path.join(vscodeRoot, "extensions.json");

  writeIfMissing(manifestPath, goodecodeManifestContents(workspaceName));
  writeIfMissing(mainPath, mainTemplateContents(workspaceName));
  writeIfMissing(
    extensionsPath,
    `{
  "recommendations": [
    "BanSextus.goodecode",
    "ms-python.python",
    "ms-python.vscode-pylance"
  ]
}
`
  );

  await openFile(mainPath);
  await offerGoodebotImportHandoff(mainPath);
}

async function createScreenTemplate() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage("Open a folder in VS Code before creating a brain screen file.");
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const workspaceName = path.basename(workspaceRoot);
  const screenRoot = path.join(ensureGoodecodeRootForWrite(workspaceRoot, workspaceName), "src");
  const screenPath = path.join(screenRoot, "screen.goode.py");

  fs.mkdirSync(screenRoot, { recursive: true });
  writeIfMissing(screenPath, screenTemplateContents(workspaceName));

  await openFile(screenPath);
  await offerGoodebotImportHandoff(screenPath);
}

async function createSingleScriptTemplate() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    await vscode.window.showWarningMessage("Open a folder in VS Code before creating a one-script Python file.");
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const workspaceName = path.basename(workspaceRoot);
  const goodecodeRoot = ensureGoodecodeRootForWrite(workspaceRoot, workspaceName);
  const vscodeRoot = path.join(goodecodeRoot, ".vscode");
  fs.mkdirSync(vscodeRoot, { recursive: true });

  const requestedName = await vscode.window.showInputBox({
    title: "Create One-Script Python File",
    prompt: "Choose a file name for the manual Goodecode Python robot file.",
    placeHolder: "robot.goode.py",
    value: "robot.goode.py",
    validateInput: (value) => {
      if (!value.trim()) {
        return "Enter a file name.";
      }
      if (value.includes("/") || value.includes("\\")) {
        return "Use only a file name here, not a folder path.";
      }
      return null;
    },
  });

  if (!requestedName) {
    return;
  }

  const normalizedName = normalizeGoodecodeFileName(requestedName.trim());
  const singleScriptPath = path.join(goodecodeRoot, normalizedName);
  const extensionsPath = path.join(vscodeRoot, "extensions.json");
  const settingsPath = path.join(vscodeRoot, "settings.json");
  writeIfMissing(
    extensionsPath,
    `{
  "recommendations": [
    "BanSextus.goodecode",
    "ms-python.python",
    "ms-python.vscode-pylance"
  ]
}
`
  );
  writeIfMissing(
    settingsPath,
    `{
  "files.associations": {
    "*.goode.py": "goodecode",
    "*.goodecode": "goodecode"
  }
}
`
  );

  if (pathExists(singleScriptPath)) {
    await openFile(singleScriptPath);
    await offerGoodebotImportHandoff(singleScriptPath);
    return;
  }

  fs.writeFileSync(singleScriptPath, singleScriptTemplateContents(workspaceName), "utf8");

  await openFile(singleScriptPath);
  await offerGoodebotImportHandoff(singleScriptPath);
}

async function insertSnippetIntoActiveEditor(code) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    await vscode.window.showWarningMessage("Open a .goode.py file first, then insert a snippet.");
    return;
  }

  await editor.insertSnippet(new vscode.SnippetString(code), editor.selection.active);
}

function writeIfMissing(targetPath, contents) {
  if (!pathExists(targetPath)) {
    fs.writeFileSync(targetPath, contents, "utf8");
  }
}

function goodecodeManifestContents(workspaceName) {
  return `[project]
name = "${workspaceName}"
language = "python"
entry = "src/main.goode.py"

[brain]
icon = "goodecode"
credits = "Goodecode by BanSextus"

[editor]
extension = "bansextus.goodecode"
install_from = "visual-studio-marketplace"

[export]
target = "goodebot-runtime"
compatibility = "goodebot-digital-brain"
default_slot_name = "${workspaceName}"
runtime_artifact = "runtime/goodebot_runtime.txt"
`;
}

function mainTemplateContents(workspaceName) {
  return `# Goodecode is the Python-first native workflow for Goodebot.
# This starter is the default authoring shape for created workspaces.

from typing import Any


def initialize(ctx: Any) -> None:
    ctx.project_title("${workspaceName}")
    ctx.status("Goodecode starter ready")
    ctx.use_brain_icon("goodecode")


def configure_robot(ctx: Any) -> None:
    left_drive = ctx.motor_group(ports=[-1, -2], name="Left Drive")
    right_drive = ctx.motor_group(ports=[3, 4], name="Right Drive")
    intake = ctx.motor(port=5, name="Intake")
    outake = ctx.motor(port=-6, name="Outake")
    _ = (left_drive, right_drive, intake, outake)


def autonomous(ctx: Any) -> None:
    ctx.status("Autonomous placeholder")


def opcontrol(ctx: Any) -> None:
    ctx.status("Driver control placeholder")
    while ctx.enabled():
        ctx.sleep_ms(20)
`;
}

function screenTemplateContents(workspaceName) {
  return `# Goodecode default Brain UI
# Pages: Home, Auton, Controls, Status.
# Touch targets are sized for the V5 Brain screen, not desktop precision.

def build_info_screen(ctx):
    ctx.title("${workspaceName}")
    ctx.info("Home: project launch and quick state")
    ctx.info("Auton: choose and save slots")
    ctx.info("Controls: run project actions")
    ctx.info("Status: touch and hardware info")
    ctx.hardware_status()
    ctx.allow_project_ui_switch(True)
    ctx.screen_button(title="Auton", x=0.18, y=0.38, w=0.28, h=0.18, action="Open Page")
    ctx.screen_button(title="Controls", x=0.50, y=0.38, w=0.28, h=0.18, action="Open Page")
    ctx.screen_button(title="Status", x=0.82, y=0.38, w=0.28, h=0.18, action="Open Page")
    ctx.screen_button(title="Save Slot", x=0.31, y=0.70, w=0.42, h=0.18, action="Save Selected Slot")
    ctx.screen_button(title="Run Selected", x=0.76, y=0.70, w=0.38, h=0.18, action="Run Selected Slot")
`;
}

function singleScriptTemplateContents(workspaceName) {
  return `# Goodecode one-file mode
# Robot logic, setup, and brain UI live in this file.
# @goodecode.name: ${workspaceName}
# @goodecode.icon: goodecode
# @goodecode.slot: ${workspaceName}

from typing import Any


def initialize(ctx: Any) -> None:
    ctx.project_title("${workspaceName}")
    ctx.status("Goodecode one-file ready")
    ctx.use_brain_icon("goodecode")
    configure_robot(ctx)


def configure_robot(ctx: Any) -> None:
    left_drive = ctx.motor_group(ports=[-1, -2], name="Left Drive")
    right_drive = ctx.motor_group(ports=[3, 4], name="Right Drive")
    intake = ctx.motor(port=5, name="Intake")
    outake = ctx.motor(port=-6, name="Outake")
    _ = (left_drive, right_drive, intake, outake)


def autonomous(ctx: Any) -> None:
    ctx.status("Autonomous ready")
    ctx.drive_for(24, units="in", speed=70)
    ctx.turn_to(90, units="deg", speed=60)
    ctx.wait_ms(250)


def opcontrol(ctx: Any) -> None:
    ctx.status("Driver control ready")
    while ctx.enabled():
        ctx.sleep_ms(20)


def build_info_screen(ctx: Any) -> None:
    ctx.title("${workspaceName}")
    ctx.info("Home: project launch and quick state")
    ctx.info("Auton: choose and save slots")
    ctx.info("Controls: run project actions")
    ctx.info("Status: touch and hardware info")
    ctx.hardware_status()
    ctx.allow_project_ui_switch(True)
    ctx.screen_button(title="Auton", x=0.18, y=0.38, w=0.28, h=0.18, action="Open Page")
    ctx.screen_button(title="Controls", x=0.50, y=0.38, w=0.28, h=0.18, action="Open Page")
    ctx.screen_button(title="Status", x=0.82, y=0.38, w=0.28, h=0.18, action="Open Page")
    ctx.screen_button(title="Save Slot", x=0.31, y=0.70, w=0.42, h=0.18, action="Save Selected Slot")
    ctx.screen_button(title="Run Selected", x=0.76, y=0.70, w=0.38, h=0.18, action="Run Selected Slot")
`;
}

function normalizeGoodecodeFileName(value) {
  const baseName = path.basename(value);
  if (baseName.endsWith(".goode.py")) {
    return baseName;
  }
  if (baseName.endsWith(".py")) {
    return `${baseName.slice(0, -3)}.goode.py`;
  }
  return `${baseName}.goode.py`;
}

function findGoodecodeFiles(workspaceRoot) {
  const results = [];
  const roots = uniqueStrings([resolvePreferredGoodecodeRoot(workspaceRoot), workspaceRoot]);
  const skipped = new Set([
    ".build",
    ".git",
    ".next",
    ".swiftpm",
    ".vscode",
    "DerivedData",
    "build",
    "builds",
    "dist",
    "node_modules",
    "out",
    "target",
    "third_party",
  ]);
  const seen = new Set();
  const scanStartedAt = Date.now();

  function shouldStopScanning() {
    return results.length >= 12 || Date.now() - scanStartedAt > GOODECODE_FILE_SCAN_BUDGET_MS;
  }

  function walk(currentPath, depth) {
    if (shouldStopScanning() || depth > 3 || !pathExists(currentPath)) {
      return;
    }

    let stat;
    try {
      stat = fs.statSync(currentPath);
    } catch {
      return;
    }

    if (stat.isFile()) {
      if (isGoodecodeFile(currentPath) && !seen.has(currentPath)) {
        seen.add(currentPath);
        results.push(currentPath);
      }
      return;
    }

    if (!stat.isDirectory()) {
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (skipped.has(entry.name)) {
        continue;
      }
      walk(path.join(currentPath, entry.name), depth + 1);
      if (shouldStopScanning()) {
        return;
      }
    }
  }

  for (const root of roots) {
    walk(root, 0);
    if (shouldStopScanning()) {
      break;
    }
  }

  return results.sort((lhs, rhs) => lhs.localeCompare(rhs));
}

function isGoodecodeFile(filePath) {
  return filePath.endsWith(".goode.py") || filePath.endsWith(".goodecode") || filePath.endsWith("robot.py");
}

function findAppBundle(rootPath) {
  if (!pathExists(rootPath)) {
    return null;
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".app")) {
      return entryPath;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const nested = findAppBundle(path.join(rootPath, entry.name));
    if (nested) {
      return nested;
    }
  }

  return null;
}

async function openTarget(target) {
  if (/^https?:/i.test(target)) {
    await vscode.env.openExternal(vscode.Uri.parse(target));
    return;
  }

  if (process.platform === "darwin" && typeof target === "string" && target.toLowerCase().endsWith(".app")) {
    await prepareMacAppForLaunch(target);
  }

  await new Promise((resolve, reject) => {
    const platform = process.platform;
    let command;
    let args;

    if (platform === "darwin") {
      command = "open";
      args = [target];
    } else if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", target];
    } else {
      command = "xdg-open";
      args = [target];
    }

    childProcess.execFile(command, args, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  }).catch(async (error) => {
    await vscode.window.showErrorMessage(`Could not open ${target}: ${error.message}`);
  });
}

async function prepareMacAppForLaunch(appPath) {
  if (!pathExists(appPath)) {
    return;
  }

  await execFileAsync("xattr", ["-dr", "com.apple.quarantine", appPath]).catch(() => {});
  await execFileAsync("chmod", ["-R", "a+rX", appPath]).catch(() => {});

  const macOSDir = path.join(appPath, "Contents", "MacOS");
  if (pathExists(macOSDir)) {
    await execFileAsync("chmod", ["-R", "a+rx", macOSDir]).catch(() => {});
  }
}

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr?.trim() || stdout?.trim() || error.message;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function fetchJson(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects while checking Goodebot updates."));
      return;
    }

    const parsed = new URL(urlString);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Goodecode-Updater",
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          const redirectedUrl = new URL(response.headers.location, parsed).toString();
          fetchJson(redirectedUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Update check failed with status ${response.statusCode ?? "unknown"}.`));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
  });
}

function fetchText(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects while downloading Goodebot build info."));
      return;
    }

    const parsed = new URL(urlString);
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.get(
      parsed,
      {
        headers: {
          Accept: "text/plain, application/octet-stream",
          "User-Agent": "Goodecode-Updater",
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          const redirectedUrl = new URL(response.headers.location, parsed).toString();
          fetchText(redirectedUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Build info download failed with status ${response.statusCode ?? "unknown"}.`));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => resolve(body));
      }
    );

    request.on("error", reject);
  });
}

function downloadFile(urlString, targetPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects while downloading Goodebot."));
      return;
    }

    const parsed = new URL(urlString);
    const client = parsed.protocol === "http:" ? http : https;

    const request = client.get(parsed, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const redirectedUrl = new URL(response.headers.location, parsed).toString();
        downloadFile(redirectedUrl, targetPath, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with status ${response.statusCode ?? "unknown"}.`));
        return;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const fileStream = fs.createWriteStream(targetPath);

      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close(() => resolve(targetPath));
      });
      fileStream.on("error", (error) => {
        fileStream.close(() => reject(error));
      });
    });

    request.on("error", reject);
  });
}

function pathExists(targetPath) {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function toDisplayPath(filePath, workspaceRoot) {
  if (!workspaceRoot || !filePath.startsWith(workspaceRoot)) {
    return filePath;
  }
  return path.relative(workspaceRoot, filePath);
}

function imageDataUri(filePath, mimeType) {
  try {
    const bytes = fs.readFileSync(filePath);
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function createNonce() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 16; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

module.exports = {
  activate,
  deactivate,
};
