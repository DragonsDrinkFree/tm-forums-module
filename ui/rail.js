// The Forums toolbox: sections (collapsible) and their categories, each with an unread counter.
// Clicking a category hands it to the Forums tab (see "Opening the tab" below).
/* global tavern, TMF */
(() => {
  const { el, button, run, note, store } = TMF;
  const $ = (id) => document.getElementById(id);

  let perms = { id: null, admin: false, levels: {} };
  let hinted = false;

  // ---- opening the tab ------------------------------------------------------------------------
  // One workspace tab per category (key = the category's id); opening it again shows the one open.
  const openCategory = (cat) =>
    tavern.workspace.openTab('board', {
      key: cat.id,
      title: `Forums: ${cat.data.name}`,
      args: { category: cat.id },
    });
  const openListing = () =>
    tavern.workspace.openTab('board', { key: 'listing', title: 'Forums', args: {} });

  // ---- dialogs for the two admin buttons ------------------------------------------------------
  async function addSection() {
    const { button: pressed, values } = await tavern.ui.dialog({
      title: 'New section',
      body: 'Sections group categories under a collapsible header.',
      fields: [{ type: 'text', key: 'name', label: 'Name' }],
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: 'Create', kind: 'primary' },
      ],
    });
    if (pressed === 'ok') await run('section-save', { name: values.name });
  }

  async function addCategory() {
    const { records } = await tavern.collections.query('sections', { sort: 'order', limit: 100 });
    if (!records.length) return note('Make a section first.', 'warning');
    const { button: pressed, values } = await tavern.ui.dialog({
      title: 'New category',
      body: 'Categories are the boards that hold threads.',
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
        {
          type: 'select',
          key: 'access',
          label: 'Who can use it',
          default: 'open',
          options: TMF.ACCESS,
        },
      ],
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: 'Create', kind: 'primary' },
      ],
    });
    if (pressed === 'ok') await run('category-save', values);
  }

  // ---- drawing ---------------------------------------------------------------------------------
  async function render() {
    const tree = await TMF.loadTree();
    const unread = new Map();
    await Promise.all(
      tree.flatMap((t) =>
        t.categories.map(async (c) => unread.set(c.id, await TMF.hasUnread(c.id, perms.id))),
      ),
    );
    const nodes = tree.map(({ section, categories }) => {
      const key = `tmf.open.${section.id}`;
      const d = el(
        'details',
        { className: 'section', open: store.get(key) !== 'closed' },
        el('summary', { textContent: section.data.name }),
        ...categories.map((c) => {
          const n = !!unread.get(c.id);
          return el(
            'button',
            {
              type: 'button',
              className: `cat${n ? ' has-unread' : ''}`,
              title: c.data.about || c.data.name,
              onclick: () => void openCategory(c),
            },
            el('span', { className: 'name', textContent: c.data.name }),
            c.data.access === 'private' ? el('span', { className: 'tag', textContent: 'private' }) : null,
            el('span', {
              className: 'dot',
              hidden: !n,
              title: 'New posts',
              ariaLabel: 'New posts',
            }),
          );
        }),
        categories.length ? null : el('p', { className: 'meta', textContent: 'No categories yet.' }),
      );
      d.addEventListener('toggle', () => store.set(key, d.open ? 'open' : 'closed'));
      return d;
    });
    $('tree').replaceChildren(
      ...(nodes.length
        ? nodes
        : [el('p', { className: 'meta', textContent: 'No forums yet.' })]),
    );
  }

  // Re-draw (debounced) whenever anything that changes the tree or a counter changes.
  let timer = 0;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void render(), 250);
  };

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
    tavern.collections.subscribe('roles', {}, () => void load());
  }
  void start();
})();
