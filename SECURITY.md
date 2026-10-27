# Security notes

- No credentials are committed. The Meta Model API key is read from `META_API_KEY` in the environment.
- `.env` is gitignored; `.env.example` carries only empty placeholders.
- The API key used during the hackathon lives outside this repository, as a mode-600 file.
- Editing is limited to a whitelist of deterministic operations on an HTML string. The model never writes code and never gets shell or network tools.
- Pushes to this repository use a deploy key scoped to this single repository, write access only.
