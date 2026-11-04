// Look up members to add to a role. Answers [{ id, name }] (or null if closed).
/* global tavern, TMF */
(async () => {
  const $ = (id) => document.getElementById(id);
  const { el, button } = TMF;
  const { exclude = [] } = (await tavern.ui.args()) || {};
  const picked = new Map();

  const drawPicked = () => {
    $('picked').replaceChildren(
      ...[...picked.values()].map((m) =>
        el('span', { className: 'tag' }, `${m.name} `,
          button('×', () => { picked.delete(m.id); drawPicked(); void search(); },
            { className: 'link', ariaLabel: `Unselect ${m.name}` })),
      ),
    );
    $('done').textContent = picked.size ? `Add ${picked.size}` : 'Add';
  };

  let token = 0;
  async function search() {
    const mine = ++token;
    const text = $('find').value.trim();
    const { members } = await tavern.members.list({ ...(text ? { query: text } : {}), limit: 30 });
    if (mine !== token) return;
    const rows = members.filter((m) => !exclude.includes(m.id));
    $('found').replaceChildren(
      ...(rows.length
        ? rows.map((m) =>
            el('li', { className: 'row spread' },
              el('span', { textContent: m.name }),
              picked.has(m.id)
                ? el('span', { className: 'meta', textContent: 'Selected' })
                : button('+ Add', () => { picked.set(m.id, { id: m.id, name: m.name }); drawPicked(); void search(); },
                    { className: 'small' })),
          )
        : [el('li', { className: 'meta', textContent: 'No one found.' })]),
    );
  }

  $('find').addEventListener('input', () => void search());
  $('cancel').onclick = () => void tavern.ui.close(null);
  $('done').onclick = () => void tavern.ui.close([...picked.values()]);
  drawPicked();
  await search();
  $('find').focus();
})();
