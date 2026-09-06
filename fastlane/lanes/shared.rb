# Helpers shared by every lane. Two constraints keep this file honest:
#
#   1. It is loaded standalone by fastlane/test/lanes_test.rb, without fastlane
#      running. So it may only reference `UI` (stubbed in the tests) and plain
#      Ruby -- no `lane`, no `sh`, no fastlane action outside `store_action`.
#   2. Every call that talks to a store goes through `store_action`, which is
#      what makes DRY_RUN=1 a real, testable rehearsal of a release.
require 'json'

# Argument names whose values are credentials. A DRY_RUN=1 rehearsal is exactly
# the run someone pastes into a PR or leaves in a public Actions log, and
# GitHub only masks values registered as secrets in that job -- so the dry-run
# log redacts these itself. The pattern catches names this list has not met yet.
REDACTED_ARG_KEYS = %i[
  api_key api_token app_specific_password auth_token demo_password json_key
  json_key_data key_content key_password keystore_password match_password
  password private_key store_password token
].freeze
REDACTED_ARG_PATTERN = /password|secret|token|private_key|key_content|json_key/

# Fails with a pointer to the runbook rather than a stack trace when a release
# is started without its credentials.
def require_env!(keys)
  missing = keys.reject { |k| ENV[k].to_s.strip != '' }
  UI.user_error!("Missing env: #{missing.join(', ')} (see docs/release-runbook.md)") unless missing.empty?
end

# What each store action returns under DRY_RUN=1. A dry run only rehearses the
# whole lane if the canned value has the shape the lane goes on to use: an
# idempotency check that destructures an array, or compares a build number,
# would otherwise blow up on the generic `[]` and hide everything after it.
#
# `[]` stays the default (an empty result reads as "nothing there yet", which is
# what makes a dry run walk the upload path rather than the skip path), so only
# actions whose result is actually consumed need an entry here.
DRY_RUN_RESULTS = {
  google_play_track_version_codes: [],
  latest_testflight_build_number: 0,
  upload_to_testflight: nil,
  upload_to_app_store: nil,
  download_dsyms: nil
}.freeze
DRY_RUN_DEFAULT_RESULT = [].freeze

# The single gate between a lane and the outside world. With DRY_RUN=1 nothing
# is uploaded or promoted: the call is logged and canned data is returned, so a
# lane can be walked end to end on a laptop or in a CI dry run.
def store_action(name, **args)
  if ENV['DRY_RUN'] == '1'
    UI.important("[dry-run] #{name} #{JSON.generate(loggable_args(args))}")
    return DRY_RUN_RESULTS.fetch(name.to_sym, DRY_RUN_DEFAULT_RESULT)
  end

  args.empty? ? send(name) : send(name, **args)
end

# Credential-shaped values replaced with `[redacted]`, nested hashes included
# (`api_key:` is itself a hash whose `key_content` is the App Store Connect .p8).
def redacted_arg?(key)
  REDACTED_ARG_KEYS.include?(key.to_sym) || REDACTED_ARG_PATTERN.match?(key.to_s)
end

def loggable_args(args)
  args.to_h do |key, value|
    next [key, '[redacted]'] if redacted_arg?(key)

    [key, value.is_a?(Hash) ? loggable_args(value) : value]
  end
end

# App Store Connect API key, assembled from the three secrets CI holds. The .p8
# is passed base64-encoded so it survives being a single-line secret.
#
# Under DRY_RUN=1 it is a placeholder: building the real key signs a JWT with
# the .p8, so a rehearsal would otherwise demand live Apple credentials to
# reach the first thing it is supposed to be able to rehearse without them.
def api_key
  if ENV['DRY_RUN'] == '1'
    UI.important('[dry-run] app_store_connect_api_key (no App Store Connect session)')
    return { key_id: ENV['ASC_KEY_ID'].to_s, issuer_id: ENV['ASC_ISSUER_ID'].to_s, dry_run: true }
  end

  app_store_connect_api_key(
    key_id: ENV.fetch('ASC_KEY_ID'),
    issuer_id: ENV.fetch('ASC_ISSUER_ID'),
    key_content: ENV.fetch('ASC_KEY_P8_BASE64'),
    is_key_content_base64: true,
    in_house: false
  )
end

STORE_NOTES_SUFFIX = ' [+more on GitHub]'

# Store-ready release notes, truncated at a word boundary with a pointer to the
# full changelog. `limit` is the store's own cap (App Store 4000, Play 500) and
# is counted in characters, which is how both stores count. The result is never
# nil and never longer than `limit`, whatever `limit` is.
def store_notes(limit)
  truncate_store_text(File.read(ENV.fetch('RELEASE_NOTES_STORE_FILE')).strip, limit)
end

# The one truncation rule. Both callers -- the single-locale file and the
# per-locale store-notes.json -- go through it, so a note that reaches a store
# is cut the same way whichever source it came from.
def truncate_store_text(text, limit)
  return '' if limit <= 0
  return text if text.length <= limit
  # No room for the pointer: hard-cut instead of returning only a suffix.
  return text[0, limit].rstrip if limit <= STORE_NOTES_SUFFIX.length

  window = text[0, limit - STORE_NOTES_SUFFIX.length]
  boundary = window.rindex(/\s/)
  # Only honour a word boundary that keeps most of the window; otherwise a note
  # whose only space is near the start would lose nearly all of its content.
  cut = boundary && boundary > window.length / 2 ? window[0, boundary] : window
  "#{cut.rstrip}#{STORE_NOTES_SUFFIX}"
end

# build-info.json is written by the build job. Reading it here is the seam that
# catches a lane being pointed at an artifact from a different release.
def build_info
  info = JSON.parse(File.read(ENV.fetch('BUILD_INFO_FILE', 'build-info.json')))
  UI.user_error!("build-info version #{info['version']} != APP_VERSION #{ENV['APP_VERSION']}") unless info['version'] == ENV['APP_VERSION']
  UI.user_error!("build-info buildNumber #{info['buildNumber']} != APP_BUILD_NUMBER #{ENV['APP_BUILD_NUMBER']}") unless info['buildNumber'].to_s == ENV['APP_BUILD_NUMBER']

  info
end

# App Review contact details live in the environment, not in the repo: the
# metadata files under fastlane/metadata/ hold blanks and lanes fill them here.
#
# Blank values are dropped, and an empty hash means "nothing configured": both
# stores treat a field they are *given* as an instruction to overwrite, so
# sending blanks would clear the contact, demo account and review notes someone
# entered in the web UI -- worse than not touching them. Callers omit the
# argument entirely when this comes back empty. deliver also derives
# `demoAccountRequired` from the hash unconditionally
# (deliver/lib/deliver/upload_metadata.rb), which is the other reason it is
# all-or-nothing rather than per-key.
def review_information
  {
    first_name: ENV['APP_REVIEW_FIRST_NAME'],
    last_name: ENV['APP_REVIEW_LAST_NAME'],
    phone_number: ENV['APP_REVIEW_PHONE'],
    email_address: ENV['APP_REVIEW_EMAIL'],
    demo_user: ENV['APP_REVIEW_DEMO_USER'],
    demo_password: ENV['APP_REVIEW_DEMO_PASSWORD'],
    notes: ENV['APP_REVIEW_NOTES']
  }.reject { |_, value| value.to_s.strip.empty? }
end

# The same contact details in pilot's key names. deliver and pilot spell every
# field differently and pilot rejects an unknown key outright, so the two
# shapes are built separately rather than renamed at the call site.
# Valid keys per pilot/lib/pilot/options.rb: contact_email, contact_first_name,
# contact_last_name, contact_phone, demo_account_required, demo_account_name,
# demo_account_password, notes.
#
# pilot is the stricter of the two: build_manager.rb keys off `info.key?`, not
# on the value being present, so a blank here really does erase what is in App
# Store Connect.
def beta_review_information
  demo_user = ENV['APP_REVIEW_DEMO_USER'].to_s.strip
  info = {
    contact_first_name: ENV['APP_REVIEW_FIRST_NAME'],
    contact_last_name: ENV['APP_REVIEW_LAST_NAME'],
    contact_phone: ENV['APP_REVIEW_PHONE'],
    contact_email: ENV['APP_REVIEW_EMAIL'],
    demo_account_name: ENV['APP_REVIEW_DEMO_USER'],
    demo_account_password: ENV['APP_REVIEW_DEMO_PASSWORD'],
    notes: ENV['APP_REVIEW_NOTES']
  }.reject { |_, value| value.to_s.strip.empty? }
  info[:demo_account_required] = true unless demo_user.empty?
  info
end

# ---------------------------------------------------------------------------
# Options, paths and env coercion
# ---------------------------------------------------------------------------

# fastlane passes `lane build skip_signing:true` through as the *string*
# "true", while a lane invoked from another lane passes a real boolean. Both
# have to mean the same thing or a CLI-only flag silently does nothing.
def truthy?(value)
  %w[true 1 yes].include?(value.to_s.strip.downcase)
end

# fastlane runs every lane with the working directory set to `fastlane/`, while
# the unit tests, the Makefile and every workflow speak in paths from the repo
# root. Anchoring on the directory that *contains* `fastlane/` is what stops a
# lane from quietly finding nothing -- `metadata_locales` returning an empty
# list from the wrong directory writes no release notes and raises nothing.
def repo_root
  return Dir.pwd if Dir.exist?(File.join(Dir.pwd, 'fastlane', 'lanes'))
  return File.expand_path('..', Dir.pwd) if File.basename(Dir.pwd) == 'fastlane' && Dir.exist?(File.join(Dir.pwd, 'lanes'))

  Dir.pwd
end

def root_path(*parts)
  File.expand_path(File.join(repo_root, *parts))
end

# Where build artifacts land. CI overrides it so the upload job finds the same
# paths the build job wrote, without either side hard-coding the other's layout.
def output_dir(platform)
  dir = ENV['RNW_OUTPUT_DIR'].to_s.strip
  return root_path('artifacts', platform.to_s) if dir.empty?

  File.absolute_path?(dir) ? dir : root_path(dir)
end

# The directory a lane *reads* a finished artifact from, which is not the one
# it would write to. A build job archives into $RNW_OUTPUT_DIR; a publish job
# never builds anything -- it downloads the build job's artifacts into
# $RNW_ASSETS_DIR and uploads from there. Reading $RNW_OUTPUT_DIR in a publish
# job pointed the upload lanes one directory above the binaries, which failed
# the very first store stage of every run.
#
# Precedence, highest first:
#   1. the lane's own `ipa:` / `aab:` / `apk:` option (handled at the call site)
#   2. $RNW_ASSETS_DIR   -- the download directory in a publish job
#   3. $RNW_OUTPUT_DIR   -- the build output directory (via output_dir)
#
# A set-but-missing $RNW_ASSETS_DIR falls through rather than failing here: it
# means nothing was downloaded, and `output_dir` is then the honest answer for
# a lane run on a laptop with a stale variable in its shell.
def artifact_dir(platform)
  assets = ENV['RNW_ASSETS_DIR'].to_s.strip
  return assets if !assets.empty? && Dir.exist?(assets)

  output_dir(platform)
end

# sha256 of a file, in the hex form every other tool in the release path prints.
def file_sha256(path)
  require 'digest'
  Digest::SHA256.file(path).hexdigest
end

# build-info.json is written before the artifacts exist, so its `artifacts`
# object starts empty and the "APK derived from the exact AAB" gate had nothing
# to compare against. The build lane is the only place that knows the checksums
# of the AAB Play will receive and of the universal APK extracted from that same
# bundle, so it merges them in here.
#
# The source file is copied rather than rewritten: it is an input to this build
# (the publish job reads the same one), and a lane that edited it in place would
# make a re-run of the build depend on how far the previous run got.
def write_build_info_artifacts!(dir, artifacts)
  source = ENV['BUILD_INFO_FILE'].to_s.strip
  source = root_path('build-info.json') if source.empty?
  unless File.exist?(source)
    UI.important("No build-info.json at #{source} — artifact checksums not recorded")
    return nil
  end

  info = JSON.parse(File.read(source))
  info['artifacts'] = (info['artifacts'] || {}).merge(artifacts.transform_keys(&:to_s))
  destination = File.join(dir, 'build-info.json')
  File.write(destination, "#{JSON.pretty_generate(info)}\n")
  destination
end

def prepare_output_dir!(dir)
  require 'fileutils'
  FileUtils.mkdir_p(dir)
  dir
end

# `expo prebuild` regenerates ios/, so the project is discovered rather than
# assumed: a missing one means prebuild has not run, which is worth saying
# plainly instead of failing inside gym.
def ios_xcodeproj
  project = Dir.glob(root_path('ios', '*.xcodeproj')).sort.first
  UI.user_error!('No ios/*.xcodeproj — run `pnpm expo prebuild` first (see docs/release-runbook.md)') if project.nil?

  project
end

def ios_xcworkspace
  workspace = Dir.glob(root_path('ios', '*.xcworkspace')).sort.first
  UI.user_error!('No ios/*.xcworkspace — run `pnpm expo prebuild` and `bundle exec pod install` first') if workspace.nil?

  workspace
end

# The generated project carries the version and build number that the prebuild
# was given. Checking them here, before the archive, is what stops a release
# from producing an artifact labelled with the previous run's numbers.
def assert_project_version!(version, build_number)
  expected_version = ENV.fetch('APP_VERSION')
  expected_build = ENV.fetch('APP_BUILD_NUMBER')
  UI.user_error!("Generated project version #{version} != APP_VERSION #{expected_version} (re-run prebuild)") unless version.to_s == expected_version
  UI.user_error!("Generated project build number #{build_number} != APP_BUILD_NUMBER #{expected_build} (re-run prebuild)") unless build_number.to_s == expected_build
end

# Task 5 owns the verify scripts. Until they exist a verify lane must say which
# file is missing rather than hand `bash` a path that is not there.
def verify_script!(name)
  path = root_path('scripts', 'release', name)
  UI.user_error!("Missing scripts/release/#{name} (release verification script)") unless File.exist?(path)

  path
end

# The metadata trees, anchored at the repo root for the same reason.
def ios_metadata_path
  root_path('fastlane', 'metadata', 'ios')
end

def android_metadata_path
  root_path('fastlane', 'metadata', 'android')
end

# Play credentials arrive either as JSON content (a single-line secret) or as a
# decoded file. supply takes both, under different argument names.
def play_json_key_args
  data = ENV['PLAY_SERVICE_ACCOUNT_JSON'].to_s.strip
  return { json_key_data: data } unless data.empty?

  path = ENV['PLAY_SERVICE_ACCOUNT_JSON_PATH'].to_s.strip
  return { json_key: path } unless path.empty?

  UI.user_error!('Missing env: PLAY_SERVICE_ACCOUNT_JSON or PLAY_SERVICE_ACCOUNT_JSON_PATH (see docs/release-runbook.md)')
end

# bundletool ships as a jar on some machines and a wrapper script on others;
# neither is installed by default on a CI runner. Returning the invocation as
# argv keeps the lane free of shell quoting.
def bundletool_command
  return ['bundletool'] if executable_on_path?('bundletool')

  jar = ENV['BUNDLETOOL_JAR'].to_s.strip
  return ['java', '-jar', jar] if !jar.empty? && File.exist?(jar)

  UI.user_error!('bundletool not found: `brew install bundletool`, or download bundletool-all.jar and set BUNDLETOOL_JAR (see docs/release-runbook.md)')
end

def executable_on_path?(name)
  ENV['PATH'].to_s.split(File::PATH_SEPARATOR).any? do |dir|
    next false if dir.empty?

    File.executable?(File.join(dir, name)) && !File.directory?(File.join(dir, name))
  end
end

# ---------------------------------------------------------------------------
# Release notes and metadata
# ---------------------------------------------------------------------------

# Locale directories under a metadata tree. `review_information` and the
# screenshot/changelog folders live next to the locales, so the name has to
# look like a locale rather than merely be a directory.
LOCALE_DIR_PATTERN = /\A[a-z]{2,3}(-[A-Za-z]{2,4})?\z/

def metadata_locales(metadata_path)
  return [] unless Dir.exist?(metadata_path)

  Dir.children(metadata_path)
     .select { |name| File.directory?(File.join(metadata_path, name)) && LOCALE_DIR_PATTERN.match?(name) }
     .sort
end

# store-notes.json (written by scripts/release/notes.mjs) holds per-locale text
# for each surface: { "<locale>": { "testflight": ..., "play": ..., "appstore": ... } }.
# Absent, the single-locale notes-store.txt is still a correct answer, so the
# lanes fall back rather than fail.
def store_notes_json
  path = ENV['STORE_NOTES_JSON'].to_s.strip
  return nil if path.empty? || !File.exist?(path)

  JSON.parse(File.read(path))
rescue JSON::ParserError => e
  UI.user_error!("#{path} is not valid JSON: #{e.message}")
end

def locale_store_notes(locale, kind, limit, notes_json = store_notes_json)
  text = notes_json&.dig(locale, kind.to_s).to_s.strip
  if text.empty?
    # The fallback needs the single-locale file. Say so with the runbook pointer
    # every other missing input here gets, rather than a bare KeyError.
    require_env!(%w[RELEASE_NOTES_STORE_FILE])
    return store_notes(limit)
  end
  truncate_store_text(text, limit)
end

# Writes the release notes every store reads out of its metadata tree. deliver
# takes `<locale>/release_notes.txt`; supply takes
# `<locale>/changelogs/<versionCode>.txt`. Returns the paths written so a lane
# can log exactly what a submission will carry.
def write_release_notes!(metadata_path, kind:, limit:, changelog_name: nil)
  notes_json = store_notes_json
  locales = metadata_locales(metadata_path)
  # An empty locale list writes nothing and returns [], which reads exactly like
  # a successful run: `release_production` would go on to submit for review with
  # no release notes at all. An empty tree, or a path that resolved somewhere
  # else, is a mistake, and this is the last moment anyone can be told.
  assert_metadata_locales!(metadata_path, locales)
  locales.map do |locale|
    text = locale_store_notes(locale, kind, limit, notes_json)
    path =
      if changelog_name
        File.join(metadata_path, locale, 'changelogs', changelog_name)
      else
        File.join(metadata_path, locale, 'release_notes.txt')
      end
    # A rehearsal must not leave modified files behind in a working tree: the
    # whole point of DRY_RUN=1 is that it can be run on a laptop.
    if ENV['DRY_RUN'] == '1'
      UI.important("[dry-run] would write #{path} (#{text.length} chars)")
    else
      require 'fileutils'
      FileUtils.mkdir_p(File.dirname(path))
      File.write(path, "#{text}\n")
    end
    path
  end
end

# The template ships prose that says "Replace this text ...". Shipping it to
# App Review or to Play is worse than failing the lane, and production
# submission is the last moment anyone can still be told.
METADATA_PLACEHOLDER = 'Replace this text'

# A metadata tree with no locale directories in it. Every caller of this and of
# `write_release_notes!` would otherwise pass silently on a tree that is empty
# or, more likely, on a path that resolved to the wrong place.
def assert_metadata_locales!(metadata_path, locales = metadata_locales(metadata_path))
  return unless locales.empty?

  UI.user_error!("No locale directories under #{metadata_path} — store metadata is missing or the path is wrong (see docs/release-runbook.md)")
end

def assert_metadata_ready!(metadata_path)
  assert_metadata_locales!(metadata_path)
  offenders = Dir.glob(File.join(metadata_path, '**', '*.txt')).sort.select do |file|
    File.read(file).include?(METADATA_PLACEHOLDER)
  end
  return if offenders.empty?

  UI.user_error!("Store metadata still contains template placeholder text: #{offenders.join(', ')} (see docs/release-runbook.md)")
end
