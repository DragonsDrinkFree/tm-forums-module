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
            TMF.unreadIn(c.id, perms.id),
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
              el('span', {
                className: 'badge',
                textContent: unread > 99 ? '99+' : String(unread),
                hidden: !unread,
              }),
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

  async function category(cat) {
    const level = levelOf(cat.id);
    if (!view.opened) {
      // Remember what was new when it was opened, so threads stay highlighted while the counter clears.
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
    const row = async (t) =>
      el(
        'li',
        { className: t.data.lastPost > readAtOnOpen && t.author !== perms.id ? 'unread' : '' },
        el(
          'div',
          { className: 'row spread' },
          el(
            'span',
            { className: 'grow' },
            button(t.data.title, () => go({ kind: 'thread', category: cat, thread: t }), {
              className: 'link title',
            }),
            t.data.pinned ? el('span', { className: 'tag', textContent: 'Pinned' }) : null,
            t.data.locked ? el('span', { className: 'tag', textContent: 'Locked' }) : null,
            el('p', {
              className: 'meta',
              textContent: `Started by ${await nameOf(t.author)} · ${full(t.created)}`,
            }),
          ),
          el('span', {
            className: 'meta',
            title: full(t.data.lastPost),
            textContent: `${t.data.replies || 0} repl${t.data.replies === 1 ? 'y' : 'ies'} · last ${when(t.data.lastPost)}`,
          }),
        ),
      );
    const rows = await Promise.all([...pinned.records, ...rest.records].map(row));
    const out = [
      el(
        'div',
        { className: 'row spread' },
        el('h1', { textContent: cat.data.name }),
        perms.admin ? button('Edit category', () => void editCategory(cat), { className: 'small' }) : null,
      ),
      cat.data.about ? el('p', { className: 'meta', textContent: cat.data.about }) : null,
      rows.length
        ? el('ul', { className: 'list', ariaLabel: 'Threads, newest activity first' }, ...rows)
        : el('p', { className: 'meta', textContent: 'No threads yet.' }),
    ];
    if (rest.next) {
      out.push(
        button('Load older threads', () => {
          view.pages = (view.pages || 1) + 1;
          void render();
        }),
      );
    }
    if (rank(level) >= rank('post')) out.push(newThreadForm(cat));
    else out.push(el('p', { className: 'meta', textContent: 'You can read this category but not post in it.' }));
    return out;
  }

  function newThreadForm(cat) {
    const title = el('input', { ariaLabel: 'Thread title', placeholder: 'Title' });
    const text = el('textarea', { ariaLabel: 'First post', rows: 5, placeholder: 'Say something…' });
    return el(
      'div',
      { className: 'compose' },
      el('h2', { textContent: 'Start a thread' }),
      title,
      text,
      button(
        'Post thread',
        async () => {
          const made = await run('thread-create', { category: cat.id, title: title.value, body: text.value });
          if (made) go({ kind: 'thread', category: cat, thread: made.thread });
        },
        { className: 'primary' },
      ),
    );
  }

  async function thread(t, cat) {
    const level = levelOf(cat.id);
    const mod = rank(level) >= rank('moderate');
    const { records } = await tavern.collections.query('posts', { parent: t.id, sort: 'created', limit: 100 });
    void markRead(cat.id);
    const posts = await Promise.all(
      records.map(async (p) => {
        const mine = p.author === perms.id;
        return el(
          'li',
          { className: 'post' },
          el(
            'div',
            {},
            el('div', { className: 'who', textContent: await nameOf(p.author) }),
            el('div', { className: 'meta', title: full(p.created), textContent: when(p.created) }),
          ),
          el(
            'div',
            {},
            el('p', { className: 'text', textContent: p.data.body }),
            p.data.edited
              ? el('p', { className: 'meta', textContent: `Edited ${when(p.data.edited)}` })
              : null,
            mine || mod
              ? el(
                  'div',
                  { className: 'row' },
                  button('Edit', () => void editPost(p), { className: 'small' }),
                  button('Remove', () => void removePost(p), { className: 'small danger' }),
                )
              : null,
          ),
        );
      }),
    );
    const out = [el('h1', { textContent: t.data.title })];
    if (mod) {
      out.push(
        el(
          'div',
          { className: 'row' },
          button(t.data.pinned ? 'Unpin' : 'Pin', () => void run('thread-mod', { id: t.id, pinned: !t.data.pinned }), {
            className: 'small',
          }),
          button(t.data.locked ? 'Unlock' : 'Lock', () => void run('thread-mod', { id: t.id, locked: !t.data.locked }), {
            className: 'small',
          }),
          button('Rename', async () => {
            const title = await tavern.ui.prompt('Thread title', t.data.title);
            if (title) await run('thread-mod', { id: t.id, title });
          }, { className: 'small' }),
          button('Remove thread', async () => {
            if (await tavern.ui.confirm('Remove this thread and all its replies?', { ok: 'Remove' }))
              await run('thread-mod', { id: t.id, remove: true });
          }, { className: 'small danger' }),
        ),
      );
    }
    out.push(el('ul', { className: 'list', ariaLabel: 'Posts, oldest first' }, ...posts));
    if (t.data.locked && !mod) out.push(el('p', { className: 'meta', textContent: 'This thread is locked.' }));
    else if (rank(level) >= rank('post')) {
      const text = el('textarea', { ariaLabel: 'Reply', rows: 4, placeholder: 'Write a reply…' });
      out.push(
        el(
          'div',
          { className: 'compose' },
          text,
          button(
            'Reply',
            async () => {
              if (await run('reply', { thread: t.id, body: text.value })) text.value = '';
            },
            { className: 'primary' },
          ),
        ),
      );
    }
    return out;
  }

  // ---- search ----------------------------------------------------------------------------------
  async function results({ text, scope }) {
    const where = scope && scope !== 'all' ? { category: scope } : undefined;
    const [threads, posts] = await Promise.all([
      tavern.collections.search('threads', text, { where }),
      tavern.collections.search('posts', text, { where }),
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
    const body = await tavern.ui.prompt('Edit post', p.data.body);
    if (body) await run('post-edit', { id: p.id, body });
  }
  async function removePost(p) {
    if (!(await tavern.ui.confirm('Remove this post?', { ok: 'Remove' }))) return;
    const out = await run('post-delete', { id: p.id });
    if (out && out.thread) go({ kind: 'category', category: view.category }, { push: false });
  }

  // ---- admin: roles ----------------------------------------------------------------------------
  async function rolesView() {
    if (!perms.admin) return [el('p', { textContent: 'Only forum admins manage roles.' })];
    const [{ records: roles }, tree] = await Promise.all([
      tavern.collections.query('roles', { sort: 'name', limit: 100 }),
      TMF.loadTree(),
    ]);
    const cats = tree.flatMap((t) => t.categories.map((c) => ({ ...c, sectionName: t.section.data.name })));
    const picked = view.roleId === 'new' ? null : roles.find((r) => r.id === view.roleId);
    const list = el(
      'div',
      {},
      el('h2', { textContent: 'Roles' }),
      el(
        'ul',
        { className: 'list' },
        ...roles.map((r) =>
          el(
            'li',
            {},
            el('span', { className: 'swatch', style: `background:${r.data.color}` }),
            button(r.data.name, () => { view.roleId = r.id; void render(); }, { className: 'link' }),
            r.data.admin ? el('span', { className: 'tag', textContent: 'admin' }) : null,
            r.data.moderator ? el('span', { className: 'tag', textContent: 'mod' }) : null,
            r.data.banned ? el('span', { className: 'tag', textContent: 'banned' }) : null,
            el('p', { className: 'meta', textContent: `${(r.data.members || []).length} members` }),
          ),
        ),
      ),
      button('+ New role', () => { view.roleId = 'new'; void render(); }),
    );
    const editor =
      view.roleId === 'new' || picked
        ? roleEditor(picked, cats)
        : el('p', { className: 'meta', textContent: 'Pick a role, or make a new one.' });
    return [el('div', { className: 'roles' }, list, editor)];
  }

  function roleEditor(role, cats) {
    const d = role ? role.data : { name: '', color: '#8a8a8a', grants: {}, members: [] };
    const state = { members: [...(d.members || [])], grants: { ...(d.grants || {}) } };
    const name = el('input', { value: d.name, ariaLabel: 'Role name', placeholder: 'Role name' });
    const color = el('input', { type: 'color', value: d.color || '#8a8a8a', ariaLabel: 'Colour' });
    const flag = (label, checked) => {
      const box = el('input', { type: 'checkbox', checked: !!checked });
      return { box, node: el('label', { className: 'row' }, box, label) };
    };
    const admin = flag('Forum admin: creates sections and categories, manages roles', d.admin);
    const mod = flag('Moderator everywhere: pin, lock, edit and remove', d.moderator);
    const banned = flag('Banned: can read, cannot post', d.banned);

    const grantRows = cats.map((c) => {
      const sel = el(
        'select',
        { ariaLabel: `Access to ${c.data.name}`, onchange: () => (state.grants[c.id] = sel.value) },
        ...[['', 'Default'], ['read', 'Read'], ['post', 'Read & post'], ['moderate', 'Moderate']].map(
          ([v, l]) => el('option', { value: v, textContent: l, selected: (state.grants[c.id] || '') === v }),
        ),
      );
      return el('tr', {}, el('td', { textContent: `${c.sectionName} › ${c.data.name}` }), el('td', {}, sel));
    });

    const chips = el('div', { className: 'row' });
    const drawChips = async () => {
      chips.replaceChildren(
        ...(await Promise.all(
          state.members.map(async (id) =>
            el('span', { className: 'tag' }, `${await nameOf(id)} `,
              button('×', () => { state.members = state.members.filter((m) => m !== id); void drawChips(); },
                { className: 'link', ariaLabel: 'Remove member' })),
          ),
        )),
      );
    };
    void drawChips();
    const find = el('input', { ariaLabel: 'Find a member', placeholder: 'Find a member to add…' });
    const found = el('div', { className: 'row' });
    find.addEventListener('input', async () => {
      if (find.value.trim().length < 2) return found.replaceChildren();
      const { members } = await tavern.members.list({ query: find.value.trim(), limit: 8 });
      found.replaceChildren(
        ...members
          .filter((m) => !state.members.includes(m.id))
          .map((m) => button(`+ ${m.name}`, () => {
            state.members.push(m.id);
            found.replaceChildren();
            find.value = '';
            void drawChips();
          }, { className: 'small' })),
      );
    });

    return el(
      'div',
      { className: 'compose' },
      el('h2', { textContent: role ? `Edit ${d.name}` : 'New role' }),
      el('div', { className: 'row' }, name, color),
      admin.node, mod.node, banned.node,
      el('h2', { textContent: 'Category access' }),
      el('p', { className: 'meta', textContent: 'Private categories are visible only to roles granted Read or more.' }),
      cats.length
        ? el('table', { className: 'grants' }, el('tbody', {}, ...grantRows))
        : el('p', { className: 'meta', textContent: 'No categories yet.' }),
      el('h2', { textContent: 'Members' }),
      chips, find, found,
      el(
        'div',
        { className: 'row' },
        button('Save role', async () => {
          const saved = await run('role-save', {
            id: role ? role.id : undefined, name: name.value, color: color.value,
            admin: admin.box.checked, moderator: mod.box.checked, banned: banned.box.checked,
            grants: Object.fromEntries(Object.entries(state.grants).filter(([, v]) => v)),
            members: state.members,
          });
          if (saved) { view.roleId = saved.id; note('Role saved', 'success'); }
        }, { className: 'primary' }),
        role
          ? button('Delete role', async () => {
              if (await tavern.ui.confirm(`Delete the role **${d.name}**?`, { ok: 'Delete' })) {
                await run('role-delete', { id: role.id });
                view.roleId = undefined;
              }
            }, { className: 'danger' })
          : null,
      ),
    );
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

  async function follow(record) {
    // The toolbox asked us to show something (rules.js `nav-set`).
    const { category: catId, thread: threadId } = record.data;
    if (!catId) return;
    const cat = await tavern.collections.get('categories', catId);
    if (!cat) return;
    if (threadId) {
      const t = await tavern.collections.get('threads', threadId);
      if (t) return go({ kind: 'thread', category: cat, thread: t }, { push: view.kind !== 'home' });
    }
    go({ kind: 'category', category: cat }, { push: view.kind !== 'home' });
    void fillScope();
  }

  async function start() {
    perms = (await TMF.loadPerms()) || perms;
    $('roles-btn').hidden = !perms.admin;
    $('roles-btn').onclick = () => go({ kind: 'roles' });
    $('search').onclick = () => void search();
    $('query').addEventListener('keydown', (e) => e.key === 'Enter' && void search());
    await fillScope();
    // Anything already waiting from the toolbox, then everything that arrives while we're open.
    const waiting = await tavern.collections.query('nav', { limit: 1 });
    if (waiting.records[0] && Date.now() - waiting.records[0].data.stamp < 30_000) {
      await follow(waiting.records[0]);
    } else go({ kind: 'home' }, { push: false });
    tavern.collections.subscribe('nav', {}, (changes) => {
      const c = changes.find((x) => x.record);
      if (c) void follow(c.record);
    });
    tavern.collections.subscribe('roles', {}, async () => {
      perms = (await TMF.loadPerms()) || perms;
      $('roles-btn').hidden = !perms.admin;
      if (view.kind === 'roles') void render();
    });
    tavern.collections.subscribe('categories', {}, () => void fillScope());
  }
  void start();
})();
