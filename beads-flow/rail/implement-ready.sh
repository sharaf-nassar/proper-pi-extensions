#!/usr/bin/env bash
#
# Native implement-ready safety rail. It never launches agents or commits.

set -euo pipefail

die() {
  printf 'implement-ready: %s\n' "$*" >&2
  exit 2
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"
}

usage() {
  cat <<'EOF'
Usage:
  implement-ready.sh init --repo PATH --scope ID|all [--main-branch BRANCH]
  implement-ready.sh survey --run-dir DIR
  implement-ready.sh overlap --run-dir DIR --task ID
  implement-ready.sh retry-gate --run-dir DIR --task ID --attempt N \
      [--prior-attempts N] [--override-ceiling REASON]
  implement-ready.sh claim --run-dir DIR --task ID
  implement-ready.sh worktree --run-dir DIR --task ID
  implement-ready.sh absorb (--run-dir DIR | --repo PATH) [--verify]
  implement-ready.sh result --run-dir DIR --task ID --attempt N --json JSON
  implement-ready.sh verify-worker --run-dir DIR --task ID --attempt N
  implement-ready.sh prepare --run-dir DIR --task ID --attempt N
  implement-ready.sh verify-integration --run-dir DIR --task ID [--gates CMD]
  implement-ready.sh cleanup --run-dir DIR --task ID
  implement-ready.sh unlock --run-dir DIR --task ID [--abort]

The root Codex orchestrator owns all bd and primary-checkout mutations.
Workers only edit, test, and commit in worktrees created by `worktree`.
All successful commands emit one JSON object. Errors are nonzero and are never
converted into an empty frontier. `prepare` holds the integration lock across
the root-owned git commit; `verify-integration`, `cleanup`, then `unlock`.
`verify-integration --gates CMD` additionally runs CMD in the repo on the
integrated tree while the lock is held; on failure it exits 10 and retains
the lock so the breakage is attributed to the task that just landed.
`worktree` creates task worktrees hook-free (per-worktree core.hooksPath
pointing at an empty dir) so repo/beads hooks never fire inside them;
primary-checkout hooks are unaffected.
EOF
}

json_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

validate_task() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
    die "unsafe task id: $1"
  [[ "$1" != "." && "$1" != ".." ]] || die "unsafe task id: $1"
}

validate_attempt() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]] || die "attempt must be a positive integer"
}

resolve_repo() {
  local path="$1"
  [[ -d "$path" ]] || die "repo path not found: $path"
  path="$(cd "$path" && pwd -P)"
  git -C "$path" rev-parse --is-inside-work-tree >/dev/null
  printf '%s\n' "$path"
}

manifest_path() {
  printf '%s/manifest.json\n' "$1"
}

load_manifest() {
  local run_dir="$1" manifest
  [[ -d "$run_dir" ]] || die "run directory not found: $run_dir"
  run_dir="$(cd "$run_dir" && pwd -P)"
  manifest="$(manifest_path "$run_dir")"
  [[ -s "$manifest" ]] || die "run manifest not found: $manifest"
  jq -e '
    type == "object" and
    (.repo | type == "string" and length > 0) and
    (.scope | type == "string" and length > 0) and
    (.main_branch | type == "string" and length > 0) and
    (.run_id | type == "string" and length > 0) and
    (.actor | type == "string" and length > 0)
  ' "$manifest" >/dev/null
  printf '%s\n' "$run_dir"
}

manifest_value() {
  jq -er "$2" "$(manifest_path "$1")"
}

task_state_path() {
  printf '%s/tasks/%s.json\n' "$1" "$2"
}

load_task_state() {
  local path
  path="$(task_state_path "$1" "$2")"
  [[ -s "$path" ]] || die "task worktree state not found: $path"
  jq -e --arg task "$2" '
    type == "object" and .task_id == $task and
    (.worktree | type == "string" and length > 0) and
    (.branch | type == "string" and length > 0) and
    (.base_sha | type == "string" and length > 0)
  ' "$path" >/dev/null
  printf '%s\n' "$path"
}

integration_path() {
  printf '%s/integrations/%s.json\n' "$1" "$2"
}

failed_integration_path() {
  printf '%s/integrations/%s.attempt-%s.failed.json\n' "$1" "$2" "$3"
}

verified_integration_path() {
  printf '%s/integrations/%s.verified.json\n' "$1" "$2"
}

cleanup_path() {
  printf '%s/integrations/%s.cleaned.json\n' "$1" "$2"
}

write_new_json() {
  local path="$1" json="$2"
  [[ ! -e "$path" ]] || die "refusing to overwrite artifact: $path"
  ( set -o noclobber; printf '%s\n' "$json" >"$path" ) ||
    die "could not create artifact: $path"
}

common_git_dir() {
  local repo="$1" rel
  rel="$(git -C "$repo" rev-parse --git-common-dir)"
  if [[ "$rel" = /* ]]; then
    (cd "$rel" && pwd -P)
  else
    (cd "$repo/$rel" && pwd -P)
  fi
}

lock_path() {
  printf '%s/implement-ready.lock\n' "$(common_git_dir "$1")"
}

require_lock_owner() {
  local run_dir="$1" task="$2" repo lock token
  repo="$(manifest_value "$run_dir" '.repo')"
  lock="$(lock_path "$repo")"
  [[ -s "$lock" ]] || die "integration lock not held: $lock"
  token="$(manifest_value "$run_dir" '.lock_token')"
  jq -e --arg run "$run_dir" --arg task "$task" --arg token "$token" '
    .run_dir == $run and .task_id == $task and .token == $token
  ' "$lock" >/dev/null || die "integration lock belongs to another run/task"
  printf '%s\n' "$lock"
}

acquire_lock() {
  local run_dir="$1" task="$2" repo lock token candidate owner
  repo="$(manifest_value "$run_dir" '.repo')"
  lock="$(lock_path "$repo")"
  token="$(manifest_value "$run_dir" '.lock_token')"
  candidate="${lock}.${token}.$$"
  owner="$(jq -cn \
    --arg run "$run_dir" --arg task "$task" --arg token "$token" \
    --arg at "$(json_now)" \
    '{run_dir:$run,task_id:$task,token:$token,acquired_at:$at}')"
  write_new_json "$candidate" "$owner"
  if ! ln "$candidate" "$lock"; then
    rm "$candidate"
    printf 'implement-ready: integration lock busy: %s\n' "$lock" >&2
    [[ -s "$lock" ]] && jq . "$lock" >&2
    exit 4
  fi
  rm "$candidate"
  printf '%s\n' "$lock"
}

ensure_primary_state() {
  local repo="$1" main="$2" branch path primary
  path="$(git -C "$repo" rev-parse --show-toplevel)"
  [[ "$path" == "$repo" ]] || die "repo path is not the primary checkout root"
  primary="$(git -C "$repo" worktree list --porcelain | sed -n '1s/^worktree //p')"
  [[ "$primary" == "$repo" ]] ||
    die "repo path is a linked worktree, not the primary checkout: $repo"
  branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD)" ||
    die "primary checkout has detached HEAD"
  [[ "$branch" == "$main" ]] ||
    die "primary checkout is on $branch, expected $main"
  git -C "$repo" diff --cached --quiet ||
    die "primary checkout has staged changes"
  [[ -z "$(git -C "$repo" ls-files --unmerged)" ]] ||
    die "primary checkout has unmerged paths"
  [[ -z "$(git -C "$repo" ls-files --others --exclude-standard)" ]] ||
    die "primary checkout has untracked files"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    [[ "$path" == .beads/*.jsonl && "$path" != .beads/*/*.jsonl ]] ||
      die "primary checkout has unsupported unstaged change: $path"
  done < <(git -C "$repo" diff --name-only)
}

cmd_init() {
  local repo="" scope="" main="" current repo_base run_dir run_id actor token json
  local hooks_path hooks_hazard=""
  while (($#)); do
    case "$1" in
      --repo) repo="${2:-}"; shift 2 ;;
      --scope) scope="${2:-}"; shift 2 ;;
      --main-branch) main="${2:-}"; shift 2 ;;
      *) die "init: unknown argument: $1" ;;
    esac
  done
  [[ -n "$repo" && -n "$scope" ]] ||
    die "init requires --repo and --scope"
  repo="$(resolve_repo "$repo")"
  [[ "$scope" == "all" || "$scope" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
    die "unsafe scope: $scope"
  if [[ -z "$main" ]]; then
    if git -C "$repo" show-ref --verify --quiet refs/heads/main; then
      main="main"
    elif git -C "$repo" show-ref --verify --quiet refs/heads/master; then
      main="master"
    else
      die "cannot infer integration branch; pass --main-branch"
    fi
  fi
  git -C "$repo" check-ref-format --branch "$main" >/dev/null
  git -C "$repo" show-ref --verify --quiet "refs/heads/$main" ||
    die "integration branch not found: $main"
  current="$(git -C "$repo" symbolic-ref --quiet --short HEAD)" ||
    die "primary checkout has detached HEAD"
  [[ "$current" == "$main" ]] ||
    die "primary checkout is on $current, expected $main"
  [[ "$(git -C "$repo" worktree list --porcelain | sed -n '1s/^worktree //p')" == "$repo" ]] ||
    die "repo path is a linked worktree, not the primary checkout: $repo"
  # An absolute core.hooksPath makes repo hooks fire for git operations inside
  # linked worktrees too; beads hooks doing that once hard-deleted an open P1
  # bead from a live DB. Informational: `worktree` creates every task worktree
  # hook-free (per-worktree core.hooksPath override), so rail-created
  # worktrees are safe — the residual exposure is worktrees created OUTSIDE
  # the rail in this repo.
  hooks_path="$(git -C "$repo" config --get core.hooksPath || true)"
  if [[ -n "$hooks_path" && "$hooks_path" == /* ]]; then
    hooks_hazard="$hooks_path"
    printf 'implement-ready: note: absolute core.hooksPath (%s) fires in linked worktrees; rail task worktrees are created hook-free, but worktrees made outside the rail are exposed\n' "$hooks_path" >&2
  fi
  repo_base="$(basename "$repo" | tr -c 'A-Za-z0-9._-' '-')"
  # Run state is durable, not /tmp: worker results and integration evidence
  # must survive reboots so interrupted runs can recover safely.
  local state_root="${XDG_STATE_HOME:-$HOME/.local/state}/bd-orchestrate"
  mkdir -p "$state_root"
  run_dir="$(mktemp -d "${state_root}/${repo_base}.run-$(date -u +%Y%m%dT%H%M%S).XXXXXX")"
  run_id="$(basename "$run_dir" | sed 's/^[^.]*\.//')"
  actor="codex-implement-ready-${run_id}"
  token="${run_id}-$$-${RANDOM}${RANDOM}"
  mkdir "$run_dir/tasks" "$run_dir/attempts" "$run_dir/integrations"
  json="$(jq -cn \
    --arg repo "$repo" --arg scope "$scope" --arg main "$main" \
    --arg run "$run_id" --arg actor "$actor" --arg token "$token" \
    --arg at "$(json_now)" --arg hooks "$hooks_hazard" \
    '{repo:$repo,scope:$scope,main_branch:$main,run_id:$run,
      actor:$actor,lock_token:$token,created_at:$at,
      hooks_hazard:(if $hooks == "" then null else $hooks end)}')"
  write_new_json "$(manifest_path "$run_dir")" "$json"
  jq -cn --arg run_dir "$run_dir" --argjson manifest "$json" \
    '$manifest + {run_dir:$run_dir}'
}

cmd_survey() {
  local run_dir="" repo scope ready blocked ready_args blocked_args ready_json blocked_json
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      *) die "survey: unknown argument: $1" ;;
    esac
  done
  run_dir="$(load_manifest "$run_dir")"
  repo="$(manifest_value "$run_dir" '.repo')"
  scope="$(manifest_value "$run_dir" '.scope')"
  ready_args=(ready --json --limit 0 --exclude-type=epic --sort priority)
  blocked_args=(blocked --json)
  if [[ "$scope" != "all" ]]; then
    ready_args+=(--parent "$scope")
    blocked_args+=(--parent "$scope")
  fi
  ready_json="$(bd -C "$repo" --readonly "${ready_args[@]}")"
  blocked_json="$(bd -C "$repo" --readonly "${blocked_args[@]}")"
  jq -e '
    type == "array" and
    all(.[]; (.id | type == "string" and length > 0) and
      ((.priority // 0) | type == "number"))
  ' \
    <<<"$ready_json" >/dev/null
  jq -e 'type == "array" and all(.[]; (.id | type == "string" and length > 0))' \
    <<<"$blocked_json" >/dev/null
  # Prefer Beads' structured field, but accept the legacy description section
  # emitted by older /file and /spec prompts. Missing, blank, or heading-only
  # criteria remain non-dispatchable: otherwise the worker invents "done".
  jq -cn --arg scope "$scope" --argjson ready "$ready_json" \
    --argjson blocked "$blocked_json" '
    def priority: (.priority // 0);
    def description_acceptance:
      (.description // "") | split("\n")
      | reduce .[] as $line ({inside:false, body:[]};
          if ($line | test("^\\s*(#{1,6}\\s*)?Acceptance criteria\\s*:?[[:space:]]*$"; "i")) then
            .inside = true
          elif (.inside and ($line | test("^\\s*#{1,6}\\s+"))) then
            .inside = false
          elif .inside then
            .body += [$line]
          else . end)
      | .body | join("\n");
    def acceptance:
      (.acceptance_criteria // "") as $structured
      | if (($structured | gsub("\\s"; "") | length) > 0)
        then $structured else description_acceptance end;
    def acceptable: (acceptance | gsub("\\s"; "") | length) > 0;
    ($ready | map(select(priority <= 3))) as $p03 |
    {scope:$scope,
     ready:[$p03[] | select(acceptable)],
     unacceptable:[$p03[] | select(acceptable | not)
                   | {id, title, priority, issue_type}],
     p4_excluded:[$ready[] | select(priority == 4)],
     blocked:$blocked,
     counts:{
       ready:([$p03[] | select(acceptable)] | length),
       unacceptable:([$p03[] | select(acceptable | not)] | length),
       p4_excluded:([$ready[] | select(priority == 4)] | length),
       blocked:($blocked | length)
     }}'
}

# Files declared by a task, one per line. Reads the live bead so it works for
# any task id, not only ones already in a run's state.
task_files() {
  local repo="$1" task="$2"
  bd -C "$repo" --readonly show "$task" --json |
    jq -r '
      (if type=="array" then .[0] else . end).description // ""
      | split("\n")[]
      | select(test("^\\s*Files:\\s*"; "i"))
      | sub("^\\s*Files:\\s*";""; "i")
      | split(",")[]
      | gsub("^\\s+|\\s+$";"")
      | select(length > 0 and (ascii_downcase | startswith("unknown") | not))
    '
}

# Hub files intersect constantly and would serialize the whole board. They are
# reported but never block; everything else blocks.
is_hub_file() {
  case "$(basename "$1")" in
    main.rs|lib.rs|mod.rs|index.ts|index.js|index.tsx|types.ts|api.ts|\
    __init__.py|main.py|main.go|routes.ts|schema.ts|Cargo.toml|package.json)
      return 0 ;;
  esac
  return 1
}

# Tasks with worktree state but no completed cleanup are still in flight.
active_tasks() {
  local run_dir="$1" f task
  for f in "$run_dir"/tasks/*.json; do
    [[ -e "$f" ]] || continue
    task="$(basename "$f" .json)"
    [[ -e "$(cleanup_path "$run_dir" "$task")" ]] || printf '%s\n' "$task"
  done
}

cmd_overlap() {
  local run_dir="" task="" repo other hub=() blocking=() mine f
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      *) die "overlap: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"
  run_dir="$(load_manifest "$run_dir")"
  repo="$(manifest_value "$run_dir" '.repo')"
  mapfile -t mine < <(task_files "$repo" "$task")
  while IFS= read -r other; do
    [[ -n "$other" && "$other" != "$task" ]] || continue
    while IFS= read -r f; do
      [[ -n "$f" ]] || continue
      for m in "${mine[@]:-}"; do
        [[ "$m" == "$f" ]] || continue
        if is_hub_file "$f"; then
          hub+=("$other:$f")
        else
          blocking+=("$other:$f")
        fi
      done
    done < <(task_files "$repo" "$other")
  done < <(active_tasks "$run_dir")
  jq -cn --arg task "$task" \
    --argjson declared "$(printf '%s\n' "${mine[@]:-}" | jq -R . | jq -sc 'map(select(length>0))')" \
    --argjson hub "$(printf '%s\n' "${hub[@]:-}" | jq -R . | jq -sc 'map(select(length>0))')" \
    --argjson blocking "$(printf '%s\n' "${blocking[@]:-}" | jq -R . | jq -sc 'map(select(length>0))')" '
    {task_id:$task, declared:$declared, hub_contention:$hub, conflicts:$blocking,
     status:(if ($blocking|length) > 0 then "conflict"
             elif ($declared|length) == 0 then "undeclared"
             else "clear" end)}'
}

cmd_claim() {
  local run_dir="" task="" repo actor survey_json claim_json show_json status assignee rc
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      *) die "claim: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"
  run_dir="$(load_manifest "$run_dir")"
  repo="$(manifest_value "$run_dir" '.repo')"
  actor="$(manifest_value "$run_dir" '.actor')"
  survey_json="$(cmd_survey --run-dir "$run_dir")"
  jq -e --arg task "$task" '.ready | any(.id == $task)' \
    <<<"$survey_json" >/dev/null ||
    die "task is not in the current scoped P0-P3 non-epic ready frontier: $task"
  if claim_json="$(bd -C "$repo" --actor "$actor" update "$task" --claim --json)"; then
    show_json="$(bd -C "$repo" --actor "$actor" show "$task" --json)"
    status="$(jq -er '(if type=="array" then .[0] else . end).status' <<<"$show_json")"
    assignee="$(jq -er '(if type=="array" then .[0] else . end).assignee' <<<"$show_json")"
    [[ "$status" == "in_progress" && "$assignee" == "$actor" ]] ||
      die "claim verification failed for $task (status=$status assignee=$assignee)"
    jq -cn --arg task "$task" --arg actor "$actor" \
      --arg status "$status" '{status:"claimed",task_id:$task,actor:$actor,bead_status:$status}'
    return
  else
    rc=$?
  fi
  show_json="$(bd -C "$repo" --readonly show "$task" --json)"
  status="$(jq -er '(if type=="array" then .[0] else . end).status' <<<"$show_json")"
  assignee="$(jq -r '(if type=="array" then .[0] else . end).assignee // ""' <<<"$show_json")"
  if [[ "$status" == "in_progress" && -n "$assignee" && "$assignee" != "$actor" ]]; then
    jq -cn --arg task "$task" --arg actor "$assignee" \
      '{status:"contested",task_id:$task,owner:$actor}'
    exit 3
  fi
  die "atomic claim failed for $task (bd exit=$rc status=$status assignee=${assignee:-<none>})"
}

cmd_worktree() {
  local run_dir="" task="" repo main run_id branch path base json exclude
  local overlap_json files_json
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      *) die "worktree: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"
  run_dir="$(load_manifest "$run_dir")"
  [[ ! -e "$(task_state_path "$run_dir" "$task")" ]] ||
    die "task already has worktree state: $task"
  repo="$(manifest_value "$run_dir" '.repo')"
  # Overlap guard. Worktrees isolate mechanically, but two tasks editing the
  # same file still collide at the second squash. This is the point of no
  # return, so it is enforced here rather than left to the orchestrator.
  overlap_json="$(cmd_overlap --run-dir "$run_dir" --task "$task")"
  if [[ "$(jq -r '.status' <<<"$overlap_json")" == "conflict" ]]; then
    printf 'implement-ready: file overlap with in-flight task(s)\n' >&2
    jq . <<<"$overlap_json" >&2
  fi
  files_json="$(jq -c '.declared' <<<"$overlap_json")"
  main="$(manifest_value "$run_dir" '.main_branch')"
  run_id="$(manifest_value "$run_dir" '.run_id')"
  branch="wt/${run_id}/${task}"
  git -C "$repo" check-ref-format --branch "$branch" >/dev/null
  git -C "$repo" show-ref --verify --quiet "refs/heads/$branch" &&
    die "task branch already exists: $branch"
  path="$repo/.worktrees/implement-ready/$run_id/$task"
  [[ ! -e "$path" ]] || die "task worktree path already exists: $path"
  exclude="$(common_git_dir "$repo")/info/exclude"
  mkdir -p "$(dirname "$exclude")"
  if ! git -C "$repo" check-ignore -q --no-index .worktrees/implement-ready/.probe; then
    printf '\n.worktrees/implement-ready/\n' >>"$exclude"
  fi
  mkdir -p "$(dirname "$path")"
  base="$(git -C "$repo" rev-parse "$main^{commit}")"
  # Repo hooks (core.hooksPath or default) also fire inside linked worktrees;
  # beads hooks there can sync the live DB from the worktree's stale tracked
  # .beads snapshot (an open P1 bead was hard-deleted this way) and can dirty
  # the task branch with a bd export that prepare then refuses. Task worktrees
  # are therefore created hook-free: --no-checkout so no hook fires during the
  # add itself, then a per-worktree core.hooksPath pointing at an empty dir.
  # Primary-checkout hooks are untouched — the squash commit on main still
  # runs the real hooks.
  mkdir -p "$HOME/.beads/no-hooks"
  git -C "$repo" worktree add --no-checkout -b "$branch" "$path" "$base" >&2
  git -C "$repo" config extensions.worktreeConfig true
  git -C "$path" config --worktree core.hooksPath "$HOME/.beads/no-hooks"
  git -C "$path" reset --hard --quiet "$base"
  json="$(jq -cn --arg task "$task" --arg path "$path" --arg branch "$branch" \
    --arg base "$base" --arg at "$(json_now)" --argjson files "$files_json" \
    --argjson overlap "$overlap_json" \
    '{task_id:$task,worktree:$path,branch:$branch,base_sha:$base,created_at:$at,
      files:$files,hub_contention:($overlap.hub_contention),
      overlap_status:($overlap.status)}')"
  write_new_json "$(task_state_path "$run_dir" "$task")" "$json"
  printf '%s\n' "$json"
}

attempt_dir() {
  printf '%s/attempts/%s/%s\n' "$1" "$2" "$3"
}

cmd_result() {
  local run_dir="" task="" attempt="" payload="" dir path normalized
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      --attempt) attempt="${2:-}"; shift 2 ;;
      --json) payload="${2:-}"; shift 2 ;;
      *) die "result: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"; validate_attempt "$attempt"
  [[ -n "$payload" ]] || die "result requires --json"
  run_dir="$(load_manifest "$run_dir")"
  normalized="$(jq -ce --arg task "$task" --argjson attempt "$attempt" '
    if (
      type == "object" and
      (.status == "done" or .status == "failed") and
      .task_id == $task and
      (.commit_sha | type == "string") and
      ((.attempt? // $attempt) == $attempt) and
      (has("checks") and ((.checks | type) == "array" or (.checks | type) == "string")) and
      (if .status == "done"
       then (.summary | type == "string" and length > 0)
       else ((.failure | type == "string" and length > 0) and
             (.error_signature | type == "string" and length > 0))
       end)
    )
    then .
    else error("invalid worker result")
    end
  ' <<<"$payload")"
  dir="$(attempt_dir "$run_dir" "$task" "$attempt")"
  mkdir -p "$dir"
  path="$dir/result.json"
  write_new_json "$path" "$normalized"
  printf '%s\n' "$normalized"
}

cmd_verify_worker() {
  local run_dir="" task="" attempt="" state result path branch base sha canonical head current verified out
  local declared changed
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      --attempt) attempt="${2:-}"; shift 2 ;;
      *) die "verify-worker: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"; validate_attempt "$attempt"
  run_dir="$(load_manifest "$run_dir")"
  state="$(load_task_state "$run_dir" "$task")"
  result="$(attempt_dir "$run_dir" "$task" "$attempt")/result.json"
  [[ -s "$result" ]] || die "worker result missing: $result"
  jq -e --arg task "$task" \
    '.status == "done" and .task_id == $task and (.commit_sha | length > 0)' \
    "$result" >/dev/null || die "worker did not report exact successful task result"
  path="$(jq -er '.worktree' "$state")"
  branch="$(jq -er '.branch' "$state")"
  base="$(jq -er '.base_sha' "$state")"
  [[ -d "$path" ]] || die "worker worktree missing: $path"
  current="$(git -C "$path" symbolic-ref --quiet --short HEAD)" ||
    die "worker worktree has detached HEAD"
  [[ "$current" == "$branch" ]] || die "worker worktree is on $current, expected $branch"
  [[ -z "$(git -C "$path" status --porcelain)" ]] ||
    die "worker worktree is dirty: $path"
  sha="$(jq -er '.commit_sha' "$result")"
  canonical="$(git -C "$path" rev-parse --verify "$sha^{commit}")"
  [[ "$sha" == "$canonical" ]] || die "worker must return the full canonical commit SHA"
  head="$(git -C "$path" rev-parse "HEAD^{commit}")"
  [[ "$head" == "$sha" ]] || die "worker SHA is not worktree HEAD"
  [[ "$(git -C "$path" rev-parse "refs/heads/$branch^{commit}")" == "$sha" ]] ||
    die "worker SHA is not tied to task branch $branch"
  [[ "$sha" != "$base" ]] || die "worker branch has no task commit"
  git -C "$path" merge-base --is-ancestor "$base" "$sha" ||
    die "worker commit does not descend from recorded task base"
  # Files drift (report-only): the overlap guard screened this task against
  # its DECLARED list only. Paths the worker changed but never declared were
  # never screened against in-flight siblings — the orchestrator must re-check
  # them before integrating.
  declared="$(jq -c '.files // []' "$state")"
  changed="$(git -C "$path" diff --name-only "$base..$sha" | jq -Rnc '[inputs]')"
  verified="$run_dir/attempts/$task/$attempt/verified.json"
  out="$(jq -cn --arg task "$task" --argjson attempt "$attempt" \
    --arg sha "$sha" --arg branch "$branch" --arg path "$path" \
    --arg at "$(json_now)" \
    --argjson declared "$declared" --argjson changed "$changed" \
    '{status:"verified",task_id:$task,attempt:$attempt,commit_sha:$sha,
      branch:$branch,worktree:$path,verified_at:$at,
      changed_files:$changed,
      files_drift:(if ($declared | length) == 0 then null
        else {undeclared:($changed - $declared),
              untouched:($declared - $changed)} end)}')"
  write_new_json "$verified" "$out"
  printf '%s\n' "$out"
}

cmd_prepare() {
  local run_dir="" task="" attempt="" repo main state path branch verified expected_sha
  local lock pre_head branch_sha branch_tree staged_tree json ipath base rebase_mode
  local previous_attempt archive current_lock
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      --attempt) attempt="${2:-}"; shift 2 ;;
      *) die "prepare: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"; validate_attempt "$attempt"
  run_dir="$(load_manifest "$run_dir")"
  ipath="$(integration_path "$run_dir" "$task")"
  if [[ -e "$ipath" ]]; then
    [[ ! -e "$(verified_integration_path "$run_dir" "$task")" ]] ||
      die "integration already verified for task: $task"
    previous_attempt="$(jq -er '.attempt' "$ipath")"
    ((attempt > previous_attempt)) ||
      die "prepare attempt $attempt must follow prepared attempt $previous_attempt"
    archive="$(failed_integration_path "$run_dir" "$task" "$previous_attempt")"
    [[ ! -e "$archive" ]] || die "failed integration archive already exists: $archive"
    mv -- "$ipath" "$archive"
  fi
  repo="$(manifest_value "$run_dir" '.repo')"
  main="$(manifest_value "$run_dir" '.main_branch')"
  state="$(load_task_state "$run_dir" "$task")"
  path="$(jq -er '.worktree' "$state")"
  branch="$(jq -er '.branch' "$state")"
  base="$(jq -er '.base_sha' "$state")"
  verified="$(attempt_dir "$run_dir" "$task" "$attempt")/verified.json"
  [[ -s "$verified" ]] || die "worker verification missing: $verified"
  expected_sha="$(jq -er '.commit_sha' "$verified")"
  [[ "$(git -C "$path" rev-parse "HEAD^{commit}")" == "$expected_sha" ]] ||
    die "task branch moved after worker verification"
  ensure_primary_state "$repo" "$main"
  [[ -z "$(git -C "$repo" diff --name-only "$main...$branch" -- .beads)" ]] ||
    die "task branch modifies .beads; workers must not mutate Beads state"
  current_lock="$(lock_path "$repo")"
  if [[ -e "$current_lock" ]]; then
    lock="$(require_lock_owner "$run_dir" "$task")"
  else
    lock="$(acquire_lock "$run_dir" "$task")"
  fi
  pre_head="$(git -C "$repo" rev-parse "$main^{commit}")"
  # The integration branch may have ADVANCED or been REWRITTEN while the worker
  # ran (the primary checkout amends main routinely). A plain `rebase $pre_head`
  # is only correct when the recorded base is still reachable from main; after a
  # rewrite the base is orphaned, and a plain rebase replays that stale base
  # commit along with the task commit, resurrecting pre-amend content. The
  # staged/branch tree equality check below cannot catch this — both trees would
  # contain the resurrected content — so the mode must be decided here.
  if git -C "$repo" merge-base --is-ancestor "$base" "$pre_head"; then
    rebase_mode="advanced"
    if ! git -C "$path" rebase "$pre_head" >&2; then
      printf 'implement-ready: rebase failed; conflict evidence and lock retained\n' >&2
      exit 5
    fi
  else
    rebase_mode="rewritten"
    printf 'implement-ready: integration branch was rewritten; replaying only task commits (--onto)\n' >&2
    if ! git -C "$path" rebase --onto "$pre_head" "$base" >&2; then
      printf 'implement-ready: rebase --onto failed; conflict evidence and lock retained\n' >&2
      exit 5
    fi
  fi
  # Whichever mode ran, the rebased branch must now descend from the main tip we
  # locked against. If it does not, the replay took an unexpected shape and the
  # squash below would carry unrelated history.
  git -C "$path" merge-base --is-ancestor "$pre_head" "HEAD" ||
    die "rebased task branch does not descend from locked integration head; lock retained"
  branch_sha="$(git -C "$path" rev-parse "HEAD^{commit}")"
  branch_tree="$(git -C "$path" rev-parse "HEAD^{tree}")"
  [[ "$branch_sha" != "$pre_head" ]] || die "rebased task branch has no commits"
  git -C "$repo" merge --squash "$branch" >&2
  staged_tree="$(git -C "$repo" write-tree)"
  [[ "$staged_tree" == "$branch_tree" ]] ||
    die "staged squash tree does not equal task branch tree; lock retained"
  git -C "$repo" diff --cached --quiet &&
    die "squash produced no staged changes; lock retained"
  json="$(jq -cn --arg task "$task" --argjson attempt "$attempt" \
    --arg pre "$pre_head" --arg sha "$branch_sha" --arg tree "$branch_tree" \
    --arg staged "$staged_tree" --arg branch "$branch" --arg path "$path" \
    --arg lock "$lock" --arg at "$(json_now)" --arg base "$base" \
    --arg mode "$rebase_mode" \
    '{status:"prepared",task_id:$task,attempt:$attempt,pre_head:$pre,
      branch_sha:$sha,branch_tree:$tree,staged_tree:$staged,
      branch:$branch,worktree:$path,lock:$lock,prepared_at:$at,
      base_sha:$base,rebase_mode:$mode}')"
  write_new_json "$ipath" "$json"
  printf '%s\n' "$json"
}

cmd_verify_integration() {
  local run_dir="" task="" gates="" repo main lock ipath prepared pre tree head parent head_tree out vpath
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      --gates) gates="${2:-}"; shift 2 ;;
      *) die "verify-integration: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"
  run_dir="$(load_manifest "$run_dir")"
  repo="$(manifest_value "$run_dir" '.repo')"
  main="$(manifest_value "$run_dir" '.main_branch')"
  lock="$(require_lock_owner "$run_dir" "$task")"
  ipath="$(integration_path "$run_dir" "$task")"
  [[ -s "$ipath" ]] || die "prepared integration missing: $ipath"
  prepared="$(jq -ce --arg task "$task" '
    if (.task_id == $task and .status == "prepared")
    then .
    else error("invalid prepared integration")
    end
  ' "$ipath")"
  pre="$(jq -er '.pre_head' <<<"$prepared")"
  tree="$(jq -er '.staged_tree' <<<"$prepared")"
  ensure_primary_state "$repo" "$main"
  git -C "$repo" diff --cached --quiet ||
    die "primary checkout still has staged changes; root commit not complete"
  head="$(git -C "$repo" rev-parse "$main^{commit}")"
  [[ "$head" != "$pre" ]] || die "integration branch did not advance"
  parent="$(git -C "$repo" rev-parse "$head^1")"
  [[ "$parent" == "$pre" ]] ||
    die "integration commit parent $parent does not equal prepared pre-head $pre"
  head_tree="$(git -C "$repo" rev-parse "$head^{tree}")"
  [[ "$head_tree" == "$tree" ]] ||
    die "integration commit tree $head_tree does not equal prepared tree $tree"
  if [[ -n "$gates" ]]; then
    # Merge-queue rule: a clean rebase proves textual integration only. Run
    # the gates on the integrated tree while the lock is still held, so a
    # semantic conflict with a sibling task is attributed to the commit that
    # just landed instead of surfacing unowned at end of run.
    if ! (cd "$repo" && bash -c "$gates" >&2); then
      printf 'implement-ready: integration gates failed after %s landed on %s; lock retained\n' "$task" "$main" >&2
      exit 10
    fi
  fi
  vpath="$(verified_integration_path "$run_dir" "$task")"
  out="$(jq -cn --arg task "$task" --arg commit "$head" \
    --arg parent "$parent" --arg tree "$head_tree" --arg lock "$lock" \
    --arg at "$(json_now)" --arg gates "$gates" \
    '{status:"integrated",task_id:$task,commit_sha:$commit,parent:$parent,
      tree:$tree,lock:$lock,verified_at:$at,
      gates:(if $gates == "" then "skipped" else "passed" end)}')"
  write_new_json "$vpath" "$out"
  printf '%s\n' "$out"
}

cmd_cleanup() {
  local run_dir="" task="" repo actor state path branch vpath ipath expected current out
  local bead_json bead_status bead_assignee cpath
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      *) die "cleanup: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"
  run_dir="$(load_manifest "$run_dir")"
  repo="$(manifest_value "$run_dir" '.repo')"
  actor="$(manifest_value "$run_dir" '.actor')"
  require_lock_owner "$run_dir" "$task" >/dev/null
  state="$(load_task_state "$run_dir" "$task")"
  path="$(jq -er '.worktree' "$state")"
  branch="$(jq -er '.branch' "$state")"
  vpath="$(verified_integration_path "$run_dir" "$task")"
  ipath="$(integration_path "$run_dir" "$task")"
  [[ -s "$vpath" && -s "$ipath" ]] || die "cleanup requires verified integration"
  bead_json="$(bd -C "$repo" --actor "$actor" --readonly show "$task" --json)"
  bead_status="$(jq -er '(if type=="array" then .[0] else . end).status' <<<"$bead_json")"
  bead_assignee="$(jq -er '(if type=="array" then .[0] else . end).assignee' <<<"$bead_json")"
  [[ "$bead_status" == "closed" && "$bead_assignee" == "$actor" ]] ||
    die "cleanup requires task closed under run actor (status=$bead_status assignee=$bead_assignee)"
  expected="$(jq -er '.branch_sha' "$ipath")"
  current="$(git -C "$repo" rev-parse "refs/heads/$branch^{commit}")"
  [[ "$current" == "$expected" ]] || die "task branch moved; refusing cleanup"
  [[ -z "$(git -C "$path" status --porcelain)" ]] ||
    die "task worktree is dirty; refusing cleanup"
  [[ -z "$(git -C "$path" ls-files --unmerged)" ]] ||
    die "task worktree has unmerged paths; refusing cleanup"
  git -C "$repo" worktree remove "$path" >&2
  git -C "$repo" update-ref -d "refs/heads/$branch" "$expected"
  git -C "$repo" worktree prune >&2
  cpath="$(cleanup_path "$run_dir" "$task")"
  out="$(jq -cn --arg task "$task" --arg path "$path" --arg branch "$branch" \
    --arg at "$(json_now)" \
    '{status:"cleaned",task_id:$task,worktree:$path,branch:$branch,cleaned_at:$at}')"
  write_new_json "$cpath" "$out"
  printf '%s\n' "$out"
}

cmd_retry_gate() {
  local run_dir="" task="" attempt="" prev prev2 sig1 sig2 status1 allowed reason
  local prior=0 override="" total kind="none"
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      --attempt) attempt="${2:-}"; shift 2 ;;
      # Attempts this bead already burned in EARLIER runs. The ceiling is
      # meaningless without it: a fresh run resets a per-run counter, which is
      # how one task reached six attempts under a "3-attempt ceiling".
      --prior-attempts) prior="${2:-}"; shift 2 ;;
      # Soft-ceiling override. A capable orchestrator that can name a concrete
      # change should not be walled off by an arithmetic budget; the returned
      # JSON keeps the reason visible to the caller.
      --override-ceiling) override="${2:-}"; shift 2 ;;
      *) die "retry-gate: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"; validate_attempt "$attempt"
  [[ "$prior" =~ ^[0-9]+$ ]] || die "--prior-attempts must be a non-negative integer"
  run_dir="$(load_manifest "$run_dir")"
  total=$((prior + attempt))
  allowed=true; reason="ok"
  # HARD gates are evaluated FIRST and are never overridable. The soft ceiling
  # is only consulted if the evidence gates passed — otherwise
  # --override-ceiling would smuggle a retry past a proven non-convergence.
  if ((attempt == 1 && prior == 0)); then
    reason="first attempt"
  else
    prev="$(attempt_dir "$run_dir" "$task" "$((attempt - 1))")/result.json"
    if [[ ! -s "$prev" ]]; then
      allowed=false; reason="no recorded result for attempt $((attempt - 1))"
    else
      status1="$(jq -r '.status' "$prev")"
      sig1="$(jq -r '.error_signature // ""' "$prev")"
      if [[ "$status1" != "failed" ]]; then
        allowed=false; reason="attempt $((attempt - 1)) did not fail; nothing to retry"
      elif ((attempt >= 3)); then
        prev2="$(attempt_dir "$run_dir" "$task" "$((attempt - 2))")/result.json"
        sig2="$(jq -r '.error_signature // ""' "$prev2" 2>/dev/null || printf '')"
        # An unchanged signature means the change you made did not move the
        # failure. That is the give-up signal, and it fires regardless of how
        # confident the diagnosis felt. Different signatures repeating instead
        # indicate the task is too large to hold in one worker's head — split
        # it rather than escalating the model again.
        if [[ -n "$sig2" && "$sig1" == "$sig2" ]]; then
          # HARD. This is evidence, not budget: the change you made did not move
          # the failure. No override — an override here would only buy an
          # identical fourth failure.
          allowed=false; kind="signature-unchanged"
          reason="error_signature unchanged across attempts $((attempt - 2)) and $((attempt - 1))"
        elif [[ -n "$sig2" ]]; then
          reason="signatures differ; consider SPLITTING the task rather than retrying"
        fi
      else
        reason="second attempt; no prior signature to compare"
      fi
    fi
  fi
  # SOFT ceiling, only after the evidence gates passed. Not proof of anything —
  # a budget checkpoint that forces the decision to be stated in the result
  # rather than walling off an orchestrator that can name a concrete change.
  if [[ "$allowed" == "true" ]] && ((total > 3)); then
    if [[ -n "$override" ]]; then
      kind="ceiling-overridden"
      reason="cumulative attempt $total exceeds soft ceiling 3; overridden: $override"
    else
      allowed=false; kind="ceiling"
      reason="cumulative attempt $total (prior $prior + this run $attempt) exceeds soft ceiling 3; pass --override-ceiling \"<reason>\" if the next attempt is genuinely different, or split the task"
    fi
  fi
  jq -cn --arg task "$task" --argjson attempt "$attempt" \
    --argjson allowed "$allowed" --arg reason "$reason" --arg kind "$kind" \
    --argjson prior "$prior" --argjson total "$total" \
    --arg override "$override" \
    --arg sig_prev "${sig1:-}" --arg sig_prev2 "${sig2:-}" \
    '{task_id:$task,attempt:$attempt,prior_attempts:$prior,total_attempts:$total,
      allowed:$allowed,denial:$kind,reason:$reason,
      override_reason:(if $override == "" then null else $override end),
      prev_signature:$sig_prev,prev2_signature:$sig_prev2}'
  # Distinct exits so the caller can tell evidence from budget: 7 = hard
  # (non-convergence), 9 = soft ceiling (overridable with a stated reason).
  case "$kind" in
    signature-unchanged) exit 7 ;;
    ceiling) exit 9 ;;
  esac
  [[ "$allowed" == "true" ]] || exit 7
}

cmd_absorb() {
  local run_dir="" verify=0 repo="" main dirty staged files
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      # /file and /spec absorb the same audit log but never call `init`, so they
      # have no run manifest. Without --repo they would each keep a hand-copied
      # version of this protocol, which is how the three copies drifted apart.
      --repo) repo="${2:-}"; shift 2 ;;
      --verify) verify=1; shift ;;
      *) die "absorb: unknown argument: $1" ;;
    esac
  done
  [[ -n "$run_dir" || -n "$repo" ]] || die "absorb requires --run-dir or --repo"
  if [[ -n "$run_dir" ]]; then
    run_dir="$(load_manifest "$run_dir")"
    repo="$(manifest_value "$run_dir" '.repo')"
    main="$(manifest_value "$run_dir" '.main_branch')"
  else
    repo="$(resolve_repo "$repo")"
    main="$(git -C "$repo" symbolic-ref --quiet --short HEAD)" ||
      die "absorb: primary checkout has detached HEAD"
  fi
  dirty="$(git -C "$repo" status --porcelain -- .beads/)"
  if ((verify)); then
    [[ -z "$dirty" ]] || die "absorb --verify: .beads still dirty after commit"
    jq -cn '{status:"verified-clean"}'
    return
  fi
  if [[ -z "$dirty" ]]; then
    jq -cn '{status:"clean",staged:[]}'
    return
  fi
  # The absorb commit must carry ONLY .beads files. A pre-existing staged index
  # would ride along, so refuse rather than silently widening the commit; the
  # orchestrator parks it (git stash push --staged) and calls again.
  if ! git -C "$repo" diff --cached --quiet; then
    jq -cn --argjson staged "$(git -C "$repo" diff --cached --name-only | jq -R . | jq -sc .)" \
      '{status:"blocked",reason:"primary index is not empty; park staged changes first",staged:$staged}'
    exit 8
  fi
  [[ "$(git -C "$repo" symbolic-ref --quiet --short HEAD)" == "$main" ]] ||
    die "absorb: primary checkout is not on $main"
  files="$(git -C "$repo" diff --name-only -- '.beads/*.jsonl')"
  [[ -n "$files" ]] || die "absorb: .beads dirty but no tracked *.jsonl modified; inspect manually"
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    git -C "$repo" add -- "$f"
  done <<<"$files"
  staged="$(git -C "$repo" diff --cached --name-only)"
  while IFS= read -r f; do
    [[ -z "$f" || "$f" == .beads/* ]] ||
      die "absorb staged a non-.beads path ($f); aborting before commit"
  done <<<"$staged"
  jq -cn --argjson staged "$(printf '%s' "$staged" | jq -R . | jq -sc 'map(select(length>0))')" \
    '{status:"staged",staged:$staged,
      next:"root orchestrator commits: git commit -m \"chore(beads): record task audit log\""}'
}

cmd_unlock() {
  local run_dir="" task="" abort=0 lock out repo main vpath cpath abort_path
  local state path rebase_merge rebase_apply
  while (($#)); do
    case "$1" in
      --run-dir) run_dir="${2:-}"; shift 2 ;;
      --task) task="${2:-}"; shift 2 ;;
      --abort) abort=1; shift ;;
      *) die "unlock: unknown argument: $1" ;;
    esac
  done
  validate_task "$task"
  run_dir="$(load_manifest "$run_dir")"
  lock="$(require_lock_owner "$run_dir" "$task")"
  repo="$(manifest_value "$run_dir" '.repo')"
  main="$(manifest_value "$run_dir" '.main_branch')"
  if ((abort)); then
    state="$(task_state_path "$run_dir" "$task")"
    if [[ -s "$state" ]]; then
      path="$(jq -er '.worktree' "$state")"
      if [[ -d "$path" ]]; then
        rebase_merge="$(git -C "$path" rev-parse --git-path rebase-merge)"
        rebase_apply="$(git -C "$path" rev-parse --git-path rebase-apply)"
        if [[ -d "$rebase_merge" || -d "$rebase_apply" ]]; then
          git -C "$path" rebase --abort >&2
        fi
      fi
    fi
    ensure_primary_state "$repo" "$main"
    abort_path="$run_dir/integrations/$task.aborted.json"
    out="$(jq -cn --arg task "$task" --arg lock "$lock" --arg at "$(json_now)" \
      '{status:"aborted",task_id:$task,lock:$lock,aborted_at:$at,
        evidence_preserved:true}')"
    write_new_json "$abort_path" "$out"
    rm "$lock"
    printf '%s\n' "$out"
    return
  fi
  vpath="$(verified_integration_path "$run_dir" "$task")"
  cpath="$(cleanup_path "$run_dir" "$task")"
  [[ -s "$vpath" && -s "$cpath" ]] ||
    die "normal unlock requires verified integration and completed cleanup; use --abort for recovery"
  rm "$lock"
  out="$(jq -cn --arg task "$task" --arg lock "$lock" \
    '{status:"unlocked",task_id:$task,lock:$lock}')"
  printf '%s\n' "$out"
}

main() {
  local command="${1:-}"
  [[ -n "$command" ]] || { usage; exit 2; }
  shift
  if [[ "$command" == "-h" || "$command" == "--help" || "$command" == "help" ]]; then
    usage
    return
  fi
  need git
  need jq
  need bd
  case "$command" in
    init) cmd_init "$@" ;;
    survey) cmd_survey "$@" ;;
    overlap) cmd_overlap "$@" ;;
    retry-gate) cmd_retry_gate "$@" ;;
    absorb) cmd_absorb "$@" ;;
    claim) cmd_claim "$@" ;;
    worktree) cmd_worktree "$@" ;;
    result) cmd_result "$@" ;;
    verify-worker) cmd_verify_worker "$@" ;;
    prepare) cmd_prepare "$@" ;;
    verify-integration) cmd_verify_integration "$@" ;;
    cleanup) cmd_cleanup "$@" ;;
    unlock) cmd_unlock "$@" ;;
    *) die "unknown command: $command (run --help)" ;;
  esac
}

main "$@"
