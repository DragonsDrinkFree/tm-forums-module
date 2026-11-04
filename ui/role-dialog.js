// The role's permissions window: name, colour, flags and per-category access.
// Answers the values (or null if closed); the caller saves them through the `role-save` action.
/* global tavern, TMF */
(async () => {
  const $ = (id) => document.getElementById(id);
  const { el } = TMF;
  const { role, cats } = (await tavern.ui.args()) || { cats: [] };
  const d = role || {};
  const grants = { ...(d.grants || {}) };

  $('name').value = d.label || '';
  $('color').value = d.color || '#8a8a8a';
  $('admin').checked = !!d.admin;
  $('moderator').checked = !!d.moderator;
  $('banned').checked = !!d.banned;

  $('grants').replaceChildren(
    ...(cats.length
      ? cats.map((c) => {
          const sel = el(
            'select',
            { ariaLabel: `Access to ${c.label}`, onchange: () => (grants[c.id] = sel.value) },
            ...[['', 'Default'], ['read', 'Read'], ['post', 'Read & post'], ['moderate', 'Moderate']].map(
              ([v, l]) => el('option', { value: v, textContent: l, selected: (grants[c.id] || '') === v }),
            ),
          );
          return el('tr', {}, el('td', { textContent: c.label }), el('td', {}, sel));
        })
      : [el('tr', {}, el('td', { className: 'meta', textContent: 'No categories yet.' }))]),
  );

  $('cancel').onclick = () => void tavern.ui.close(null);
  $('save').onclick = () => {
    if (!$('name').value.trim()) return TMF.note('A role needs a name', 'warning');
    void tavern.ui.close({
      name: $('name').value,
      color: $('color').value,
      admin: $('admin').checked,
      moderator: $('moderator').checked,
      banned: $('banned').checked,
      grants: Object.fromEntries(Object.entries(grants).filter(([, v]) => v)),
    });
  };
  $('name').focus();
})();
