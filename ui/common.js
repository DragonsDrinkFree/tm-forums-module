// Helpers shared by the Forums toolbox (rail.html) and the Forums tab (board.html).
// Pages only ask: every rule is enforced by rules.js on the server.
/* global tavern */
window.TMF = (() => {
  const el = (tag, props = {}, ...children) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return e;
  };
  const button = (label, onClick, extra = {}) =>
    el('button', { type: 'button', textContent: label, onclick: onClick, ...extra });

  const when = (ms) => {
    const d = new Date(ms);
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
    return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  };
  const full = (ms) => new Date(ms).toLocaleString();

  const names = new Map();
  const nameOf = (id) => {
    if (!id) return Promise.resolve('Someone');
    if (!names.has(id)) {
      names.set(
        id,
        tavern.members.get(id).then((m) => (m ? m.name : 'Former member')),
      );
    }
    return names.get(id);
  };

  const note = (text, level = 'info') => {
    try {
      void tavern.ui.notify(text, level);
    } catch {
      /* the page still works without the toast */
    }
  };

  /** Run one of rules.js's actions; an `{ error }` answer or a refusal is shown, and gives null. */
  async function run(action, args = {}) {
    try {
      const out = await tavern.actions.run(action, args);
      if (out && out.error) {
        note(out.error, 'danger');
        return null;
      }
      return out ?? {};
    } catch (err) {
      note(err.message || String(err), 'danger');
      return null;
    }
  }

  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* sandboxed storage may be unavailable */
      }
    },
  };

  const ACCESS = [
    { value: 'open', label: 'Open: everyone reads and posts' },
    { value: 'announce', label: 'Announcements: everyone reads, roles post' },
    { value: 'private', label: 'Private: only roles with access' },
  ];

  const loadPerms = () => run('perms');

  /** Sections with their categories, as the viewer may see them. */
  async function loadTree() {
    const [secs, cats] = await Promise.all([
      tavern.collections.query('sections', { sort: 'order', limit: 100 }),
      tavern.collections.query('categories', { sort: 'order', limit: 100 }),
    ]);
    return secs.records.map((s) => ({
      section: s,
      categories: cats.records.filter((c) => c.parent === s.id),
    }));
  }

  /** Posts in a category by other members since the viewer last looked. Capped, to stay cheap. */
  async function unreadIn(categoryId, me) {
    const marks = await tavern.collections.query('reads', {
      where: { category: categoryId },
      limit: 1,
    });
    const at = marks.records[0] ? marks.records[0].data.at : 0;
    const where = { category: categoryId, at: { gt: at } };
    const [total, mine] = await Promise.all([
      tavern.collections.count('posts', { where }),
      tavern.collections.count('posts', { where, author: me }),
    ]);
    return Math.max(0, total - mine);
  }

  return { el, button, when, full, nameOf, note, run, store, ACCESS, loadPerms, loadTree, unreadIn };
})();
