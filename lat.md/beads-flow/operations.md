# Runtime operations

beads-flow installs repository-owned workflow resources without taking ownership of the full Beads user directory.

## Link installation

`beads-flow/install.sh link` creates the user formula and rail directories, then links each managed runtime file individually.

A matching regular file may be replaced with its repository link during migration. A different regular file is preserved and stops installation. Existing symlinks may be redirected to the current checkout.

## Drift check

`beads-flow/install.sh check` verifies every managed link, rail executability, and the `no-hooks` invariant.

The check runs `bd formula show` from outside a Beads project and requires each formula's reported source to be its user-level link. This catches missing links and higher-priority accidental sources during installation validation.

## Formula precedence

Beads searches active-project and checkout-local formula directories before `~/.beads/formulas/`.

A repository may intentionally shadow a user formula with `.beads/formulas/<name>.formula.toml`. The bundle check isolates formula resolution from project-local registries so it verifies the global installation itself.

## User-directory ownership

The installer leaves machine-specific Beads state unmanaged.

`~/.beads/no-hooks` remains a real empty directory because Git worktrees point `core.hooksPath` there. Shared-server data and any future Beads-managed files can coexist beside the linked formulas and rail without entering this repository.
