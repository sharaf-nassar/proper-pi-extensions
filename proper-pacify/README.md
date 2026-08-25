# proper-pacify

Tired of hurting your LLM's feelings? Rather your model didn't match you drink
for drink?

It happens to everyone.

The build breaks at 1am, you type something you would
never say to a colleague with a pulse, and now you are asking for help from a
model you just called useless.

Or it goes the other way: it is Friday, the
wine is open, and your prompt has picked up four "please"s, an apology for the
inconvenience, and a compliment about how clever the thing is.
Both are worse prompts than the one you would have written at 10am on a
Tuesday, and the model treats each one as your sober, considered best.

## Why tone matters

Less than the internet claims, and not in the direction most people assume. A
cross-lingual study found that impolite prompts often lowered answer quality,
while piling on politeness bought nothing over plain neutral phrasing, and the
best level differed by language ([Yin et al.,
SICon 2024](https://aclanthology.org/2024.sicon-1.2/)). A later cross-model
evaluation found the effect is real but narrow: neutral and polite prompts
generally beat very rude ones, yet the differences were significant only in
some interpretive tasks and mostly washed out once results were aggregated
([Hu et al.](https://arxiv.org/abs/2512.12812)).

So rudeness is a small tax you pay for no reason, and flattery is not a
discount. The interesting failure is at the other end. Anthropic warns that
aggressive emphasis such as "CRITICAL: You MUST use this tool" makes recent
models overtrigger, and recommends dialing it back to ordinary phrasing
([prompting best
practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).
Hedging costs you from the opposite side: bury the request under "could we
maybe consider possibly" and the instruction arrives blurry. Every vendor
guide converges on the same target, which is clear, direct, and explicit.

That target is the one thing a tired or annoyed human is worst at hitting.

## What it does

This [Pi](https://pi.dev) extension rewrites the tone of your prompt to be
clear, direct, neutral-professional, and cooperative, and it changes nothing
else. Facts,
constraints, urgency, consequences, questions, action verbs, paths, code, and
numbers survive exactly as written, because a prompt that reads pleasantly and
asks for the wrong thing is worse than a rude one. One model call per prompt,
no second-guessing pass. Use it per prompt with `/pacify`, or turn it on for
every prompt and forget it is there. Both versions land in the transcript so
you can see what was sent on your behalf.

## Commands

| Command | Behavior |
| --- | --- |
| `/pacify <prompt>` | Pacifies the prompt, logs before and after text, then sends the result as the user prompt. |
| `/pacify-session` | Turns automatic mode on or off for the current session only, leaving the stored default alone. |
| `/pacify-config` | Configures model, effort, priority service tier, tone guidance, and automatic mode. |

## Tone-only contract

The model receives an immutable instruction to preserve every fact, request,
constraint, command, code block, path, URL, quotation, number, markup token,
and ordering. It must not answer, summarize, correct, infer, add, remove, or
reorganize content. If a tone-only rewrite is unsafe, it must return the
original text.

The configurable tone prompt adds style guidance. It cannot replace the
immutable content-preservation rules. Each prompt uses one rewrite model call;
there is no model-as-judge or self-verification pass.

## Automatic mode

Automatic mode is off by default and has three settings, chosen under `Auto` in
`/pacify-config`: `off`, `on`, or `scheduled`. They are mutually exclusive, so
`on` cannot be combined with a schedule.

A schedule is a daily 24-hour local-time window, stored as
`"auto": { "start": "09:00", "end": "17:00" }`. The window includes `start` and
excludes `end`. A window whose start is later than its end wraps midnight, so
`22:00` to `06:00` runs overnight. The window is evaluated per prompt, so it
opens and closes during a running session without a restart. An unusable window
falls back to off rather than on.

`/pacify-session` toggles automatic mode for the current session without
writing to disk: it enables pacification when the stored setting is currently
off, and suspends it when currently on. A session override outranks a schedule
until the session ends. The override is dropped by `/new`, `/resume`, `/fork`,
and `/clone`, and survives `/reload`. Use `/pacify-config` to change the stored
setting for every future session.

When enabled, automatic mode runs on every interactive, RPC, or
extension-injected user input. A one-shot guard skips only the message already produced by
`/pacify`, preventing recursion without exempting other extensions.
Slash-command tokens are kept exact while their arguments are pacified, so
skill and prompt-template expansion still works after the transform.

Pacification happens above Pi's extension handler chain, in the single input
dispatch funnel, so no other extension can see an unpacified prompt no matter
what order packages are installed in. Pi chains `input` handlers in load order
and offers no priority control, so the package wraps `emitInput` on the host's
own `ExtensionRunner`, reached through the coding-agent module Pi provides to
extensions. The wrapper installs once per process. If a future host stops
exposing that funnel, the extension keeps working through its ordinary `input`
handler and ordering falls back to load order.

A successful transform becomes Pi's stored user message. The extension also
adds a visible custom session entry containing the full before and after text.
That entry is durable but excluded from LLM context, as are the notifications
below; the model only ever receives the rewritten prompt.

Progress, cancellation, and failure messages are written to the session
transcript through Pi's notification API rather than to a footer status slot,
so they appear beside the entry they describe instead of competing for one
truncated line.

Esc cancels an in-flight automatic rewrite and discards the prompt. Model,
authentication, transport, and non-stop completion failures fail open: Pi sends
the original prompt and logs the failure beside identical before and after
text.

## Configuration

Settings live at `~/.pi/agent/pacify.json` and are read before every use.
Missing or invalid values use these defaults:

```json
{
  "model": "gpt-5.6-luna",
  "effort": "medium",
  "fast": false,
  "prompt": "Copy the input and change only the spans listed below. Leave every other word exactly as written, in its original order.\n\nEditable spans:\n1. Profanity, insults, sarcasm, and contempt, such as \"the hell\", \"stupid\", \"idiot\", or \"garbage\". Delete the hostile wording and keep the rest of the sentence, including its question or command form. When the hostile phrase also asserts something about the work, restate that assertion plainly instead of deleting it: \"the docs are useless\" becomes \"the docs do not cover it\".\n2. Exasperation markers and sarcastic interjections, such as \"Ugh\", \"Seriously?\", or \"Wow\". Delete.\n3. Flattery and praise aimed at the reader, such as \"you're amazing\". Delete.\n4. Pleading and emotional pressure aimed at the reader, such as \"I'm begging you\" or \"please please\". Delete.\n5. Deference frames wrapped around a request, such as \"I'd be grateful if you could\", \"if it isn't too much trouble\", or \"at your convenience\". Delete the frame up to the verb it wraps and keep every verb after it, including \"consider\" and \"suggest\", even when the sentence chains two verbs: \"Would you mind possibly suggesting whether X\" becomes \"Could you suggest whether X\", and \"I'd be grateful if you could consider possibly reviewing X\" becomes \"Consider reviewing X\".\n6. Drama that states only the speaker's feeling, such as \"this is a disaster\". Replace it with the plain fact, or delete it when it states no fact.\n\nEverything else is content. Keep claims about past behavior, consequences, conditions, urgency, modality, scope, emphasis, interrogative words, question marks, and imperative verbs. Add no politeness markers, greetings, apologies, gratitude, encouragement, or reassurance. If the input contains none of the listed spans, return it unchanged.",
  "auto": false
}
```

The model can be a `provider/model-id` selected from Pi's authenticated model
registry or an unqualified exact model ID. The effort menu shows only levels
supported by that model's `thinkingLevelMap`; `null` means no requested effort.
Old unsupported values clamp to the model's lowest supported level. Fast mode
requests the provider's priority service tier when supported.

`auto` is `false`, `true`, or a daily window such as
`{ "start": "22:00", "end": "06:00" }`. Anything else loads as `false`.

The default tone prompt lists the span categories the model may edit and
declares everything else content. That framing is deliberate: earlier versions
listed protected content instead, and the model resolved tone/content conflicts
by deleting or restructuring the clause. The default effort is `medium` because
this prompt measurably degrades at `low`.

## Install

Install order does not matter, because pacification runs above the extension
handler chain:

```bash
pi install npm:proper-pacify
```

For extension development, install a local checkout instead:

```bash
pi install /path/to/proper-pi-extensions/proper-pacify
```

The package has no runtime dependencies and no build step, so a local install
needs no `npm install`; that command only prepares the development checks
below. Remove any stale direct-file registration so Pi loads one copy.

## Development

Use Node 22.19 or newer. Pi 0.84.2 is the compatibility target.

```bash
npm install
npm test
npm run typecheck
npm run test:coverage
```
