---
name: store-metadata
description: Use when filling or checking the store listing this app ships in fastlane/metadata - description, keywords, URLs, categories, age rating, review contact, screenshots, icon and feature graphic - or when pushing that listing to App Store Connect and Google Play with the sync_metadata lane, or seeding it from the consoles with pull_metadata.
allowed-tools: Bash(.claude/skills/store-metadata/scripts/*.sh *) Bash(.claude/skills/store-metadata/tests/run.sh) Bash(bundle exec fastlane *)
---

# Store Metadata

## Overview

This skill covers the `meta-*` ids in the `store-setup` checklist: filling
in, validating, and pushing the public store listing.

**Core principle:** `fastlane/metadata/**` and `fastlane/screenshots/` are
the source of truth. Nothing reaches App Store Connect or Google Play
without `check-metadata.sh` passing first — `sync.sh` runs it itself and
refuses to call the lane if it fails.

### What sync owns, what CD owns per version, what stays console-only

See `docs/release-runbook.md` "Store listing metadata" for the full table.
In short:

| CD owns per version | sync owns | Console-only |
| --- | --- | --- |
| Release notes, the binary, the review submission, track and rollout | Name, subtitle, description, keywords, promotional text, URLs, copyright, age rating, review contact, iOS screenshots, Play icon/feature graphic/screenshots | Apple: categories (until the category files exist), App Privacy labels, pricing, agreements, TestFlight groups. Play: content rating, data safety, target audience, tracks and testers |

## Procedure

```bash
.claude/skills/store-metadata/scripts/scaffold.sh --locale en-US --platform both
# fill in the files by hand, or:
.claude/skills/store-metadata/scripts/scaffold.sh --from-console

.claude/skills/store-metadata/scripts/place-images.sh --platform ios screenshot1.png screenshot2.png
.claude/skills/store-metadata/scripts/place-images.sh --platform android icon.png featureGraphic.png phone1.png

.claude/skills/store-metadata/scripts/age-rating.sh --from-answers answers.txt

# App Review contact stays in the environment (APP_REVIEW_*), never in the
# repo - the review_information/*.txt files stay empty on disk.

.claude/skills/store-metadata/scripts/check-metadata.sh --platform both

.claude/skills/store-metadata/scripts/sync.sh both --dry-run
STORE_METADATA_SYNC_ENABLED=true .claude/skills/store-metadata/scripts/sync.sh both --yes
```

## Three Facts From The Runbook You Must Not Miss

1. **A blank field cannot be pushed from the tree.** The staged copy drops
   zero-byte `.txt` files before either lane runs — `supply`/`deliver` treat
   presence as an instruction to overwrite. `fastlane/metadata/android/en-US/video.txt`
   is the case people hit: a removed Play promo video can only be cleared in
   the console.
2. **`overwrite_screenshots` replaces every display type per locale.** A
   locale directory holding only iPhone shots erases that locale's existing
   iPad set on the next push. Stage complete sets before pushing.
3. **Live mode needs no version in preparation and edits a small subset.**
   `IOS_METADATA_EDIT_LIVE=true` (or `live:true`) edits description,
   promotional text, the support/marketing URLs and copyright on the live
   version; name, subtitle, keywords, the privacy URL and screenshots need a
   version in "Prepare for Submission" and never push in live mode.

## After Editing The Scripts

Run `bash .claude/skills/store-metadata/tests/run.sh` and `make check`
before committing. The category id list (`check-metadata.sh`) and the
age-rating key list (`age-rating.sh`) are asserted against the vendored
spaceship gem files by the test suite — if fastlane is upgraded and those
gem files change shape, the tests will fail and the embedded lists need
updating to match.

## Common Mistakes

- Writing App Review contact details into `fastlane/metadata/ios/review_information/*.txt`
  instead of the `APP_REVIEW_*` environment — those files must stay empty;
  `review_information` is filled from the environment by the lane itself.
- Adding `primary_category.txt` without the four sub-category files —
  `deliver` clears any of the four that is absent, so ship all four (they
  may be empty) or none.
- Leaving the template's `Replace this text` placeholder in any `.txt` file
  under `fastlane/metadata` — `check-metadata.sh` and the lane's own
  `assert_metadata_ready!` (using the same `METADATA_PLACEHOLDER` literal
  from `fastlane/lanes/shared.rb`) both refuse it.
- Running `sync.sh` for real without `--dry-run` first.

## Red Flags

**`check-metadata.sh` fails on one file and you are about to push anyway.**
Stop. `sync.sh` will refuse on its own, but don't route around it by
calling the `bundle exec fastlane <platform> sync_metadata` lane directly.
