// The Forums tab: main listing -> a category's threads -> a thread's replies, plus search and the
// roles editor. Reads go straight to `tavern.collections` (core enforces each record's readers);
// every write is one of rules.js's actions, which decide who may do what.
/* global tavern, TMF */
(() => {
  const { el, button, when, full, nameOf, run, note } = TMF;
  const $ = (id) => document.getElementById(id);
  const PAGE = 25;

  let perms = { id: null, admin: false, levels: {} };
  let view = { kind: 'home' };
  const history = [];
  let stopWatching = () => {};
  let readAtOnOpen = 0;

  const rank = (l) => ['none', 'read', 'post', 'moderate', 'admin'].indexOf(l || 'none');
  const levelOf = (catId) => (perms.admin ? 'admin' : perms.levels[catId] || 'none');

  // ---- navigation -----------------------------------------------------------------------------
  function go(next, { push = true } = {}) {
    if (push && view) history.push(view);
    view = next;
    watch();
    void render();
  }
  function back() {
    const prev = history.pop();
    if (prev) go(prev, { push: false });
  }

  function watch() {
    stopWatching();
    const refresh = () => void render();
    const subs = [];
    if (view.kind === 'home') {
      for (const c of ['sections', 'categories', 'posts', 'reads'])
        subs.push(tavern.collections.subscribe(c, {}, refresh));
    } else if (view.kind === 'category') {
      subs.push(tavern.collections.subscribe('threads', { parent: view.category.id }, refresh));
    } else if (view.kind === 'thread') {
      subs.push(tavern.collections.subscribe('posts', { parent: view.thread.id }, refresh));
      subs.push(
        tavern.collections.subscribe('threads', { parent: view.category.id }, (changes) => {
          const mine = changes.find((c) => c.id === view.thread.id);
          if (!mine) return;
          if (!mine.record) return go({ kind: 'category', category: view.category }, { push: false });
          view.thread = mine.record;
          refresh();
        }),
      );
    }
    stopWatching = () => subs.forEach((s) => s());
  }

  // ---- drawing ---------------------------------------------------------------------------------
  function crumbs() {
    const parts = [button('Forums', () => go({ kind: 'home' }), { className: 'link' })];
    if (history.length) parts.unshift(button('◀ Back', back, { className: 'small' }), ' ');
    if (view.category) {
      parts.push(
        ' › ',
        button(view.category.data.name, () => go({ kind: 'category', category: view.category }), {
          className: 'link',
        }),
      );
    }
    if (view.kind === 'thread') parts.push(' › ', el('span', { textContent: view.thread.data.title }));
    if (view.kind === 'search') parts.push(' › ', el('span', { textContent: `Search “${view.text}”` }));
    if (view.kind === 'roles') parts.push(' › ', el('span', { textContent: 'Roles' }));
    $('crumbs').replaceChildren(...parts);
  }

  async function render() {
    crumbs();
    const shown = view;
    const body =
      view.kind === 'home'
        ? await home()
        : view.kind === 'category'
          ? await category(view.category)
          : view.kind === 'thread'
            ? await thread(view.thread, view.category)
            : view.kind === 'search'
              ? await results(view)
              : await rolesView();
    if (shown === view) $('view').replaceChildren(...body); // somewhere else meanwhile: leave it
  }

  async function home() {
    const tree = await TMF.loadTree();
    const out = [el('h1', { textContent: 'Forums' })];
    for (const { section, categories } of tree) {
      const head = el(
        'div',
        { className: 'row spread' },
        el('h2', { textContent: section.data.name }),
        perms.admin
          ? el(
              'span',
              { className: 'row' },
              button('Rename', () => void renameSection(section), { className: 'small' }),
              button('Delete', () => void deleteSection(section), { className: 'small danger' }),
            )
          : null,
      );
      const rows = await Promise.all(
        categories.map(async (c) => {
          const [unread, threads] = await Promise.all([
            TMF.hasUnread(c.id, perms.id),
            tavern.collections.count('threads', { parent: c.id }),
          ]);
          return el(
            'li',
            { className: unread ? 'unread' : '' },
            el(
              'div',
              { className: 'row spread' },
              el(
                'span',
                { className: 'grow' },
                button(c.data.name, () => go({ kind: 'category', category: c }), {
                  className: 'link title',
                }),
                c.data.access === 'private' ? el('span', { className: 'tag', textContent: 'private' }) : null,
                c.data.access === 'announce'
                  ? el('span', { className: 'tag', textContent: 'announcements' })
                  : null,
                c.data.about ? el('p', { className: 'meta', textContent: c.data.about }) : null,
              ),
              el('span', { className: 'meta', textContent: `${threads} thread${threads === 1 ? '' : 's'}` }),
              el('span', { className: 'dot', hidden: !unread, title: 'New posts', ariaLabel: 'New posts' }),
              perms.admin
                ? button('Edit', () => void editCategory(c), { className: 'small' })
                : null,
            ),
          );
        }),
      );
      out.push(
        head,
        rows.length
          ? el('ul', { className: 'list', ariaLabel: section.data.name }, ...rows)
          : el('p', { className: 'meta', textContent: 'No categories yet.' }),
      );
    }
    if (!tree.length) {
      out.push(
        el('p', {
          className: 'meta',
          textContent: perms.admin
            ? 'No forums yet. Use + Section in the Forums toolbox to start.'
            : 'No forums yet.',
        }),
      );
    }
    return out;
  }

  async function markRead(catId) {
    await run('mark-read', { category: catId });
  }

  /** The "write a post" window (ui/compose.html): answers { title, body } or null. */
  async function compose(args) {
    return tavern.ui.dialog({
      page: 'ui/compose.html',
      title: args.heading,
      size: { width: 680, height: 540 },
      data: args,
    });
  }

  async function newTopic(cat) {
    const out = await compose({ mode: 'topic', heading: `New topic in ${cat.data.name}` });
    if (!out) return;
    const made = await run('thread-create', { category: cat.id, title: out.title, body: out.body });
    if (made) go({ kind: 'thread', category: cat, thread: made.thread });
  }

  async function postReply(t, quote) {
    const out = await compose({ mode: 'reply', heading: `Re: ${t.data.title}`, quote });
    if (out) await run('reply', { thread: t.id, body: out.body });
  }

  async function category(cat) {
    const level = levelOf(cat.id);
    if (!view.opened) {
      // Remember what was new when it was opened, so topics stay highlighted while the dot clears.
      const marks = await tavern.collections.query('reads', { where: { category: cat.id }, limit: 1 });
      readAtOnOpen = marks.records[0] ? marks.records[0].data.at : 0;
      view.opened = true;
    }
    const [pinned, rest] = await Promise.all([
      tavern.collections.query('threads', { parent: cat.id, where: { pinned: true }, sort: '-lastPost' }),
      tavern.collections.query('threads', {
        parent: cat.id,
        where: { pinned: false },
        sort: '-lastPost',
        limit: PAGE * (view.pages || 1),
      }),
    ]);
    void markRead(cat.id);
    const total = await tavern.collections.count('threads', { parent: cat.id });
    const row = async (t) =>
      el(
        'div',
        { className: `trow${t.data.lastPost > readAtOnOpen && t.author !== perms.id ? ' unread' : ''}` },
        el(
          'div',
          {},
          button(t.data.title, () => go({ kind: 'thread', category: cat, thread: t }), {
            className: 'link title',
          }),
          t.data.pinned ? el('span', { className: 'tag', textContent: 'Pinned' }) : null,
          t.data.locked ? el('span', { className: 'tag', textContent: 'Locked' }) : null,
          el('p', {
            className: 'meta',
            textContent: `by ${await nameOf(t.author)} » ${full(t.created)}`,
          }),
        ),
        el('div', { className: 'num', textContent: String(t.data.replies || 0) }),
        el(
          'div',
          { className: 'last' },
          el('div', { textContent: `by ${await nameOf(t.data.lastBy || t.author)}` }),
          el('div', { className: 'meta', title: full(t.data.lastPost), textContent: when(t.data.lastPost) }),
        ),
      );
    const head = (label) =>
      el('div', { className: 'thead' }, el('div', { textContent: label }), el('div', { className: 'num', textContent: 'Replies' }),
        el('div', { className: 'last', textContent: 'Last post' }));
    const group = (label, list) =>
      list.length
        ? el('div', { className: 'table' }, head(label), ...list)
        : null;
    const [pinRows, restRows] = await Promise.all([
      Promise.all(pinned.records.map(row)),
      Promise.all(rest.records.map(row)),
    ]);
    const canPost = rank(level) >= rank('post');
    const out = [
      el('h1', { textContent: cat.data.name }),
      cat.data.about ? el('p', { className: 'meta', textContent: cat.data.about }) : null,
      el(
        'div',
        { className: 'row spread' },
        el(
          'span',
          { className: 'row' },
          canPost
            ? button('New Topic ✎', () => void newTopic(cat), { className: 'primary' })
            : el('span', { className: 'meta', textContent: 'Read only for you' }),
          perms.admin ? button('Edit category', () => void editCategory(cat), { className: 'small' }) : null,
        ),
        el('span', { className: 'meta', textContent: `${total} topic${total === 1 ? '' : 's'}` }),
      ),
      group('Pinned', pinRows),
      group('Topics', restRows),
    ].filter(Boolean);
    if (!pinRows.length && !restRows.length) {
      out.push(el('p', { className: 'meta', textContent: 'No topics yet. Start one with New Topic.' }));
    }
    if (rest.next) {
      out.push(
        button('Load older topics', () => {
          view.pages = (view.pages || 1) + 1;
          void render();
        }),
      );
    }
    return out;
  }

  async function thread(t, cat) {
    const level = levelOf(cat.id);
    const mod = rank(level) >= rank('moderate');
    const canReply = rank(level) >= rank('post') && (!t.data.locked || mod);
    const [{ records }, roles] = await Promise.all([
      tavern.collections.query('posts', { parent: t.id, sort: 'created', limit: 100 }),
      tavern.roles.list().catch(() => []),
    ]);
    void markRead(cat.id);
    const rolesOfUser = (id) => roles.filter((r) => r.members.some((m) => m.id === id)).map((r) => r.label);
    const counts = new Map();
    const postsBy = (id) => {
      if (!counts.has(id)) counts.set(id, tavern.collections.count('posts', { author: id }));
      return counts.get(id);
    };
    const cards = await Promise.all(
      records.map(async (p, i) => {
        const mine = p.author === perms.id;
        const who = await nameOf(p.author);
        const body = el('div', { className: 'text' });
        void TMF.renderPost(body, p.data.body);
        const tools = el(
          'div',
          { className: 'row' },
          canReply
            ? button('❝ Quote', () => void postReply(t, { who, text: p.data.body }), { className: 'small' })
            : null,
          mine || mod ? button('Edit', () => void editPost(p), { className: 'small' }) : null,
          mine || mod ? button('Remove', () => void removePost(p), { className: 'small danger' }) : null,
        );
        return el(
          'div',
          { className: 'pcard' },
          el(
            'div',
            { className: 'pmain' },
            el('div', { className: 'row spread' },
              el('h2', { textContent: i === 0 ? t.data.title : `Re: ${t.data.title}` }), tools),
            el('p', { className: 'meta', title: full(p.created), textContent: `by ${who} » ${full(p.created)}` }),
            body,
            p.data.edited ? el('p', { className: 'meta', textContent: `Edited ${full(p.data.edited)}` }) : null,
          ),
          el(
            'div',
            { className: 'pside' },
            el('div', { className: 'who', textContent: who }),
            ...rolesOfUser(p.author).map((r) => el('div', { className: 'meta', textContent: r })),
            el('div', { className: 'meta', textContent: `Posts: ${await postsBy(p.author)}` }),
          ),
        );
      }),
    );
    const replyBtn = () =>
      canReply
        ? button('Post Reply ↩', () => void postReply(t), { className: 'primary' })
        : el('span', {
            className: 'meta',
            textContent: t.data.locked ? 'This topic is locked.' : 'You can read this category but not post in it.',
          });
    const modTools = mod
      ? el(
          'span',
          { className: 'row' },
          button(t.data.pinned ? 'Unpin' : 'Pin', () => void run('thread-mod', { id: t.id, pinned: !t.data.pinned }), { className: 'small' }),
          button(t.data.locked ? 'Unlock' : 'Lock', () => void run('thread-mod', { id: t.id, locked: !t.data.locked }), { className: 'small' }),
          button('Rename', async () => {
            const title = await tavern.ui.prompt('Topic subject', t.data.title);
            if (title) await run('thread-mod', { id: t.id, title });
          }, { className: 'small' }),
          button('Remove topic', async () => {
            if (await tavern.ui.confirm('Remove this topic and all its replies?', { ok: 'Remove' }))
              await run('thread-mod', { id: t.id, remove: true });
          }, { className: 'small danger' }),
        )
      : null;
    const bar = () =>
      el('div', { className: 'row spread' }, replyBtn(), el('span', { className: 'meta', textContent: `${records.length} post${records.length === 1 ? '' : 's'}` }));
    return [
      el('h1', { textContent: t.data.title }),
      el('div', { className: 'row spread' }, bar(), modTools),
      ...cards,
      bar(),
    ];
  }

  // ---- search ----------------------------------------------------------------------------------
  async function results({ text, scope }) {
    const filter = scope && scope !== 'all' ? { where: { category: scope } } : {};
    const [threads, posts] = await Promise.all([
      tavern.collections.search('threads', text, filter),
      tavern.collections.search('posts', text, filter),
    ]);
    const open = async (threadId) => {
      const t = await tavern.collections.get('threads', threadId);
      if (!t) return note('That thread is gone', 'danger');
      const c = await tavern.collections.get('categories', t.parent);
      go({ kind: 'thread', category: c, thread: t });
    };
    const rows = [
      ...threads.records.map((t) =>
        el('li', {}, button(t.data.title, () => void open(t.id), { className: 'link title' }),
          el('p', { className: 'meta', textContent: `Thread · ${full(t.created)}` })),
      ),
      ...posts.records.map((p) =>
        el('li', {}, button(String(p.data.body).slice(0, 120), () => void open(p.parent), { className: 'link' }),
          el('p', { className: 'meta', textContent: `Reply · ${full(p.created)}` })),
      ),
    ];
    return [
      el('h1', { textContent: 'Search results' }),
      rows.length
        ? el('ul', { className: 'list', ariaLabel: 'Results' }, ...rows)
        : el('p', { className: 'meta', textContent: 'Nothing found.' }),
    ];
  }

  // ---- admin: sections, categories ------------------------------------------------------------
  async function renameSection(s) {
    const name = await tavern.ui.prompt('Section name', s.data.name);
    if (name) await run('section-save', { id: s.id, name });
  }
  async function deleteSection(s) {
    if (await tavern.ui.confirm(`Remove the section **${s.data.name}**? It must be empty.`, { ok: 'Remove' }))
      await run('section-delete', { id: s.id });
  }
  async function editCategory(c) {
    const { button: pressed, values } = await tavern.ui.dialog({
      title: `Edit ${c.data.name}`,
      fields: [
        { type: 'text', key: 'name', label: 'Name', default: c.data.name },
        { type: 'textarea', key: 'about', label: 'Description', default: c.data.about || '' },
        { type: 'select', key: 'access', label: 'Who can use it', default: c.data.access || 'open', options: TMF.ACCESS },
      ],
      buttons: [
        { id: 'delete', label: 'Delete category' },
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: 'Save', kind: 'primary' },
      ],
    });
    if (pressed === 'ok') await run('category-save', { id: c.id, ...values });
    if (pressed === 'delete' && (await tavern.ui.confirm(`Delete **${c.data.name}** and all its threads?`, { ok: 'Delete' }))) {
      await run('category-delete', { id: c.id });
      go({ kind: 'home' }, { push: false });
    }
  }

  async function editPost(p) {
    const out = await compose({ mode: 'edit', heading: 'Edit post', body: p.data.body });
    if (out) await run('post-edit', { id: p.id, body: out.body });
  }
  async function removePost(p) {
    if (!(await tavern.ui.confirm('Remove this post?', { ok: 'Remove' }))) return;
    const out = await run('post-delete', { id: p.id });
    if (out && out.thread) go({ kind: 'category', category: view.category }, { push: false });
  }

  // ---- admin: roles ----------------------------------------------------------------------------
  async function rolesView() {
    if (!perms.admin) return [el('p', { textContent: 'Only forum admins manage roles.' })];
    const host = el('div');
    void TMFRoles.mount(host);
    return [host];
  }

  // ---- wiring ----------------------------------------------------------------------------------
  async function search() {
    const text = $('query').value.trim();
    if (text) go({ kind: 'search', text, scope: $('scope').value });
  }

  async function fillScope() {
    const tree = await TMF.loadTree();
    const current = view.kind === 'category' || view.kind === 'thread' ? view.category.id : 'all';
    $('scope').replaceChildren(
      el('option', { value: 'all', textContent: 'All forums', selected: current === 'all' }),
      ...tree.flatMap((t) =>
        t.categories.map((c) => el('option', { value: c.id, textContent: c.data.name, selected: current === c.id })),
      ),
    );
  }

  async function start() {
    perms = (await TMF.loadPerms()) || perms;
    $('roles-btn').hidden = !perms.admin;
    $('roles-btn').onclick = () => go({ kind: 'roles' });
    $('search').onclick = () => void search();
    $('query').addEventListener('keydown', (e) => e.key === 'Enter' && void search());
    await fillScope();
    // The toolbox opens a tab per category, handing us which one (`key` = the category's id).
    const args = (await tavern.ui.args()) || {};
    const cat = args.category ? await tavern.collections.get('categories', args.category) : null;
    if (cat) go({ kind: 'category', category: cat }, { push: false });
    else go({ kind: 'home' }, { push: false });
    tavern.collections.subscribe('role-settings', {}, async () => {
      perms = (await TMF.loadPerms()) || perms;
      $('roles-btn').hidden = !perms.admin;
      if (view.kind === 'roles') void render();
    });
    tavern.collections.subscribe('categories', {}, () => void fillScope());
  }
  void start();
})();
