(function () {
    const vscode = acquireVsCodeApi();
    const FILTER_ALL = "__all__";
    const FILTER_NONE = "__none__";
    const MODE_FULL = "full";
    const MODE_TOP = "top";
    const MODE_COLLAPSED = "collapsed";
    const toolbarEl = document.getElementById("toolbar");
    const boardEl = document.getElementById("board");
    let columns = [];
    let cards = [];
    let projects = [];
    const saved = vscode.getState() || {};
    let filter = saved.filter || FILTER_ALL;
    let modes = saved.modes || {};
    let topCount = 1;
    let draggedId = null;

    function save() {
        vscode.postMessage({ type: "update", cards });
    }

    function persist() {
        vscode.setState({ filter, modes });
    }

    function setFilter(value) {
        filter = value;
        persist();
        render();
    }

    function modeOf(column) {
        return modes[column] || MODE_FULL;
    }

    function setMode(column, mode) {
        modes = { ...modes, [column]: mode };
        persist();
        render();
    }

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function projectById(id) {
        return projects.find((p) => p.id === id);
    }

    function normalise() {
        cards = cards.map((c) => ({
            ...c,
            column: columns.includes(c.column) ? c.column : columns[0],
            projectId: projectById(c.projectId) ? c.projectId : null,
        }));
        if (filter !== FILTER_ALL && filter !== FILTER_NONE && !projectById(filter)) {
            setFilter(FILTER_ALL);
        }
    }

    function isVisible(card) {
        if (filter === FILTER_ALL) return true;
        if (filter === FILTER_NONE) return !card.projectId;
        return card.projectId === filter;
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function dropIndex(list, y) {
        const items = [...list.querySelectorAll(".card:not(.dragging)")];
        const index = items.findIndex((item) => {
            const box = item.getBoundingClientRect();
            return y < box.top + box.height / 2;
        });
        return index === -1 ? items.length : index;
    }

    function moveCard(id, column, index) {
        const card = cards.find((c) => c.id === id);
        if (!card) return;
        const rest = cards.filter((c) => c.id !== id);
        const visible = rest.filter((c) => c.column === column && isVisible(c));
        const anchor = visible[index];
        const at = anchor ? rest.indexOf(anchor) : rest.length;
        rest.splice(at, 0, { ...card, column });
        cards = rest;
        save();
        render();
    }

    function editCard(textEl, card) {
        const input = el("textarea", "edit");
        input.value = card.text;
        textEl.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = (commit) => {
            if (done) return;
            done = true;
            const value = input.value.trim();
            if (commit && value && value !== card.text) {
                card.text = value;
                save();
            }
            render();
        };
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                finish(true);
            } else if (e.key === "Escape") {
                finish(false);
            }
        });
    }

    function renderChip(project, cardId) {
        const chip = el("button", `chip colour-${project.colour}`, project.name);
        chip.title = "Change project";
        chip.addEventListener("click", () => vscode.postMessage({ type: "assignProject", cardId }));
        return chip;
    }

    function renderCard(card) {
        const cardEl = el("div", "card");
        cardEl.draggable = true;
        const project = projectById(card.projectId);
        if (project) {
            cardEl.classList.add(`edge-${project.colour}`);
        }
        const text = el("div", "card-text", card.text);
        const actions = el("div", "card-actions");
        const assign = el("button", "card-action", "#");
        assign.title = "Assign to project";
        assign.addEventListener("click", () => vscode.postMessage({ type: "assignProject", cardId: card.id }));
        const del = el("button", "card-action delete", "×");
        del.title = "Delete card";
        del.addEventListener("click", () => {
            cards = cards.filter((c) => c.id !== card.id);
            save();
            render();
        });
        actions.append(assign, del);
        text.addEventListener("dblclick", () => editCard(text, card));
        cardEl.addEventListener("dragstart", (e) => {
            draggedId = card.id;
            e.dataTransfer.effectAllowed = "move";
            requestAnimationFrame(() => cardEl.classList.add("dragging"));
        });
        cardEl.addEventListener("dragend", () => {
            draggedId = null;
            cardEl.classList.remove("dragging");
            document.querySelectorAll(".over").forEach((n) => n.classList.remove("over"));
        });
        cardEl.append(text, actions);
        if (project && filter === FILTER_ALL) {
            cardEl.append(renderChip(project, card.id));
        }
        return cardEl;
    }

    function renderColumn(column) {
        const colCards = cards.filter((c) => c.column === column && isVisible(c));
        const mode = modeOf(column);
        const collapsed = mode === MODE_COLLAPSED;
        const shown = mode === MODE_TOP ? colCards.slice(0, topCount) : collapsed ? [] : colCards;
        const col = el("section", `column mode-${mode}`);
        const header = el("header", "column-header");
        const toggle = el("button", "column-toggle");
        toggle.title = collapsed ? "Expand column" : "Collapse column";
        toggle.append(el("span", "chevron", collapsed ? "▸" : "▾"), el("span", "column-title", column));
        toggle.addEventListener("click", () => setMode(column, collapsed ? MODE_FULL : MODE_COLLAPSED));
        const top = el("button", `top-toggle${mode === MODE_TOP ? " active" : ""}`, "Top");
        top.title = mode === MODE_TOP ? "Show all cards" : `Show only the top ${topCount}`;
        top.addEventListener("click", () => setMode(column, mode === MODE_TOP ? MODE_FULL : MODE_TOP));
        header.append(toggle, top, el("span", "count", String(colCards.length)));
        const list = el("div", "card-list");
        shown.forEach((card) => list.append(renderCard(card)));
        const hidden = colCards.length - shown.length;
        const more = hidden > 0 && !collapsed ? el("button", "more", `+${hidden} more`) : null;
        if (more) more.addEventListener("click", () => setMode(column, MODE_FULL));

        col.addEventListener("dragover", (e) => {
            if (!draggedId) return;
            e.preventDefault();
            col.classList.add("over");
        });
        col.addEventListener("dragleave", (e) => {
            if (!col.contains(e.relatedTarget)) col.classList.remove("over");
        });
        col.addEventListener("drop", (e) => {
            e.preventDefault();
            col.classList.remove("over");
            if (draggedId) moveCard(draggedId, column, collapsed ? Infinity : dropIndex(list, e.clientY));
        });

        const input = el("input", "add");
        input.placeholder = "+ Add card";
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && input.value.trim()) {
                const projectId = projectById(filter) ? filter : null;
                cards.push({ id: newId(), text: input.value.trim(), column, projectId });
                save();
                render();
                boardEl.querySelectorAll(".add")[columns.indexOf(column)].focus();
            } else if (e.key === "Escape") {
                input.value = "";
                input.blur();
            }
        });

        col.append(...[header, list, more, collapsed ? null : input].filter(Boolean));
        return col;
    }

    function option(value, label) {
        const opt = el("option", null, label);
        opt.value = value;
        opt.selected = value === filter;
        return opt;
    }

    function renderToolbar() {
        const select = el("select", "project-select");
        select.append(
            option(FILTER_ALL, "All projects"),
            option(FILTER_NONE, "No project"),
            ...projects.map((p) => option(p.id, p.name))
        );
        select.addEventListener("change", () => setFilter(select.value));
        const add = el("button", "toolbar-button", "+ Project");
        add.title = "Add project";
        add.addEventListener("click", () => vscode.postMessage({ type: "addProject" }));
        toolbarEl.replaceChildren(select, add);
    }

    function render() {
        renderToolbar();
        boardEl.replaceChildren(...columns.map(renderColumn));
    }

    window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.type === "state") {
            columns = message.columns;
            cards = message.cards;
            projects = message.projects;
            topCount = message.topCount;
            normalise();
            render();
        } else if (message.type === "selectProject") {
            setFilter(message.projectId);
        }
    });

    vscode.postMessage({ type: "ready" });
})();
