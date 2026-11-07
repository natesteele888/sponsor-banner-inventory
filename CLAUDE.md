# Sponsor Banner Inventory — notes for Claude sessions

Standalone app replacing the one-time "35 banner photos vs. the 2026 sponsor
list" Claude artifact. Architecture, setup steps and the Apps Script
deployment checklist are in [README.md](README.md) — read that first.

Styled to match the LYBS Dashboard's own look (navy/gold/blue, DM Sans +
Bebas Neue) — see `nate-brain/playbooks/look.md` for the token values and
why this isn't a Sandlot copy. Linked from the Dashboard's Board nav
(`lybs-reporting/app.js` NAV_CATEGORIES), admin-gated for now.

## Nate AI Brain (shared memory)
This app is one of several that share parts and lessons through the private
`natesteele888/nate-brain` repo.
- **Start here, every session:** get the latest brain
  (`git -C /Volumes/AutoNuvo_1/nate-brain pull --ff-only`; a cloud session's attached
  copy is already current), then read `state/FRESHNESS.md`: what every app's code
  says right now, what's in flight, and where the brain's notes are behind. **If a
  note disagrees with it, the code wins.** Pull this repo too before you edit; never
  work in a copy that's behind.
- **Live and relied on:** only the Bengals coaching app (ASL-Bengals dev2). Test
  before you push there. Everything else is safe to improve and push freely.
- **Apps & links:** `apps.md` lists every app's live link, repo and Toolbox id,
  explains Nate's Toolbox app (his hub, natesteele888.github.io/apps/toolbox/) and
  how to send it updates. Never guess an app URL; if one changes, update
  `natesteele888/apps/registry.json`.
- **Read first:** before building, check `lessons.md`, and check `parts.md` for
  anything that already exists (sign-in, rules, calendar export, offline install,
  rosters…). Reuse the keeper version and follow its `playbooks/<id>.md`.
- **Write back:** when you hit a bug, gotcha or better way another project would
  want, add a dated entry to `nate-brain/lessons.md`. If you change a shared part
  here, update its entry in `parts.md`.
- Know-how only in nate-brain: never copy names, contact info, stats or secrets into it.

In a Claude session, attach the repo with "add natesteele888/nate-brain" so it can be read and updated.

## Privacy
Sponsor business-contact info (names, emails, phones for local business
owners) lives in this app's own Sheet — that's its whole purpose. It must
never flow into `lybs-reporting` (see that repo's CLAUDE.md, Contacts
Carve-Out section) or into `nate-brain` (know-how only, no real data —
see nate-brain/README.md).
