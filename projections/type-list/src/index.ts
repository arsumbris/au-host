import { mountDocumentation } from '@arsumbris/projection-docs';
import { highlightCode } from '@arsumbris/code-syntax';
import { stringify } from 'yaml';
// Workspace type browser: shared keyboard tree and a definition inspector.
import { defineProjection, type MountHost, type ProjectionModule } from '@arsumbris/au-host-sdk';
import { readTypes, readTypeTree, type WireTypeDef, type WireTypeTree } from '@arsumbris/au-host-sdk/engine-reads';
import { fileSelection } from '@arsumbris/selection';
import { openIntent } from '@arsumbris/intent';
import type { TextRange } from '@arsumbris/range';
import { makeHoverContent } from '@arsumbris/preview-content';
const STYLE = `
.au-type-list { height:100%; min-height:0; min-width:0; display:flex; flex-direction:column; color:var(--au-ink-2); font:var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); container:types / inline-size; }
.au-type-list [hidden] { display:none !important; }
.au-type-list-bar { flex:none; padding:var(--au-space-4); display:flex; flex-wrap:wrap; gap:var(--au-space-2); align-items:center; border-bottom:1px solid var(--au-line-1); }
.au-type-heading { margin:0; flex:1; font:var(--au-w-strong) var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); }
.au-type-list-status { flex-basis:100%; color:var(--au-ink-3); overflow-wrap:anywhere; }
.au-type-list-bar au-input { width:100%; }
.au-type-list-bar au-select { flex:1; min-width:0; }
.au-type-workspace { display:grid; grid-template-columns:minmax(180px, .65fr) minmax(260px, 1.35fr); flex:1; min-height:0; }
.au-type-list-tree { min-width:0; min-height:0; }
.au-type-browser { padding:var(--au-space-3) var(--au-space-4); }
.au-type-browser au-tree-item::part(label) { white-space:normal; overflow-wrap:anywhere; }
.au-type-detail-scroll { min-width:0; min-height:0; border-left:1px solid var(--au-line-1); }
.au-type-detail { padding:var(--au-space-4); display:flex; flex-direction:column; gap:var(--au-space-4); overflow-wrap:anywhere; }
.au-type-detail h3 { margin:0; color:var(--au-ink-1); font:var(--au-w-strong) var(--au-t-body)/var(--au-lh-base) var(--au-font-mono); }
.au-type-detail h4 { margin:0 0 var(--au-space-2); font:var(--au-w-strong) var(--au-t-sm)/var(--au-lh-sm) var(--au-font-sans); }
.au-type-detail p { margin:0; white-space:pre-wrap; line-height:var(--au-lh-base); }
.au-type-context { color:var(--au-ink-3); font-size:var(--au-t-xs); }
.au-type-detail-actions { display:flex; flex-wrap:wrap; gap:var(--au-space-2); }
.au-type-fields { margin:0; }
.au-type-field { padding:var(--au-space-2) 0; border-top:1px solid var(--au-line-1); }
.au-type-field dt { color:var(--au-ink-1); font-family:var(--au-font-mono); }
.au-type-code { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; font:var(--au-t-xs)/var(--au-lh-base) var(--au-font-mono); }
.au-type-code .au-syntax-name { color:var(--au-code-property); }
.au-type-code .au-syntax-string { color:var(--au-code-string); }
.au-type-code .au-syntax-value { color:var(--au-code-number); }
.au-type-code .au-syntax-type { color:var(--au-code-type); }
.au-type-code .au-syntax-punctuation { color:var(--au-code-punctuation); }
.au-type-code .au-syntax-keyword { color:var(--au-code-keyword); }
.au-type-field dd { margin:var(--au-space-1) 0 0; color:var(--au-ink-3); font-family:var(--au-font-mono); }
.au-type-notice { color:var(--au-color-warn); flex-basis:100%; }
.au-type-notice:empty { display:none; }
@container types (max-width:620px) {
 .au-type-workspace { grid-template-columns:minmax(0,1fr); grid-template-rows:auto minmax(160px,1fr); }
 .au-type-list-tree { max-height:240px; }
 .au-type-detail-scroll { border-left:0; border-top:1px solid var(--au-line-1); }
}
`;
type TreeItem = HTMLElement & {
    label: string;
    selected: boolean;
    expanded: boolean;
};
type Select = HTMLElement & {
    value: string;
    options: {
        value: string;
        label: string;
    }[];
};
const button = (label: string, action: () => void): HTMLElement => {
    const el = document.createElement('au-button');
    el.textContent = label;
    el.setAttribute('size', 'sm');
    el.addEventListener('au-activate', action);
    return el;
};
function mount(container: HTMLElement, host: MountHost): () => void {
    const root = document.createElement('div');
    root.className = 'au-type-list';
    const disposeStyles = host.styles?.inject(STYLE, container);
    const bar = document.createElement('div');
    bar.className = 'au-type-list-bar';
    const heading = document.createElement('h2');
    heading.className = 'au-type-heading';
    heading.textContent = 'Workspace types';
    const status = document.createElement('div');
    status.className = 'au-type-list-status';
    status.setAttribute('role', 'status');
    const spinner = document.createElement('au-spinner');
    spinner.setAttribute('size', 'sm');
    spinner.setAttribute('label', 'Loading types');
    spinner.hidden = true;
    const notice = document.createElement('div');
    notice.className = 'au-type-notice';
    notice.setAttribute('role', 'status');
    const search = document.createElement('au-input') as HTMLElement & {
        value: string;
    };
    search.setAttribute('aria-label', 'Search types');
    search.setAttribute('placeholder', 'Find a type, repository or field…');
    const modeSelect = document.createElement('au-segmented-control') as HTMLElement & {
        items: {
            value: string;
            label: string;
        }[];
        value: string;
    };
    modeSelect.items = [{ value: 'tree', label: 'Hierarchy' }, { value: 'flat', label: 'All types' }];
    modeSelect.value = 'tree';
    modeSelect.setAttribute('aria-label', 'Type presentation');
    const owner = document.createElement('au-select') as Select;
    owner.setAttribute('label', 'Repository');
    owner.options = [{ value: '', label: 'All repositories' }];
    owner.value = '';
    const refreshButton = button('Refresh', () => void refresh());
    bar.append(heading, spinner, refreshButton, status, search, modeSelect, owner, notice);
    const workspace = document.createElement('div');
    workspace.className = 'au-type-workspace';
    const treeEl = document.createElement('au-scroll-area');
    treeEl.className = 'au-type-list-tree';
    treeEl.setAttribute('axis', 'y');
    const browser = document.createElement('div');
    browser.className = 'au-type-browser';
    treeEl.append(browser);
    const detailScroll = document.createElement('au-scroll-area');
    detailScroll.className = 'au-type-detail-scroll';
    detailScroll.setAttribute('axis', 'y');
    const detail = document.createElement('div');
    detail.className = 'au-type-detail';
    detailScroll.append(detail);
    workspace.append(treeEl, detailScroll);
    root.append(bar, workspace);
    container.append(root);
    let alive = true, request = 0, loaded = false, version: number | null = null;
    const intent = host.intent;
    let defs: WireTypeDef[] = [], tree: WireTypeTree | null = null, selected: string | null = null;
    let mode: 'tree' | 'flat' = 'tree';
    let expanded = new Set<string>();
    function openType(def: WireTypeDef): void {
        if (!def.source?.file)
            return;
        const span = def.source.span;
        const range: TextRange | undefined = span ? { type: 'text-range', from: span.start, to: span.end } : undefined;
        clearHoverTimer();
        preview?.hide();
        intent.fire(openIntent(fileSelection(def.source.file, range)));
    }
    function empty(target: HTMLElement, label: string, hint: string): void {
        const el = document.createElement('au-empty-state') as HTMLElement & {
            label: string;
            hint: string;
        };
        el.label = label;
        el.hint = hint;
        target.replaceChildren(el);
    }
    let documentation: (() => void)[] = [];
    function renderDetail(): void {
        documentation.forEach(dispose => dispose());
        documentation = [];
        const def = defs.find(d => d.name === selected);
        if (!def) {
            empty(detail, 'Inspect a type', 'Select a type to read its definition, then open its source.');
            return;
        }
        detail.replaceChildren();
        const title = document.createElement('h3');
        title.textContent = def.name;
        const context = document.createElement('p');
        context.className = 'au-type-context';
        context.textContent = `${def.repo} · ${def.fields.length} fields`;
        const actions = document.createElement('div');
        actions.className = 'au-type-detail-actions';
        const open = button('Open source', () => openType(def));
        open.toggleAttribute('disabled', !def.source?.file);
        actions.append(open, button('Filter to repository', () => { owner.value = def.repo; renderTree(); }));
        detail.append(title, context, actions);
        if (def.doc) {
            const doc = document.createElement('div');
            detail.append(doc);
            documentation.push(mountDocumentation(doc, def.doc, host, def.source?.file));
        }
        function section(label: string): HTMLElement { const el = document.createElement('section'); const h = document.createElement('h4'); h.textContent = label; el.append(h); detail.append(el); return el; }
        if (def.parents.length) {
            const s = section('Extends');
            for (const parent of def.parents) {
                const p = document.createElement('p');
                p.textContent = parent;
                s.append(p);
            }
        }
        if (def.sealed?.length) {
            const s = section('Sealed variants');
            const p = document.createElement('p');
            p.textContent = def.sealed.join(', ');
            s.append(p);
        }
        const fields = section('Fields');
        if (!def.fields.length) {
            const p = document.createElement('p');
            p.className = 'au-type-context';
            p.textContent = 'No fields declared on this type.';
            fields.append(p);
        }
        else {
            const list = document.createElement('dl');
            list.className = 'au-type-fields';
            for (const f of def.fields) {
                const row = document.createElement('div');
                row.className = 'au-type-field';
                const name = document.createElement('dt');
                const declaration = `${stringify(f.name + (f.required ? '' : '?')).trimEnd()}: ${f.shape}`;
                name.append(yamlView(declaration));
                const shape = document.createElement('dd');
                shape.textContent = f.required ? 'Required' : 'Optional';
                if (f.doc) {
                    const doc = document.createElement('div');
                    shape.append(doc);
                    documentation.push(mountDocumentation(doc, f.doc, host, def.source?.file));
                }
                shape.style.fontFamily = 'var(--au-font-sans)';
                row.append(name, shape);
                list.append(row);
            }
            fields.append(list);
        }
        if (def.source?.file) {
            const source = section('Source');
            const p = document.createElement('p');
            p.className = 'au-type-context';
            p.textContent = def.source.file;
            source.append(p);
        }
    }
    function renderTree(): void {
        for (const el of browser.querySelectorAll<TreeItem>('au-tree-item')) {
            if (!el.querySelector(':scope > au-tree-item'))
                continue;
            if (el.expanded)
                expanded.add(el.dataset.branch!);
            else
                expanded.delete(el.dataset.branch!);
        }
        browser.replaceChildren();
        const query = (search.value ?? '').trim().toLowerCase();
        const shown = defs.filter(d => (!owner.value || d.repo === owner.value) && (!query || `${d.name} ${d.repo} ${d.doc ?? ''} ${d.fields.map(f => f.name).join(' ')}`.toLowerCase().includes(query)));
        status.textContent = `${shown.length} of ${defs.length} types${query || owner.value ? ' · filtered list' : tree ? ` · ${tree.roots.length} roots` : ''}${version === null ? '' : ` · v${version}`}`;
        if (!shown.length) {
            empty(browser, defs.length ? 'No matching types' : 'No types available', defs.length ? 'Change the search or repository filter.' : 'Refresh after the workspace has loaded its type definitions.');
            renderDetail();
            return;
        }
        const list = document.createElement('au-tree');
        list.setAttribute('aria-label', query || owner.value || mode === 'flat' ? 'Types' : 'Type hierarchy');
        const byName = new Map(defs.map(d => [d.name, d])), nodes = new Map(tree?.nodes.map(n => [n.name, n]) ?? []);
        function node(name: string, path: Set<string>, hierarchy: boolean): TreeItem {
            const def = byName.get(name), entry = nodes.get(name);
            const el = document.createElement('au-tree-item') as TreeItem;
            el.label = `${name} · ${def?.repo ?? entry?.repo ?? 'Unknown repository'}`;
            el.dataset.type = name;
            el.title = el.label;
            el.selected = selected === name;
            // A type can occur under several parents; expansion belongs to this path.
            el.dataset.branch = JSON.stringify([...path, name]);
            el.expanded = expanded.has(el.dataset.branch);
            if (hierarchy && !path.has(name)) {
                const next = new Set(path).add(name);
                for (const child of entry?.children ?? [])
                    el.append(node(child, next, true));
            }
            return el;
        }
        if (mode === 'tree' && tree && !query && !owner.value) {
            for (const name of tree.roots)
                list.append(node(name, new Set(), true));
        }
        else
            for (const def of [...shown].sort((a, b) => a.name.localeCompare(b.name)))
                list.append(node(def.name, new Set(), false));
        list.addEventListener('au-select', event => { const item = (event.target as HTMLElement).closest<TreeItem>('au-tree-item'); if (!item)
            return; selected = item.dataset.type ?? null; for (const row of list.querySelectorAll<TreeItem>('au-tree-item'))
            row.selected = row.dataset.type === selected; renderDetail(); });
        browser.append(list);
        renderDetail();
    }
    search.addEventListener('au-input', renderTree);
    owner.addEventListener('au-change', renderTree);
    modeSelect.addEventListener('au-change', () => { mode = modeSelect.value === 'flat' ? 'flat' : 'tree'; renderTree(); });
    async function refresh(): Promise<void> {
        const ticket = ++request;
        spinner.hidden = false;
        root.setAttribute('aria-busy', 'true');
        status.textContent = loaded ? 'Refreshing types…' : 'Loading types…';
        notice.textContent = '';
        refreshButton.setAttribute('disabled', '');
        if (!loaded) {
            const skeleton = document.createElement('au-skeleton');
            skeleton.setAttribute('lines', '5');
            browser.replaceChildren(skeleton);
        }
        try {
            const [typesOutcome, treeOutcome] = await Promise.all([readTypes(host.engine), readTypeTree(host.engine)]);
            if (!alive || ticket !== request)
                return;
            if ('ok' in typesOutcome)
                throw Error(typesOutcome.error);
            if (!typesOutcome.ready)
                throw Error('The workspace engine is not ready.');
            defs = typesOutcome.result;
            version = typesOutcome.version;
            loaded = true;
            tree = !('ok' in treeOutcome) && treeOutcome.ready ? treeOutcome.result : null;
            if (!tree)
                notice.textContent = 'Hierarchy unavailable. All types remain available as a list; Refresh retries both reads.';
            owner.options = [{ value: '', label: 'All repositories' }, ...Array.from(new Set(defs.map(d => d.repo))).sort().map(repo => ({ value: repo, label: repo }))];
            renderTree();
        }
        catch (error) {
            if (!alive || ticket !== request)
                return;
            status.textContent = loaded ? 'Showing the last loaded types' : 'Types unavailable';
            notice.textContent = error instanceof Error ? error.message : String(error);
            if (!loaded)
                empty(browser, 'Could not load types', 'Use Refresh to try again.');
        }
        finally {
            if (alive && ticket === request) {
                refreshButton.removeAttribute('disabled');
                spinner.hidden = true;
                root.setAttribute('aria-busy', 'false');
            }
        }
    }
    renderDetail();
    void refresh();
    const offReady = host.engineReady?.subscribe(ready => { if (ready && alive)
        void refresh(); });
    // CMD+HOVER PREVIEW: cmd/ctrl-hover a type name → the host's shared preview overlay
    // surface previews its type-def FILE (the editor's `previewType` content). The type-list is a
    // CONSUMER of `host.preview`, proving the surface is reusable. No card of its own — the host owns
    // the chrome, this supplies the content. Same hover lifecycle as the editor (dwell + sticky).
    const preview = host.preview;
    const content = preview ? makeHoverContent(host.engine) : null;
    let modHeld = false;
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPointer: {
        x: number;
        y: number;
    } | null = null;
    const clearHoverTimer = (): void => {
        if (hoverTimer)
            clearTimeout(hoverTimer);
        hoverTimer = undefined;
    };
    function manageHover(x: number, y: number): void {
        if (!preview || !content)
            return;
        if (preview.isOver(x, y))
            return clearHoverTimer(); // sticky: pointer is in the card
        const nameEl = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('au-tree-item') as HTMLElement | null;
        const name = modHeld ? nameEl?.dataset.type : undefined;
        if (!name) {
            // The surface owns dismissal via its safety cones (moving toward the card keeps it), so we
            // do NOT hide here — only stop a pending dwell.
            clearHoverTimer();
            return;
        }
        const key = `tl:type:${name}`;
        if (preview.isShowing(key))
            return;
        clearHoverTimer();
        hoverTimer = setTimeout(() => {
            // `linkResolver` enables NESTING: a wikilink inside the type-def preview spawns a child.
            if (alive && modHeld && nameEl?.isConnected && treeEl.contains(nameEl))
                preview.show(key, nameEl.getBoundingClientRect(), content.previewType(name), (path) => content.previewPath(path), (p) => intent?.fire(openIntent(fileSelection(p))));
        }, 240);
    }
    const onMove = (e: MouseEvent): void => {
        // Read the modifier off the move event (authoritative) — a keyup can be missed when the
        // window loses focus while Cmd is held, which would otherwise leave `modHeld` stuck true and
        // pop the peek on a plain hover. This self-corrects on the next move.
        modHeld = e.metaKey || e.ctrlKey;
        lastPointer = { x: e.clientX, y: e.clientY };
        manageHover(e.clientX, e.clientY);
    };
    const onModKey = (e: KeyboardEvent): void => {
        if (e.key !== 'Meta' && e.key !== 'Control')
            return;
        modHeld = e.metaKey || e.ctrlKey;
        if (lastPointer)
            manageHover(lastPointer.x, lastPointer.y);
    };
    const onBlur = (): void => {
        // Losing focus can swallow the modifier keyup; clear so a returning plain hover can't peek.
        modHeld = false;
        clearHoverTimer();
    };
    const onLeave = (): void => {
        // Don't hide on leaving the tree — the surface's cones own dismissal (moving the pointer
        // toward the card must not close it). Just stop a pending dwell.
        clearHoverTimer();
    };
    if (preview) {
        treeEl.addEventListener('mousemove', onMove);
        treeEl.addEventListener('mouseleave', onLeave);
        window.addEventListener('keydown', onModKey);
        window.addEventListener('keyup', onModKey);
        window.addEventListener('blur', onBlur);
    }
    return () => {
        disposeStyles?.();
        documentation.forEach(dispose => dispose());
        alive = false;
        request++;
        offReady?.();
        clearHoverTimer();
        if (preview) {
            treeEl.removeEventListener('mousemove', onMove);
            treeEl.removeEventListener('mouseleave', onLeave);
            window.removeEventListener('keydown', onModKey);
            window.removeEventListener('keyup', onModKey);
            window.removeEventListener('blur', onBlur);
            preview.hide(); // hide any preview this view triggered (host owns the surface; don't dispose)
        }
        container.replaceChildren();
    };
}
// Registered module: the branded default is the single mount surface (module-contract seam).
export default defineProjection<ProjectionModule>({ mount });

function yamlView(code: string): HTMLElement {
    const pre = document.createElement('pre');
    pre.className = 'au-type-code';
    for (const part of highlightCode(code, 'yaml')) {
        const span = document.createElement('span');
        span.textContent = part.text;
        if (part.className) span.className = part.className;
        pre.append(span);
    }
    return pre;
}
