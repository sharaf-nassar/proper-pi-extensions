# proper-pi-extensions

A collection of local [pi](https://github.com/badlogic/pi-mono) packages.

## Packages

| Extension | Purpose |
| --- | --- |
| [proper-llm-router](./proper-llm-router/) | Routes each session's first task to an appropriate model. |
| [proper-base](./proper-base/) | Provides baseline history, prompt editing, cancellation, fullscreen navigation, image previews, and footer layout. |
| [proper-flow](./proper-flow/) | Packages the triage, bug filing, specification, and implementation workflow prompts. |

Each package is self-contained in its own top-level directory. Install one
from this checkout with its directory path:

```bash
pi install ./proper-llm-router
pi install ./proper-base
pi install ./proper-flow
```
