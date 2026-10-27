# muse-talk-to-edit

A talk-to-edit agent for small phone apps, built during the Meta Global AI Developer Hackathon (Oct 26 - Nov 4, 2026) for the "Build for Your World" problem statement.

Everything here was written during the hackathon. Nothing is copied from an existing product's source tree.

## The problem

Apps generated from one sentence are easy to create and hard to change. When a user says "make the save button bigger", a code-writing model tends to regenerate the whole screen, and things that already worked break. The edit looks right in the chat and is wrong in the running app.

## The approach

The agent never writes code. It:

1. reads the current app as HTML plus a numbered list of elements (`data-bve-id`),
2. picks exactly one operation from a fixed tool set (text, style, size, position, visibility, order, duplicate, colour),
3. applies it to the HTML,
4. checks the result, and in later iterations a screenshot, to confirm the requested change landed and nothing else moved.

Because every step is a checked operation on a known element, each edit is reversible and one undo restores the previous screen.

## Meta models

- **Muse Spark 1.3** (`muse-spark-1.3`) over the Responses API runs the observe-act loop and calls the edit tools. Reasoning is replayed across turns through `previous_response_id`.
- **SAM 3.1** segments an object the user points at, for photo cut-outs.
- **Muse Image** generates app icons in the app's own palette.
- **Muse Voice Transcribe** turns spoken Korean into the edit request, because Spark 1.3's audio input is still limited.
- **Muse Spark Open** on Baseten is the open-weight path for the same loop.

## Run it

```bash
cp .env.example .env      # add your Meta Model API key
node src/server.js        # http://localhost:8787
```

No dependencies. Node 18 or newer for `fetch`.

## Layout

- `src/tools.js` - the edit tool set, pure functions over an HTML string
- `src/meta.js` - Responses API client and tool-call loop
- `src/agent.js` - plan, act, verify
- `src/server.js` - static demo app plus `/api/edit`
- `demo/app.html` - a sample mini app used for testing
