# Release notes context

Input for whoever (or whatever) writes the store release notes for a build.
The generator reads this file; the lanes read the result through
`store_notes(limit)` in `fastlane/lanes/shared.rb`.

## Product

- **Name:** RN Mobile Template
- **Audience:** people using the app to get something done on their phone, not
  developers reading a changelog.

## Tone

Plain, friendly, no jargon, no commit references. Write what changed for the
person holding the phone, in the order they would care about it. Never mention
internal identifiers, PR numbers, ticket keys, library names, or refactors that
nobody outside the team can see. If a release only contains such work, say so
in one honest line ("Behind-the-scenes fixes to keep things fast.").

## Locales

- `en-US` (source, and the only locale that must be present)

Other locales fall back to `en-US` on both stores until translated notes exist.

## Limits

| Target | Field | Max length |
| --- | --- | --- |
| App Store | release notes ("What's New") | 4000 characters |
| App Store | promotional text | 170 characters |
| Google Play | changelog | 500 characters |
| Huawei AppGallery | changelog | 300 characters, 10 minimum |

`store_notes(limit)` truncates at a word boundary and appends
` [+more on GitHub]` (18 characters, reserved from the limit) when the notes are
longer than the target allows. A word boundary is only honoured when it keeps
more than half the available window, and the suffix is dropped entirely when the
limit is too small to hold it -- the result never exceeds the limit.
