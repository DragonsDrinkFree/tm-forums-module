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
      // A category's section is `data.section` (older ones: the parent they were made under).
      categories: cats.records.filter((c) => (c.data.section || c.parent) === s.id),
    }));
  }

  /**
   * Is there anything new in a category? True when another member has posted since the viewer
   * last looked. One record is enough to know, so this never counts.
   */
  async function hasUnread(categoryId, me) {
    const marks = await tavern.collections.query('reads', {
      where: { category: categoryId },
      limit: 1,
    });
    const at = marks.records[0] ? marks.records[0].data.at : 0;
    const fresh = await tavern.collections.query('posts', {
      where: { category: categoryId, at: { gt: at } },
      notAuthor: me,
      limit: 1,
    });
    return fresh.records.length > 0;
  }

  /** Another member's writing: Markdown, but with no live `@action` links (they'd run as the reader). */
  async function renderPost(target, body) {
    try {
      target.innerHTML = await tavern.markdown.render(body, { enrichers: false });
    } catch {
      target.textContent = body;
    }
  }

  return { el, button, when, full, nameOf, note, run, store, ACCESS, loadPerms, loadTree, hasUnread, renderPost };
})();
