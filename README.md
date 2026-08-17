# proper-pi-extensions

A collection of local [pi](https://github.com/badlogic/pi-mono) packages.

## Packages

| Extension | Purpose |
| --- | --- |
| [proper-llm-router](./proper-llm-router/) | Routes each session's first task to an appropriate model. |
| [proper-customs](./proper-customs/) | Adds cross-session history, autocomplete details, fullscreen scrolling compatibility, and model/effort footer colors. |
| [proper-flow](./proper-flow/) | Packages the triage, bug filing, specification, and implementation workflow prompts. |

Each package is self-contained in its own top-level directory. Install one
from this checkout with its directory path:

```bash
pi install ./proper-llm-router
pi install ./proper-customs
pi install ./proper-flow
```
