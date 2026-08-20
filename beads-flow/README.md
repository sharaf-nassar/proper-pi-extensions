# beads-flow

Version-controlled Beads workflow support for `proper-flow`.

## Contents

- `formulas/` contains the global `constitution` and `speckit` formulas.
- `rail/implement-ready.sh` owns implementation worktrees, integration locking,
  verification, recovery, cleanup, and audit-log staging.
- `test/` contains dependency-free shell regression tests.

## Install

Link the managed runtime files into Beads' user-level search paths:

```bash
./install.sh link
```

The installer creates individual links under `~/.beads/formulas/` and
`~/.beads/rail/`. It creates `~/.beads/no-hooks/` as a real empty directory.
It refuses to replace a different regular file.

Do not link the whole `~/.beads` directory. Beads may also use that namespace
for machine-specific runtime state such as a shared Dolt server.

Repository-local formulas under `.beads/formulas/` have higher precedence than
these user-level formulas. Check the installed links and resolved sources with:

```bash
./install.sh check
```

## Test

```bash
./test.sh
```

Tests execute the rail from this checkout. They do not depend on the installed
`~/.beads/rail/implement-ready.sh` link.
