# Automatic updates

proper-base records native background update availability and installs it on a later interactive launch, then replaces the process after graceful shutdown when replay is safe. Automation remains outside its update boundary.

## Startup behavior

Only the first startup event in a process can install previously recorded updates.

Without a prior-launch readiness record, there is no inventory subprocess, installer, updater widget, or restart. Pi's own background checks remain unchanged; eligible update notices explain that restarting installs detected updates. Reloads and session replacements never repeat installation, and offline or explicit opt-out launches neither observe nor install updates.

Automatic updating requires Pi 0.86+, Node 22.19+, and a recognized npm Pi installation under `lib/node_modules` on Linux/macOS. RPC, print/JSON, SDK, non-TTY, Bun, Windows, pnpm, and installer-managed launches are skipped. This is an extension-only implementation, not a universal pre-launch guarantee. The updater is registered once by proper-base's existing entry point, after base lifecycle handlers; it is not a second Pi extension.

A single temporary widget shows the current operation and elapsed seconds, refreshed once per second and when a recognized native progress line arrives. It covers inventory, package checks/updates, Pi checks/updates, verification, and restart preparation without a typing hint. No-op checks leave no success chatter. Changes show at most four named revisions plus a remaining count. Failures give a manual command rather than exposing captured output, private repository URLs, or registry credentials. Notices never enter model context. Native stdout is framed into bounded lines; only recognized progress is mapped to safe labels, with private git URLs and self-update command arguments omitted. Unrecognized output is ignored. This parsing drives display only, never update or restart decisions. The refresh timer and widget are cleared on every completion, failure, and cancellation path.

Pi's native `update --self`, `update --extensions`, or `update --all` owns installation semantics, selected from recorded Pi/package availability. Global-only records use `--no-approve`; project records require current explicit trust and use `--approve`. Pins stay pinned and local checkouts/direct extension files remain untouched. Native availability checks skip pinned and missing sources, so this extension is not a proactive repair or ref-reconciliation pass.

## Next-launch readiness

Positive native check results authorize a later process, never installation during the process that observed them.

Legacy proper-updater names for state files, flags, environment variables, widgets, and process symbols remain stable so existing preferences and readiness are reused without migration. Remove any old standalone package registration after upgrading proper-base.

Empty exclusive marker files under the agent directory's `proper-updater-ready/` encode Pi, global packages, or a hashed project path plus a process-random launch identifier. The identifier survives extension reloads but not process replacement. Pi/global markers apply across working directories; project markers require the same working directory and current project trust. Only regular, correctly named marker files from earlier processes are eligible. Tiny synchronous writes persist a notice before an immediate quit without storing package sources or credentials.

Readiness is checked before expensive work and rechecked under the installer lock. Successful installation plus valid post-update inventory clears exactly the consumed files, including no-op installs. Failures, cancellation, lock collisions, and post-update inventory failures retain readiness. New markers arriving during installation remain for a future launch. Readiness is a positive hint, not proof of current installed state; native commands still perform their own checks. No marker also does not prove a successful no-update check.

## Native availability adapter

The adapter observes existing native calls without starting duplicate checks. Eligible native notices say: Restart Pi to install detected updates.

The exported `DefaultPackageManager.checkForAvailableUpdates` result retains user/project scope. Its receiver must match the current agent directory and context working directory; project observations additionally require trust. `InteractiveMode.showNewVersionNotification` observes positive Pi releases only and must belong to the current session manager. Methods retain their original receivers, arguments, results, and native errors. Persistence errors with filesystem codes produce a sanitized warning rather than changing native results.

After a native Pi/package notice renders, only its newly added Text instruction line is replaced, preserving the title, version, package list, release notes, and changelog. This display-only match never determines readiness. Restart guidance requires saved readiness, an enabled observer, and a supported launcher validated at startup using local file reads. Package guidance additionally requires every reported scope to be recorded and current project trust. Disabled, unsupported, failed-persistence, or unfamiliar notice shapes keep native manual-command instructions. Historical notices are untouched.

Imports use Pi's virtual host exports so bundled CLI prototypes, not an independent development copy, are wrapped. Missing methods disable automatic updates with a warning. Observer ownership is released on shutdown and rebound on session start; in-flight results belonging to disposed or replaced contexts are ignored. The shared versioned method-wrapper protocol restores methods without clobbering active peers. Compatibility is exercised against the installed Pi 0.87.1 bundled host; this is a compatibility adapter, not an official update-event API.

## Settings toggle

The native `/settings` menu exposes Automatic updates, enabled by default. A persistent off preference suppresses both readiness consumption and new observations without interrupting an already-running installer.

An empty `proper-updater.disabled` marker in the agent directory stores the off state. Missing means enabled; unreadable state fails closed with a sanitized warning. Exclusive creation and unlink persist toggles without rewriting other configuration. Write failure preserves the previous live and displayed value. Explicit launch flags and offline mode always override this preference. Enabling does not trigger an installer in the current process; retained readiness waits for the next launch.

A guarded wrapper around the virtual host's `InteractiveMode.showSettingsSelector` appends one item to the mounted native list, scoped to the owning session manager. The established settings-list shape matches proper-base's adapter, while the shared method-wrapper protocol preserves other settings handlers and active peers. Reopening or disposing releases the prior list callback and item; shutdown restores the host method. The setting remains visible when automatic updates are disabled so it can be re-enabled.

## Update isolation

One exclusive lock in the agent directory prevents simultaneous automatic installers. Child process groups isolate and bound native updates without blocking Pi's event loop.

A lock collision skips the launch with an actionable warning. Locks store an owner PID and are not automatically stolen; after a crash the user verifies that owner is gone before removing the lock. This coordinates updater instances sharing an agent directory, not manual package commands or separate agent directories sharing a Pi installation.

Inventory runs in a separate Node process using root exports resolved from the running Pi installation. Pi's legacy npm lookup can spawn synchronous processes, so it must not run inside the TUI. Snapshots cover Pi/npm versions, git HEADs, missing installations, and npm hidden lockfiles for dependency changes. Same-version unrecorded file changes are not detected.

Update subprocesses have a three-minute deadline; inventory and version probes have shorter limits. Abort and timeout signal the entire installer process group, including SIGKILL escalation, before releasing the lock. Session shutdown awaits the active update promise so Pi cannot exit before installer cleanup finishes. Native update failures still trigger a post-update snapshot because earlier packages may already have changed. Inventory failure after installation requests a manual restart rather than claiming success.

## Restart contract

Automatic restart requires an untouched idle TUI, replay-safe arguments, and a verified current executable. Process replacement runs at the exit boundary, after terminal restoration and extension shutdown handlers.

Pi exposes shutdown and reload, but no restart API. This adapter relies on Pi 0.86's graceful quit reaching `process.exit(0)` and Node's POSIX `process.execve`. An external signal or nonzero exit suppresses replacement. The original Node executable, Node flags, CLI script, working directory, and environment survive; continuation is pinned to the selected persisted session rather than replaying a latest-session lookup.

Prompts, file arguments, interactive resume, startup fork, session IDs, unknown flags, pending work, and input received during updates defer restart. The current session remains usable with a warning that installed changes need a manual restart. A PID-scoped environment marker skips one replacement startup and is consumed before descendants can reuse it. Updates with partial failure carry that warning across replacement.

No extension-only guarantee covers offline operation, network failure, pins, concurrent skipped launches, or unsupported runtime installations. The README states these limits rather than claiming every invocation is latest.

<!-- lat-index
- [[tests]]: offline updater verification
-->
