// The Forums toolbox: sections (collapsible) and their categories, each with a dot when it has new
// posts. A click opens the category in the one Forums tab (the feature is `singleTab`: every item
// replaces what the last one opened). Admins can drag sections and categories to reorder them (a
// category can be dropped into another section) and right-click either to edit or delete it.
/* global tavern, TMF */
(() => {
  const { el, run, note, store } = TMF;
  const $ = (id) => document.getElementById(id);

  let perms = { id: null, admin: false, levels: {} };
  let tree = [];
  let drag = null; // { type: 'cat' | 'sec', id }
  let pendingRender = false;

  // ---- opening the tab ------------------------------------------------------------------------
  // The feature is `singleTab`, so each of these replaces the Forums tab's contents in place
  // (and an item that's already open is just brought forward).
  const openCategory = (cat) =>
    tavern.workspace.openTab('board', {
      key: cat.id,
      title: `Forums: ${cat.data.name}`,
      args: { category: cat.id },
    });
  const openListing = () =>
    tavern.workspace.openTab('board', { key: 'listing', title: 'Forums', args: {} });

  // ---- dialogs ---------------------------------------------------------------------------------
  const buttons = (ok) => [
    { id: 'cancel', label: 'Cancel' },
    { id: 'ok', label: ok, kind: 'primary' },
  ];

  async function addSection() {
    const { button: pressed, values } = await tavern.ui.dialog({
      title: 'New section',
      body: 'Sections group categories under a collapsible header.',
      fields: [{ type: 'text', key: 'name', label: 'Name' }],
      buttons: buttons('Create'),
    });
    if (pressed === 'ok') await run('section-save', { name: values.name });
  }

  async function addCategory() {
    const { records } = await tavern.collections.query('sections', { sort: 'order', limit: 100 });
    if (!records.length) return note('Make a section first.', 'warning');
    const { button: pressed, values } = await tavern.ui.dialog({
      title: 'New category',
      body: 'Categories are the boards that hold topics.',
      fields: [
        { type: 'text', key: 'name', label: 'Name' },
        { type: 'textarea', key: 'about', label: 'Description' },
        {
          type: 'select',
          key: 'section',
          label: 'Section',
          default: records[0].id,
          options: records.map((s) => ({ value: s.id, label: s.data.name })),
        },
        { type: 'select', key: 'access', label: 'Who can use it', default: 'open', options: TMF.ACCESS },
      ],
      buttons: buttons('Create'),
    });
    if (pressed === 'ok') await run('category-save', values);
  }

  async function editCategory(c) {
    const { button: pressed, values } = await tavern.ui.dialog({
      title: `Edit ${c.data.name}`,
      fields: [
        { type: 'text', key: 'name', label: 'Name', default: c.data.name },
        { type: 'textarea', key: 'about', label: 'Description', default: c.data.about || '' },
        { type: 'select', key: 'access', label: 'Who can use it', default: c.data.access || 'open', options: TMF.ACCESS },
      ],
      buttons: buttons('Save'),
    });
    if (pressed === 'ok') await run('category-save', { id: c.id, ...values });
  }

  // ---- right-click -----------------------------------------------------------------------------
  async function categoryMenu(e, c) {
    e.preventDefault();
    if (!perms.admin) return;
    const choice = await tavern.ui.menu(
      [
        { id: 'open', label: 'Open' },
        { id: 'edit', label: 'Edit…' },
        { separator: true },
        { id: 'delete', label: 'Delete', danger: true },
      ],
      { x: e.clientX, y: e.clientY },
    );
    if (choice === 'open') void openCategory(c);
    if (choice === 'edit') await editCategory(c);
    if (choice === 'delete' && (await tavern.ui.confirm(`Delete **${c.data.name}** and every topic in it? This can't be undone.`, { ok: 'Delete' }))) {
      await run('category-delete', { id: c.id });
    }
  }

  async function sectionMenu(e, s) {
    e.preventDefault();
    if (!perms.admin) return;
    const choice = await tavern.ui.menu(
      [
        { id: 'rename', label: 'Rename…' },
        { separator: true },
        { id: 'delete', label: 'Delete', danger: true },
      ],
      { x: e.clientX, y: e.clientY },
    );
    if (choice === 'rename') {
      const name = await tavern.ui.prompt('Section name', s.data.name);
      if (name) await run('section-save', { id: s.id, name });
    }
    if (choice === 'delete' && (await tavern.ui.confirm(`Delete the section **${s.data.name}**? It must be empty.`, { ok: 'Delete' }))) {
      await run('section-delete', { id: s.id });
    }
  }

  // ---- drag and drop (admins) -------------------------------------------------------------------
  const clear = () =>
    document
      .querySelectorAll('.drop-before,.drop-after,.drop-into')
      .forEach((n) => n.classList.remove('drop-before', 'drop-after', 'drop-into'));
  const half = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };

  /** Move what's being dragged, then save the whole layout. `target`: { type, id, where } */
  async function drop(target) {
    if (!drag) return;
    const layout = tree.map((t) => ({ id: t.section.id, categories: t.categories.map((c) => c.id) }));
    if (drag.type === 'sec') {
      if (target.type === 'cat') return;
      const from = layout.findIndex((s) => s.id === drag.id);
      const [moved] = layout.splice(from, 1);
      let to = layout.findIndex((s) => s.id === target.id);
      if (target.where === 'after') to += 1;
      layout.splice(to, 0, moved);
    } else {
      for (const s of layout) s.categories = s.categories.filter((id) => id !== drag.id);
      if (target.type === 'sec') {
        layout.find((s) => s.id === target.id).categories.push(drag.id);
      } else {
        const sec = layout.find((s) => s.categories.includes(target.id));
        let to = sec.categories.indexOf(target.id);
        if (target.where === 'after') to += 1;
        sec.categories.splice(to, 0, drag.id);
      }
    }
    drag = null;
    clear();
    if (await run('reorder', { layout })) await render();
  }

  function draggable(node, type, id) {
    if (!perms.admin) return;
    node.draggable = true;
    node.addEventListener('dragstart', (e) => {
      drag = { type, id };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    });
    node.addEventListener('dragend', () => {
      drag = null;
      clear();
      if (pendingRender) refresh();
    });
  }

  function dropTarget(node, type, id) {
    if (!perms.admin) return;
    node.addEventListener('dragover', (e) => {
      if (!drag || (drag.type === 'sec' && type === 'cat') || drag.id === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clear();
      // A category dropped on a section header goes to the end of that section.
      if (drag.type === 'cat' && type === 'sec') node.classList.add('drop-into');
      else node.classList.add(`drop-${half(e)}`);
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after', 'drop-into'));
    node.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault();
      void drop({ type, id, where: drag.type === 'cat' && type === 'sec' ? 'into' : half(e) });
    });
  }

  // ---- drawing ---------------------------------------------------------------------------------
  async function render() {
    tree = await TMF.loadTree();
    const unread = new Map();
    await Promise.all(
      tree.flatMap((t) =>
        t.categories.map(async (c) => unread.set(c.id, await TMF.hasUnread(c.id, perms.id))),
      ),
    );
    const nodes = tree.map(({ section, categories }) => {
      const key = `tmf.open.${section.id}`;
      const summary = el('summary', { textContent: section.data.name });
      summary.addEventListener('contextmenu', (e) => void sectionMenu(e, section));
      draggable(summary, 'sec', section.id);
      dropTarget(summary, 'sec', section.id);
      const d = el(
        'details',
        { className: 'section', open: store.get(key) !== 'closed' },
        summary,
        ...categories.map((c) => {
          const n = !!unread.get(c.id);
          const row = el(
            'button',
            {
              type: 'button',
              className: `cat${n ? ' has-unread' : ''}`,
              title: c.data.about || c.data.name,
              onclick: () => void openCategory(c),
            },
            el('span', { className: 'name', textContent: c.data.name }),
            c.data.access === 'private' ? el('span', { className: 'tag', textContent: 'private' }) : null,
            el('span', { className: 'dot', hidden: !n, title: 'New posts', ariaLabel: 'New posts' }),
          );
          row.addEventListener('contextmenu', (e) => void categoryMenu(e, c));
          draggable(row, 'cat', c.id);
          dropTarget(row, 'cat', c.id);
          return row;
        }),
        categories.length ? null : el('p', { className: 'meta', textContent: 'No categories yet.' }),
      );
      d.addEventListener('toggle', () => store.set(key, d.open ? 'open' : 'closed'));
      return d;
    });
    $('tree').replaceChildren(
      ...(nodes.length ? nodes : [el('p', { className: 'meta', textContent: 'No forums yet.' })]),
    );
  }

  // Re-draw (debounced) when anything that changes the tree or a dot changes; never mid-drag.
  let timer = 0;
  function refresh() {
    if (drag) {
      pendingRender = true;
      return;
    }
    pendingRender = false;
    clearTimeout(timer);
    timer = setTimeout(() => void render(), 250);
  }

  async function load() {
    perms = (await TMF.loadPerms()) || perms;
    $('admin-tools').hidden = !perms.admin;
    await render();
  }

  async function start() {
    $('browse').onclick = () => void openListing();
    $('add-section').onclick = () => void addSection();
    $('add-category').onclick = () => void addCategory();
    await load();
    for (const c of ['sections', 'categories', 'posts', 'reads']) {
      tavern.collections.subscribe(c, {}, refresh);
    }
    // Role changes alter what the viewer may see and do: ask the server again.
    tavern.collections.subscribe('role-settings', {}, () => void load());
  }
  void start();
})();
