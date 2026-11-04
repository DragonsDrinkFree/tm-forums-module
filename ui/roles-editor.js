// The roles editor, shared by the module's settings page (the GM's gear) and the Forums tab's
// Roles view (for forum admins who aren't the GM). Roles themselves are core's package roles
// (members, pickers, `role:` readers); this adds what each means for the forums.
/* global tavern, TMF */
window.TMFRoles = (() => {
  const { el, button, run, note } = TMF;

  async function mount(root) {
    let selected = null; // a role's name, 'new', or null

    async function draw() {
      const [roles, settings, tree] = await Promise.all([
        tavern.roles.list(),
        tavern.collections.query('role-settings', { limit: 100 }),
        TMF.loadTree(),
      ]);
      const byRole = new Map(settings.records.map((r) => [r.data.role, r.data]));
      const cats = tree.flatMap((t) => t.categories.map((c) => ({ ...c, sectionName: t.section.data.name })));
      const picked = roles.find((r) => r.name === selected);

      const list = el(
        'div',
        {},
        el('h2', { textContent: 'Forum roles' }),
        el(
          'ul',
          { className: 'list' },
          ...roles.map((r) => {
            const d = byRole.get(r.name) || {};
            return el(
              'li',
              {},
              el('span', { className: 'swatch', style: `background:${d.color || '#8a8a8a'}` }),
              button(r.label, () => { selected = r.name; void draw(); }, { className: 'link' }),
              d.admin ? el('span', { className: 'tag', textContent: 'admin' }) : null,
              d.moderator ? el('span', { className: 'tag', textContent: 'mod' }) : null,
              d.banned ? el('span', { className: 'tag', textContent: 'banned' }) : null,
              el('p', { className: 'meta', textContent: `${r.members.length} members` }),
            );
          }),
        ),
        button('+ New role', () => { selected = 'new'; void draw(); }),
      );
      const editor =
        selected === 'new' || picked
          ? editorFor(picked, picked ? byRole.get(picked.name) || {} : {}, cats)
          : el('p', { className: 'meta', textContent: 'Pick a role, or make a new one.' });
      root.replaceChildren(el('div', { className: 'roles' }, list, editor));
    }

    function editorFor(role, d, cats) {
      const state = {
        members: role ? role.members.map((m) => ({ ...m })) : [],
        grants: { ...(d.grants || {}) },
      };
      const name = el('input', { value: role ? role.label : '', ariaLabel: 'Role name', placeholder: 'Role name' });
      const color = el('input', { type: 'color', value: d.color || '#8a8a8a', ariaLabel: 'Colour' });
      const flag = (label, checked) => {
        const box = el('input', { type: 'checkbox', checked: !!checked });
        return { box, node: el('label', { className: 'row' }, box, label) };
      };
      const admin = flag('Forum admin: makes sections, categories and roles', d.admin);
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
      const drawChips = () =>
        chips.replaceChildren(
          ...state.members.map((m) =>
            el('span', { className: 'tag' }, `${m.name} `,
              button('×', () => { state.members = state.members.filter((x) => x.id !== m.id); drawChips(); },
                { className: 'link', ariaLabel: `Remove ${m.name}` })),
          ),
        );
      drawChips();
      const find = el('input', { ariaLabel: 'Find a member', placeholder: 'Find a member to add…' });
      const found = el('div', { className: 'row' });
      find.addEventListener('input', async () => {
        if (find.value.trim().length < 2) return found.replaceChildren();
        const { members } = await tavern.members.list({ query: find.value.trim(), limit: 8 });
        found.replaceChildren(
          ...members
            .filter((m) => !state.members.some((x) => x.id === m.id))
            .map((m) =>
              button(`+ ${m.name}`, () => {
                state.members.push({ id: m.id, name: m.name });
                found.replaceChildren();
                find.value = '';
                drawChips();
              }, { className: 'small' }),
            ),
        );
      });

      return el(
        'div',
        { className: 'compose' },
        el('h2', { textContent: role ? `Edit ${role.label}` : 'New role' }),
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
              ...(role ? { role: role.name } : {}),
              name: name.value,
              color: color.value,
              admin: admin.box.checked,
              moderator: mod.box.checked,
              banned: banned.box.checked,
              grants: Object.fromEntries(Object.entries(state.grants).filter(([, v]) => v)),
              members: state.members.map((m) => m.id),
            });
            if (saved) { selected = saved.role; note('Role saved', 'success'); void draw(); }
          }, { className: 'primary' }),
          role
            ? button('Delete role', async () => {
                if (await tavern.ui.confirm(`Delete the role **${role.label}**?`, { ok: 'Delete' })) {
                  await run('role-delete', { role: role.name });
                  selected = null;
                  void draw();
                }
              }, { className: 'danger' })
            : null,
        ),
      );
    }

    await draw();
    // Follow changes made elsewhere (the GM's own member pickers, another admin).
    tavern.collections.subscribe('role-settings', {}, () => void draw());
  }

  return { mount };
})();
