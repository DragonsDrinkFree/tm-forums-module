// The roles panel, shared by the module's settings page (the GM's gear) and the Forums tab's Roles
// view. One self-contained, scrolling section:
//   left  : every role (+ New role, which opens the permissions dialog)
//   right : the chosen role's members, with a filter, Add member, and remove
// Roles are core's package roles (members, `role:` readers); the permissions are ours.
/* global tavern, TMF */
window.TMFRoles = (() => {
  const { el, button, run, note } = TMF;

  async function mount(root) {
    let selected = null; // a role's name
    let filter = '';

    const load = async () => {
      const [roles, settings, tree] = await Promise.all([
        tavern.roles.list(),
        tavern.collections.query('role-settings', { limit: 100 }),
        TMF.loadTree(),
      ]);
      const byRole = new Map(settings.records.map((r) => [r.data.role, r.data]));
      const cats = tree.flatMap((t) =>
        t.categories.map((c) => ({ id: c.id, label: `${t.section.data.name} › ${c.data.name}` })),
      );
      // One shape: core's role (label, members) plus our settings for it.
      const all = roles.map((r) => ({ ...r, ...(byRole.get(r.name) || {}), label: r.label }));
      return { all, cats };
    };

    async function openDialog(role, cats) {
      return tavern.ui.dialog({
        page: 'ui/role-dialog.html',
        title: role ? `Edit ${role.label}` : 'New role',
        size: { width: 520, height: 560 },
        data: { role: role || null, cats },
      });
    }

    // `force` redraws always (our own changes). Without it (focus, someone else's change) nothing is
    // rebuilt unless the data differs: rebuilding between a click's press and release loses the click.
    let lastSig = '';
    async function draw(force = true) {
      const { all, cats } = await load();
      const sig = JSON.stringify([all, cats]);
      if (!force && sig === lastSig) return;
      lastSig = sig;
      if (selected && !all.some((r) => r.name === selected)) selected = null;
      const role = all.find((r) => r.name === selected) || null;

      // ---- left: roles
      const left = el(
        'div',
        { className: 'rm-left' },
        el('div', { className: 'rm-head' },
          el('h2', { textContent: 'Roles' }),
          button('+ New role', async () => {
            const out = await openDialog(null, cats);
            if (!out) return;
            const saved = await run('role-save', out);
            if (saved) { selected = saved.role; note('Role created', 'success'); void draw(); }
          }, { className: 'small primary' })),
        el('div', { className: 'scroll' },
          all.length
            ? el('ul', { className: 'list' },
                ...all.map((r) =>
                  el('li', { className: `rrow${r.name === selected ? ' on' : ''}` },
                    el('span', { className: 'swatch', style: `background:${r.color || '#8a8a8a'}` }),
                    button(r.label, () => { selected = r.name; filter = ''; void draw(); }, { className: 'link grow' }),
                    r.admin ? el('span', { className: 'tag', textContent: 'admin' }) : null,
                    r.moderator ? el('span', { className: 'tag', textContent: 'mod' }) : null,
                    r.banned ? el('span', { className: 'tag', textContent: 'banned' }) : null,
                    el('span', { className: 'meta', textContent: String(r.members.length) }))))
            : el('p', { className: 'meta', textContent: 'No roles yet.' })),
      );

      // ---- right: members of the chosen role
      let right;
      if (!role) {
        right = el('div', { className: 'rm-right' },
          el('p', { className: 'meta', textContent: all.length ? 'Pick a role to see its members.' : 'Make a role to begin.' }));
      } else {
        const shown = role.members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
        const search = el('input', {
          value: filter, ariaLabel: 'Filter this role’s members', placeholder: 'Filter members…',
          oninput: () => { filter = search.value; drawList(); },
        });
        const list = el('ul', { className: 'list' });
        const drawList = () => {
          const rows = role.members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
          list.replaceChildren(
            ...(rows.length
              ? rows.map((m) =>
                  el('li', { className: 'row spread' },
                    el('span', { textContent: m.name }),
                    button('Remove', async () => {
                      if (await run('role-members', { role: role.name, remove: [m.id] })) void draw();
                    }, { className: 'small danger' })))
              : [el('li', { className: 'meta', textContent: role.members.length ? 'No one matches.' : 'No members yet.' })]),
          );
        };
        drawList();
        void shown;
        right = el('div', { className: 'rm-right' },
          el('div', { className: 'rm-head' },
            el('h2', { textContent: `${role.label} · ${role.members.length} member${role.members.length === 1 ? '' : 's'}` }),
            el('span', { className: 'row' },
              button('Permissions…', async () => {
                const out = await openDialog(role, cats);
                if (out && (await run('role-save', { role: role.name, ...out }))) {
                  note('Role saved', 'success');
                  void draw();
                }
              }, { className: 'small' }),
              button('Delete', async () => {
                if (!(await tavern.ui.confirm(`Delete the role **${role.label}**?`, { ok: 'Delete' }))) return;
                if (await run('role-delete', { role: role.name })) { selected = null; void draw(); }
              }, { className: 'small danger' }))),
          el('div', { className: 'row' },
            el('span', { className: 'grow' }, search),
            button('+ Add member', async () => {
              const picked = await tavern.ui.dialog({
                page: 'ui/member-picker.html',
                title: `Add members to ${role.label}`,
                size: { width: 460, height: 480 },
                data: { exclude: role.members.map((m) => m.id) },
              });
              if (picked && picked.length && (await run('role-members', { role: role.name, add: picked.map((m) => m.id) }))) {
                void draw();
              }
            }, { className: 'primary' })),
          el('div', { className: 'scroll' }, list),
        );
      }
      root.replaceChildren(el('div', { className: 'rm' }, left, right));
    }

    await draw();
    // Follow changes made elsewhere (the GM's own pickers, another admin).
    tavern.collections.subscribe('role-settings', {}, () => void draw(false));
    window.addEventListener('focus', () => void draw(false));
  }

  return { mount };
})();
