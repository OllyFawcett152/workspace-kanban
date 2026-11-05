const vscode = require("vscode");

const CARDS_KEY = "kanban.cards";
const PROJECTS_KEY = "kanban.projects";
const PROJECT_COLOURS = ["blue", "green", "orange", "purple", "red", "yellow"];

function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyBoard() {
    return { projects: [], cards: [] };
}

function parseBoard(text) {
    const parsed = JSON.parse(text);
    return {
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    };
}

class BoardStorage {
    /** Base class for board persistence backends. */
    async read() {
        throw new Error("not implemented");
    }

    async write(board) {
        throw new Error("not implemented");
    }

    watch(onChange) {
        return { dispose() {} };
    }
}

class MementoStorage extends BoardStorage {
    /** Stores the board in VS Code workspace state; used when no folder is open. */
    constructor(memento) {
        super();
        this.memento = memento;
    }

    async read() {
        const projects = this.memento.get(PROJECTS_KEY, []);
        const cards = this.memento.get(CARDS_KEY, []);
        return projects.length || cards.length ? { projects, cards } : null;
    }

    async write(board) {
        await this.memento.update(PROJECTS_KEY, board.projects);
        await this.memento.update(CARDS_KEY, board.cards);
    }
}

class FileStorage extends BoardStorage {
    /** Stores the board as JSON in the workspace so external tools can edit it. */
    constructor(folder, relativePath) {
        super();
        this.folder = folder;
        this.relativePath = relativePath;
        this.uri = vscode.Uri.joinPath(folder.uri, ...relativePath.split("/"));
        this.lastText = null;
    }

    async readText() {
        try {
            return new TextDecoder().decode(await vscode.workspace.fs.readFile(this.uri));
        } catch (err) {
            if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
                return null;
            }
            throw err;
        }
    }

    async read() {
        const text = await this.readText();
        this.lastText = text;
        return text === null ? null : parseBoard(text);
    }

    async write(board) {
        const text = JSON.stringify(board, null, 2) + "\n";
        this.lastText = text;
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.uri, ".."));
        await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(text));
    }

    watch(onChange) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.folder, this.relativePath));
        const reload = async () => {
            const text = await this.readText();
            if (text === this.lastText) return;
            this.lastText = text;
            try {
                onChange(text === null ? emptyBoard() : parseBoard(text));
            } catch (err) {
                vscode.window.showWarningMessage(`Kanban: could not parse ${this.relativePath}: ${err.message}`);
            }
        };
        watcher.onDidChange(reload);
        watcher.onDidCreate(reload);
        watcher.onDidDelete(reload);
        return watcher;
    }
}

class BoardStore {
    /** Holds the board in memory, persists it via a storage backend and notifies listeners on change. */
    constructor(context) {
        this.context = context;
        this.listeners = new Set();
        this.board = emptyBoard();
        this.storage = null;
        this.watcher = null;
        this.ready = Promise.resolve();
    }

    reload() {
        this.ready = this.load();
        return this.ready;
    }

    async load() {
        if (this.watcher) this.watcher.dispose();
        const memento = new MementoStorage(this.context.workspaceState);
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            this.storage = memento;
            this.board = (await memento.read()) || emptyBoard();
        } else {
            this.storage = new FileStorage(folder, vscode.workspace.getConfiguration("kanban").get("file"));
            let board;
            try {
                board = await this.storage.read();
            } catch (err) {
                vscode.window.showWarningMessage(`Kanban: could not parse ${this.storage.relativePath}: ${err.message}`);
                board = emptyBoard();
            }
            const legacy = board ? null : await memento.read();
            this.board = board || legacy || emptyBoard();
            if (legacy) await this.storage.write(this.board);
            this.watcher = this.storage.watch((updated) => {
                this.board = updated;
                this.notify(null);
            });
        }
        this.notify(null);
    }

    dispose() {
        if (this.watcher) this.watcher.dispose();
    }

    get columns() {
        return vscode.workspace.getConfiguration("kanban").get("columns");
    }

    get cards() {
        return this.board.cards;
    }

    get projects() {
        return this.board.projects;
    }

    async save(source) {
        await this.storage.write(this.board);
        this.notify(source);
    }

    async setCards(cards, source) {
        this.board = { ...this.board, cards };
        await this.save(source);
    }

    async setProjects(projects) {
        this.board = { ...this.board, projects };
        await this.save(null);
    }

    async addProject(name) {
        const projects = this.projects;
        const colour = PROJECT_COLOURS[projects.length % PROJECT_COLOURS.length];
        const project = { id: newId(), name, colour };
        await this.setProjects([...projects, project]);
        return project;
    }

    async renameProject(id, name) {
        await this.setProjects(this.projects.map((p) => (p.id === id ? { ...p, name } : p)));
    }

    async deleteProject(id, deleteCards) {
        const cards = deleteCards
            ? this.cards.filter((c) => c.projectId !== id)
            : this.cards.map((c) => (c.projectId === id ? { ...c, projectId: null } : c));
        this.board = { projects: this.projects.filter((p) => p.id !== id), cards };
        await this.save(null);
    }

    async assignProject(cardId, projectId) {
        await this.setCards(this.cards.map((c) => (c.id === cardId ? { ...c, projectId } : c)), null);
    }

    notify(source) {
        for (const listener of this.listeners) {
            if (listener !== source) {
                listener.postState();
            }
        }
    }

    broadcast(message) {
        for (const listener of this.listeners) {
            listener.post(message);
        }
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }
}

class ProjectPrompts {
    /** Native VS Code prompts for managing projects. */
    constructor(store) {
        this.store = store;
    }

    async pickProject(placeHolder, extraItems = []) {
        const items = [
            ...extraItems,
            ...this.store.projects.map((p) => ({ label: p.name, id: p.id })),
        ];
        if (!items.length) {
            vscode.window.showInformationMessage("No projects yet. Add one first.");
            return undefined;
        }
        return vscode.window.showQuickPick(items, { placeHolder });
    }

    async add() {
        const name = await vscode.window.showInputBox({ prompt: "Project name", validateInput: (v) => (v.trim() ? null : "Name required") });
        if (name) {
            const project = await this.store.addProject(name.trim());
            this.store.broadcast({ type: "selectProject", projectId: project.id });
        }
    }

    async rename() {
        const pick = await this.pickProject("Project to rename");
        if (!pick) return;
        const name = await vscode.window.showInputBox({ prompt: "New name", value: pick.label, validateInput: (v) => (v.trim() ? null : "Name required") });
        if (name) {
            await this.store.renameProject(pick.id, name.trim());
        }
    }

    async remove() {
        const pick = await this.pickProject("Project to delete");
        if (!pick) return;
        const choice = await vscode.window.showWarningMessage(
            `Delete project "${pick.label}"?`,
            { modal: true },
            "Keep Its Cards",
            "Delete Its Cards"
        );
        if (choice) {
            await this.store.deleteProject(pick.id, choice === "Delete Its Cards");
        }
    }

    async assign(cardId) {
        const pick = await this.pickProject("Assign card to project", [{ label: "$(circle-slash) No project", id: null }]);
        if (pick) {
            await this.store.assignProject(cardId, pick.id);
        }
    }
}

class BoardWebview {
    /** Base class wiring a webview to the board store. */
    constructor(context, store, prompts) {
        this.context = context;
        this.store = store;
        this.prompts = prompts;
        this.webview = null;
    }

    attach(webview, disposables) {
        this.webview = webview;
        const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
        webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
        webview.html = this.html(webview, mediaRoot);
        disposables.push(
            webview.onDidReceiveMessage((message) => this.onMessage(message)),
            this.store.subscribe(this)
        );
    }

    onMessage(message) {
        if (message.type === "ready") {
            this.store.ready.then(() => this.postState());
        } else if (message.type === "update") {
            this.store.setCards(message.cards, this);
        } else if (message.type === "addProject") {
            this.prompts.add();
        } else if (message.type === "assignProject") {
            this.prompts.assign(message.cardId);
        }
    }

    post(message) {
        if (this.webview) {
            this.webview.postMessage(message);
        }
    }

    postState() {
        this.post({
            type: "state",
            columns: this.store.columns,
            cards: this.store.cards,
            projects: this.store.projects,
            topCount: vscode.workspace.getConfiguration("kanban").get("topCount"),
        });
    }

    html(webview, mediaRoot) {
        const nonce = Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join("");
        const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "board.js"));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "board.css"));
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${style}" rel="stylesheet">
</head>
<body>
<div id="toolbar"></div>
<div id="board"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }
}

class BoardViewProvider extends BoardWebview {
    /** Sidebar view shown in the activity bar container. */
    resolveWebviewView(view) {
        const disposables = [];
        this.attach(view.webview, disposables);
        view.onDidChangeVisibility(() => view.visible && this.postState(), null, disposables);
        view.onDidDispose(() => disposables.forEach((d) => d.dispose()));
    }
}

class BoardPanel extends BoardWebview {
    /** Full editor-tab view of the board. */
    static current = null;

    static show(context, store, prompts) {
        if (BoardPanel.current) {
            BoardPanel.current.panel.reveal();
            return;
        }
        BoardPanel.current = new BoardPanel(context, store, prompts);
    }

    constructor(context, store, prompts) {
        super(context, store, prompts);
        this.panel = vscode.window.createWebviewPanel("kanban.panel", "Kanban Board", vscode.ViewColumn.Active, {
            retainContextWhenHidden: true,
        });
        this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "kanban.png");
        const disposables = [];
        this.attach(this.panel.webview, disposables);
        this.panel.onDidDispose(() => {
            disposables.forEach((d) => d.dispose());
            BoardPanel.current = null;
        });
    }
}

function activate(context) {
    const store = new BoardStore(context);
    store.reload();
    const prompts = new ProjectPrompts(store);
    const provider = new BoardViewProvider(context, store, prompts);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("kanban.board", provider, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        vscode.commands.registerCommand("kanban.openPanel", () => BoardPanel.show(context, store, prompts)),
        vscode.commands.registerCommand("kanban.addProject", () => prompts.add()),
        vscode.commands.registerCommand("kanban.renameProject", () => prompts.rename()),
        vscode.commands.registerCommand("kanban.deleteProject", () => prompts.remove()),
        vscode.commands.registerCommand("kanban.clear", async () => {
            const choice = await vscode.window.showWarningMessage("Delete all cards on this board?", { modal: true }, "Clear");
            if (choice === "Clear") {
                await store.setCards([], null);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("kanban.file")) {
                store.reload();
            } else if (e.affectsConfiguration("kanban.columns") || e.affectsConfiguration("kanban.topCount")) {
                store.notify(null);
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => store.reload()),
        store
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
