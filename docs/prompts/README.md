# Prompts and Project Memory

This folder is the project's shared memory for the owners and for every AI agent that works on Luxcores. It holds four kinds of record, all in Markdown and all committed to git, so a new agent can read the history instead of asking for it again.

| Kind | What goes in | File naming |
|---|---|---|
| Prompts | The prompt that started a session, verbatim, with a short header | `YYYY-MM-DD-topic.md` |
| Handovers | State at the end of a session: what is done, what is next, what is open | `handover-YYYY-MM-DD-topic.md` |
| Progress | One dated entry per milestone or notable change, newest first | `progress.md` |
| Knowledge | Facts that cost time to find and that the code does not show | `knowledge-topic.md` |

The live status of the repo stays in `docs/HANDOVER.md`. This folder keeps the history behind it.

## Conventions

- Keep the owners' prompts word for word. The prose checker skips prompt files, because they hold the owners' own words, and checks everything else in this folder.
- Start each handover with the commit hash it describes, then list verified facts and unverified claims separately. Mark anything unverified as `[UNVERIFIED]`.
- Write a knowledge note when you spent real effort learning something: a version quirk, a failed approach, an environment fact. Name the source, such as a command you ran or a document you read.
- Never store secrets, tokens or personal data here.

## Index

| File | Kind | Summary |
|---|---|---|
| `claude-code-kickoff.md` | Prompt | Kickoff for milestone M1 (map generation) and the browser smoke test against the Playwright container |
| `2026-10-16-review-decisions.md` | Prompt | Owner answers to the M1 review: black hole removed, Core max HP, glow removed, checker tiers, `vone/` |
| `2026-10-16-backend-nestjs.md` | Prompt | Request for the NestJS multiplayer backend, entity labels and this folder |
| `handover-2026-10-16-backend.md` | Handover | State after the backend, labels and this folder: what is verified, what is not, and what to remember |
| `progress.md` | Progress | Dated log of milestones with commit hashes |
