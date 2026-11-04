# Tavern Moot Forums (`tm-forums`)

A web-style forum for Moot Halls and campaigns, built on package **collections** (ADR 0097): posts
are on-demand records that are queried, paged and searched, never synced to everyone on connect.

## What it does

- **Forums toolbox** on the rail:
  - **+ Section** and **+ Category** buttons (forum admins only);
  - sections are collapsible headers;
  - categories are the boards, each with an **unread counter**.
- **Forums tab** (a widget, opened from the Widgets menu, and followed by toolbox clicks):
  - main listing → category → thread, with Back and breadcrumbs;
  - threads sorted by latest activity, pinned first, paged;
  - posts oldest first, with time stamps and "edited" marks;
  - **search** across threads and replies, in one category or all.
- **Roles** (made by admins, in the tab's **Roles** button):
  - flags: *admin* (makes sections, categories and roles), *moderator* (pin, lock, edit and remove
    everywhere), *banned* (read only);
  - per-category access: Read, Read & post, Moderate;
  - categories are *open*, *announcements* (everyone reads, roles post) or *private* (only roles
    with access can even see it; enforced by core through record readers).
- The GM (a hall's admins) is always a forum admin.

## Layout

| File                | Role                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `tavern.json`       | collections, rail toolbox, Forums widget, permissions             |
| `rules.js`          | every rule, on the server: permissions, actions, reader labels    |
| `ui/rail.*`         | the toolbox                                                       |
| `ui/board.*`        | the workspace tab                                                 |
| `ui/common.js`      | helpers shared by both                                            |
| `Feedback/`         | gaps and difficulties for the core team                           |
| `reference/`        | the developer guide and ADRs                                      |

Pages read collections directly and **write only through actions** (there's no
`collections.write` hook), so `rules.js` is the single place permissions live.

## Trying it

1. In the app: Library → **Load package folder…** → this folder.
2. Campaign: Game system → add **Forums**, and allow `ui.rail:forums` and `ui.widget:board`.
   Hall: Modules → add it and allow the same.
3. Open the **Forums** toolbox → **+ Section**, then **+ Category**.
4. Open **Forums** from the Widgets menu for the tab.

CLI checks (from the installed copy): `node packages/cli/dist/cli.js validate <this folder>` and
`check`. Both pass.

## Known limits (see `Feedback/FEEDBACK.md`)

- **The toolbox can't open the tab itself** (F01). Open it once from the Widgets menu; it then
  follows toolbox clicks. One tab shows the whole forum, not one tab per category.
- **Roles are records, not manifest roles** (F02), so private categories list readers per member.
  Fine for communities of hundreds.
- New members see all existing posts as unread until they open each category.
- Posts are plain text (no Markdown yet); no moving threads between categories; no per-thread read
  state, only per category.
- Not yet run inside the app: expect small fixes on first load.
