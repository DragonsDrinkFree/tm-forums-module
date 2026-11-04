// The "write a post" window: a new topic, a reply, or an edit. It only collects the words and
// answers `{ title, body }` (or null when closed); the caller sends them to the module's actions.
/* global tavern, TMF */
(async () => {
  const $ = (id) => document.getElementById(id);
  const args = (await tavern.ui.args()) || {};
  // mode: 'topic' (subject + message), 'reply' (message, maybe quoting), 'edit' (message)
  $('heading').textContent = args.heading || 'New topic';
  $('title').hidden = args.mode !== 'topic';
  $('title').value = args.title || '';
  $('body').value = args.quote
    ? `> **${args.quote.who} wrote:**\n${args.quote.text
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}\n\n`
    : args.body || '';

  const body = $('body');
  const wrap = (mark) => {
    const { selectionStart: a, selectionEnd: b, value } = body;
    body.value = `${value.slice(0, a)}${mark}${value.slice(a, b)}${mark}${value.slice(b)}`;
    body.focus();
    body.setSelectionRange(a + mark.length, b + mark.length);
  };
  document.querySelectorAll('[data-wrap]').forEach((b) => (b.onclick = () => wrap(b.dataset.wrap)));
  $('quote').onclick = () => {
    const { selectionStart: a, selectionEnd: b, value } = body;
    const picked = value.slice(a, b) || '';
    body.setRangeText(`> ${picked.split('\n').join('\n> ')}\n`, a, b, 'end');
    body.focus();
  };

  let previewing = false;
  $('toggle').onclick = async () => {
    previewing = !previewing;
    $('preview').hidden = !previewing;
    body.hidden = previewing;
    $('toggle').textContent = previewing ? 'Edit' : 'Preview';
    if (previewing) await TMF.renderPost($('preview'), body.value);
  };

  $('cancel').onclick = () => void tavern.ui.close(null);
  $('submit').onclick = () => {
    if (args.mode === 'topic' && !$('title').value.trim()) return TMF.note('Give it a subject', 'warning');
    if (!body.value.trim()) return TMF.note('A post needs some words', 'warning');
    void tavern.ui.close({ title: $('title').value, body: body.value });
  };
  (args.mode === 'topic' ? $('title') : body).focus();
})();
