# Workspace Kanban

A simple kanban board in the VS Code activity bar. Each workspace has its own board, stored in `.vscode/kanban.json` (configurable via `kanban.file`). The file is watched, so edits made outside the board show up live.

- Type in **+ Add card** and press Enter to add a card
- Drag cards between and within columns
- Double-click a card to edit (Enter saves, Shift+Enter for newline, Esc cancels)
- Hover a card and click × to delete
- **Projects**: click **+ Project** to create one; use the dropdown to filter the board to a project
- Cards added while a project is selected belong to it; hover a card and click # (or click its chip) to reassign
- Rename/delete projects from the board's `...` title-bar menu
- Title-bar buttons: open the board in a full editor tab, or clear the board
- Change columns with the `kanban.columns` setting
- Click a column title to collapse/expand it; click **Top** to show only the top card(s) (`kanban.topCount`, default 1)

## Getting started

1. Install **Workspace Kanban** from the Extensions view.
2. Click the Kanban icon in the activity bar.
3. Add your first card. The board file is created on first save.

Commit `.vscode/kanban.json` to share the board with your team, or add it to `.gitignore` to keep it personal.
