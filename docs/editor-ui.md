# JSON editor behavior

The browser editor edits JSON only. Existing YAML files remain readable in Raw mode; edit them with the CLI. Opening a YAML file never converts or deletes it.

Visual, Raw and Diff share one draft. Invalid Raw JSON stays visible and disables Visual, Diff, Save and Apply until corrected. Save writes the configuration file. Apply saves the configuration and then updates the workspace. A successful Save does not mark the workspace Applied. Editing after a successful Apply makes that draft Not applied in this session. This status describes this editor session, not an independently discovered workspace state.

Diff compares the draft with the latest acknowledged saved configuration. Successful Save/Apply responses advance that baseline using the server's normalized JSON. New edits made during a request remain intact. Apply failures show which stages completed, whether the config was saved, and whether the failed stage may have made changes. Completed effects are not rolled back. Failure responses do not return the normalized config. If the config was saved, a read-only fetch confirms the persisted baseline without changing the draft. If that fetch fails, the editor labels the saved contents unconfirmed; Reload checks the file and asks before discarding edits.

Workspace Preview identifies whether it matches the current draft. Editing invalidates the old plan immediately. Older asynchronous responses cannot restore it. Save/Apply busy responses retain the draft and offer a retry.

## Choices and upstream compatibility

The CLI accepts custom git hosts and category names. These fields have draft-derived schema examples and free-form input suggestions for both defaults and each repository, not a closed enum. The published FormField does not render schema examples, so the companion choices panel supplies native datalists while preserving unrestricted text input. The only closed provider enum is `agentSkills.providers`: `agents` and `claude`, matching the CLI validation schema.

`@visual-json/core` and `@visual-json/svelte` remain on the existing v0.4.0 line. The published Svelte components import `@internal/ui`, which is not a separately published package. The existing Vite alias is therefore retained as a small adapter for the component imports actually used here; the upstream components are not copied or replaced. The adapter's `DIFF_COLORS` now matches the object properties read by the published `DiffView`, and `formatValue` handles the values displayed by that component. The app uses the official `JsonEditor` and `DiffView` exports and their published props.

UI tests exercise the actual published DiffView, real JsonEditor numeric/boolean editing, array add/remove, enum keyboard selection, free-form hosts and dynamic schema choices. App tests cover draft retention, async responses, invalid JSON, Save/Apply states, partial failures and busy responses. `bun run --cwd ui check` runs svelte-check in CI. The dependency/security and release migration work remains in a separate PR.
