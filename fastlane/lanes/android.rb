# Android lanes (bundle, internal track, staged production rollout).
#
# Everything that uploads or promotes goes through `store_action` from
# shared.rb, so DRY_RUN=1 walks a whole release without touching a store.
#
# Play metadata lives in fastlane/metadata/android/, which is supply's default.
# Play's "What's new" cap, counted in characters (see release-notes-context.md).
PLAY_NOTES_LIMIT = 500
# arm only: Play has not accepted x86 for phones in years, and dropping the
# other ABIs roughly halves the AAB and the build time.
ANDROID_ABIS = 'armeabi-v7a,arm64-v8a'.freeze
ANDROID_UPLOAD_KEYSTORE_ENV = %w[
  ANDROID_UPLOAD_KEYSTORE_PATH ANDROID_UPLOAD_KEYSTORE_PASSWORD
  ANDROID_UPLOAD_KEY_ALIAS ANDROID_UPLOAD_KEY_PASSWORD
].freeze

# gradle resolves `storeFile` relative to android/app, and fastlane runs lanes
# from fastlane/, so the keystore path is made absolute from the repo root
# before it goes anywhere near either.
def android_keystore_path
  path = ENV.fetch('ANDROID_UPLOAD_KEYSTORE_PATH')
  File.absolute_path?(path) ? path : root_path(path)
end

# The gradle properties the `with-android-release-signing` config plugin reads.
# Passing them as properties rather than writing gradle.properties keeps the
# keystore password out of the generated project and out of any build log.
def android_signing_properties
  {
    'ANDROID_UPLOAD_STORE_FILE' => android_keystore_path,
    'ANDROID_UPLOAD_STORE_PASSWORD' => ENV.fetch('ANDROID_UPLOAD_KEYSTORE_PASSWORD'),
    'ANDROID_UPLOAD_KEY_ALIAS' => ENV.fetch('ANDROID_UPLOAD_KEY_ALIAS'),
    'ANDROID_UPLOAD_KEY_PASSWORD' => ENV.fetch('ANDROID_UPLOAD_KEY_PASSWORD')
  }
end

# The bundletool `build-apks` arguments, minus the signing flags.
#
# Split out from the lane so the signed and unsigned forms can be unit-tested:
# the difference between them is four arguments, two of which are password file
# paths, and getting that branch wrong either leaks a credential into the
# process table or silently produces an APK signed with the wrong key.
def bundletool_build_apks_args(bundle, output)
  [
    *bundletool_command,
    'build-apks',
    "--bundle=#{bundle}",
    "--output=#{output}",
    '--mode=universal'
  ]
end

# The four signing arguments, given the two password files. Empty when the build
# is unsigned, which leaves bundletool to sign with its own debug key - matching
# the debug-signed bundle gradle produced.
def bundletool_signing_args(store_pass_file, key_pass_file)
  [
    "--ks=#{android_keystore_path}",
    "--ks-pass=file:#{store_pass_file}",
    "--ks-key-alias=#{ENV.fetch('ANDROID_UPLOAD_KEY_ALIAS')}",
    "--key-pass=file:#{key_pass_file}"
  ]
end

# Writes each secret to its own 0600 file for the duration of the block, so a
# password reaches bundletool without ever appearing in an argument list.
def with_password_files(*secrets)
  require 'tempfile'
  files = secrets.map do |secret|
    file = Tempfile.new('rnmt-pass')
    file.chmod(0o600)
    file.write(secret) # no trailing newline: bundletool reads the file verbatim
    file.close
    file
  end
  yield(*files.map(&:path))
ensure
  files&.each { |file| file.close! }
end

# The single universal.apk inside the .apks archive bundletool just wrote.
def extract_universal_apk!(apks_path, destination)
  require 'zip'
  require 'fileutils'
  Zip::File.open(apks_path) do |archive|
    entry = archive.find_entry('universal.apk')
    UI.user_error!("bundletool produced no universal.apk in #{apks_path}") if entry.nil?
    FileUtils.rm_f(destination)
    entry.extract(destination)
  end
  destination
end

def android_aab_path
  Dir.glob(root_path('android', 'app', 'build', 'outputs', 'bundle', 'release', '*.aab')).sort.first
end

def android_mapping_path
  path = root_path('android', 'app', 'build', 'outputs', 'mapping', 'release', 'mapping.txt')
  File.exist?(path) ? path : nil
end

platform :android do
  desc 'Build the release AAB and a universal APK from that same bundle'
  lane :build do |options|
    # Without a keystore this still builds: plugins/with-android-release-signing.ts
    # falls back to the debug keystore when the ANDROID_UPLOAD_* gradle
    # properties are absent, and warns that it did. So a repository with no Play
    # credentials still compiles, still produces an .aab, a universal .apk and a
    # mapping file, and still runs `verify` - it simply cannot upload any of it.
    # Mirrors `skip_signing` on the iOS lane so the two read the same way.
    skip_signing = truthy?(options[:skip_signing])
    require_env!(ANDROID_UPLOAD_KEYSTORE_ENV) unless skip_signing
    out = prepare_output_dir!(output_dir('android'))

    gradle(
      project_dir: root_path('android'),
      task: 'bundle',
      build_type: 'Release',
      flags: "-PreactNativeArchitectures=#{ANDROID_ABIS}",
      # No properties at all when skipping: the plugin's fallback only applies
      # when the properties are absent, so passing empty ones would defeat it.
      properties: skip_signing ? {} : android_signing_properties,
      # The signing properties are on the command line: printing it would put
      # the keystore password in the build log.
      print_command: false
    )

    aab = android_aab_path
    UI.user_error!('gradle bundleRelease produced no .aab under android/app/build/outputs/bundle/release') if aab.nil?

    require 'fileutils'
    FileUtils.cp(aab, File.join(out, 'app-release.aab'))
    mapping = android_mapping_path
    FileUtils.cp(mapping, File.join(out, 'mapping.txt')) if mapping

    # The universal APK comes out of the same bundle that Play will receive, so
    # what QA installs is the artifact being released, not a second build of it.
    apks = File.join(out, 'app-universal.apks')
    FileUtils.rm_f(apks)
    # `--ks-pass=pass:` would put the keystore password in the process table,
    # where `log: false` cannot reach it; bundletool's `file:` form reads it
    # from a 0600 file that exists only for the length of the call.
    build_apks = bundletool_build_apks_args(File.join(out, 'app-release.aab'), apks)
    if skip_signing
      # No signing arguments: bundletool signs with its own debug key, matching
      # the debug-signed bundle gradle just produced. Nothing built this way is
      # installable anywhere that checks a signature, which is the point.
      sh(*build_apks, log: false)
    else
      with_password_files(
        ENV.fetch('ANDROID_UPLOAD_KEYSTORE_PASSWORD'),
        ENV.fetch('ANDROID_UPLOAD_KEY_PASSWORD')
      ) do |store_pass_file, key_pass_file|
        sh(*build_apks, *bundletool_signing_args(store_pass_file, key_pass_file), log: false)
      end
    end
    # build-apks writes a zip; the universal APK is the single entry inside it.
    # rubyzip comes with fastlane, so this needs no `unzip` on the runner.
    apk = extract_universal_apk!(apks, File.join(out, 'app-universal.apk'))
    FileUtils.rm_f(apks)

    # The provenance record of what this build actually produced. verify-android's
    # `apk-sha` check compares the APK it is handed against `artifacts.apkSha256`,
    # which is what catches a universal APK built from a different bundle than the
    # one being uploaded.
    written = write_build_info_artifacts!(
      out,
      aabSha256: file_sha256(File.join(out, 'app-release.aab')),
      apkSha256: file_sha256(apk)
    )
    UI.message("Artifact checksums recorded in #{written}") if written
  end

  desc 'Run the Android artifact verification gate'
  lane :verify do |options|
    script = verify_script!('verify-android.sh')
    out = output_dir('android')
    aab = options[:aab] || File.join(out, 'app-release.aab')
    apk = options[:apk] || File.join(out, 'app-universal.apk')
    [aab, apk].each do |path|
      UI.user_error!("Nothing to verify at #{path} — run `fastlane android build` first") unless File.exist?(path)
    end

    sh('bash', script, aab, apk)
  end

  desc 'Upload the AAB to the internal track (idempotent)'
  lane :upload_internal do |options|
    build_info # asserts the artifact belongs to this version/build number
    package = ENV.fetch('ANDROID_PACKAGE')
    version_code = ENV.fetch('APP_BUILD_NUMBER')
    # artifact_dir, not output_dir: this job downloaded the build job's
    # artifacts into $WORKFLOWS_ASSETS_DIR and has nothing of its own to upload.
    out = artifact_dir('android')

    # Play rejects a duplicate version code outright, which turns any retry of
    # the release job into a red build. Ask first.
    existing = store_action(
      :google_play_track_version_codes,
      package_name: package,
      track: 'internal',
      **play_json_key_args
    )
    if Array(existing).map(&:to_s).include?(version_code.to_s)
      UI.important("Play internal track already has version code #{version_code} — skipping upload")
      next
    end

    # supply reads the changelog for a version code from the metadata tree, so
    # the notes have to be on disk before the upload rather than passed to it.
    written = write_release_notes!(
      android_metadata_path,
      kind: :play,
      limit: PLAY_NOTES_LIMIT,
      changelog_name: "#{version_code}.txt"
    )
    UI.message("Changelogs written: #{written.join(', ')}")

    args = {
      package_name: package,
      track: 'internal',
      release_status: 'completed',
      aab: options[:aab] || File.join(out, 'app-release.aab'),
      metadata_path: android_metadata_path,
      # Store listing and images are synced once, from release_production;
      # an internal upload must not be able to change what the public sees.
      skip_upload_metadata: true,
      skip_upload_images: true,
      skip_upload_screenshots: true,
      skip_upload_changelogs: false,
      version_code: version_code.to_i,
      version_name: ENV.fetch('APP_VERSION'),
      **play_json_key_args
    }
    mapping = File.join(out, 'mapping.txt')
    args[:mapping] = mapping if File.exist?(mapping)

    store_action(:upload_to_play_store, **args)
  end

  desc 'Promote the internal build to the open beta track'
  lane :promote_beta do
    store_action(
      :upload_to_play_store,
      package_name: ENV.fetch('ANDROID_PACKAGE'),
      track: 'internal',
      track_promote_to: 'beta',
      track_promote_release_status: 'completed',
      version_code: ENV.fetch('APP_BUILD_NUMBER').to_i,
      # Nothing is uploaded: this promotes the version code that is already there.
      skip_upload_aab: true,
      skip_upload_apk: true,
      skip_upload_metadata: true,
      skip_upload_changelogs: true,
      skip_upload_images: true,
      skip_upload_screenshots: true,
      **play_json_key_args
    )
  end

  desc 'Promote the beta build to production at PLAY_ROLLOUT, syncing the full store listing'
  lane :release_production do
    assert_metadata_ready!(android_metadata_path)
    version_code = ENV.fetch('APP_BUILD_NUMBER')
    written = write_release_notes!(
      android_metadata_path,
      kind: :play,
      limit: PLAY_NOTES_LIMIT,
      changelog_name: "#{version_code}.txt"
    )
    UI.message("Changelogs written: #{written.join(', ')}")

    args = {
      package_name: ENV.fetch('ANDROID_PACKAGE'),
      track: 'beta',
      track_promote_to: 'production',
      rollout: play_rollout,
      version_code: version_code.to_i,
      skip_upload_aab: true,
      skip_upload_apk: true,
      # The one lane that syncs the public listing, so a change to the store
      # page can only ever ship as part of a production release.
      metadata_path: android_metadata_path,
      skip_upload_metadata: false,
      skip_upload_changelogs: false,
      skip_upload_images: false,
      skip_upload_screenshots: false,
      **play_json_key_args
    }
    priority = ENV['PLAY_UPDATE_PRIORITY'].to_s.strip
    args[:in_app_update_priority] = priority.to_i unless priority.empty?

    store_action(:upload_to_play_store, **args)
  end

  desc 'Change the production staged-rollout share. Whole number = percent (percent:1 is 1%, percent:100 completes); a decimal is a fraction (percent:0.01 is 1%, percent:1.0 completes)'
  lane :rollout do |options|
    fraction = rollout_fraction(options[:percent] || ENV['PLAY_ROLLOUT'])
    UI.important("Setting the production rollout to #{(fraction.to_f * 100).round(4)}% of users")

    store_action(
      :upload_to_play_store,
      package_name: ENV.fetch('ANDROID_PACKAGE'),
      track: 'production',
      rollout: fraction,
      version_code: ENV.fetch('APP_BUILD_NUMBER').to_i,
      # With nothing to upload and a track + rollout set, supply takes the
      # update_rollout path; 1.0 completes the rollout.
      skip_upload_aab: true,
      skip_upload_apk: true,
      skip_upload_metadata: true,
      skip_upload_changelogs: true,
      skip_upload_images: true,
      skip_upload_screenshots: true,
      **play_json_key_args
    )
  end

  desc 'Halt the production rollout'
  lane :halt do
    package = ENV.fetch('ANDROID_PACKAGE')
    version_code = ENV.fetch('APP_BUILD_NUMBER').to_i
    # Outside the begin: a missing credential is not a supply regression, and
    # reporting it as one would send the operator to the wrong fix.
    credentials = play_json_key_args

    begin
      store_action(
        :upload_to_play_store,
        package_name: package,
        track: 'production',
        release_status: 'halted',
        version_code: version_code,
        skip_upload_aab: true,
        skip_upload_apk: true,
        skip_upload_metadata: true,
        skip_upload_changelogs: true,
        skip_upload_images: true,
        skip_upload_screenshots: true,
        **credentials
      )
    rescue StandardError => e
      # `release_status: halted` through supply has regressed more than once
      # (fastlane #21253, #21431). Halting a bad rollout is the one operation
      # that cannot wait for an upstream fix, so go at the API directly.
      UI.important("supply could not halt the rollout (#{e.message}); falling back to the AndroidPublisher API")
      halt_via_android_publisher!(package, version_code)
    end
  end
end

# PLAY_ROLLOUT is a fraction supply understands; the production workflow's
# dispatch input collects a percentage. Default: the whole user base.
def play_rollout
  raw = ENV['PLAY_ROLLOUT'].to_s.strip
  rollout_fraction(raw.empty? ? '1.0' : raw)
end

# The *form* of the input decides what it means, not its magnitude. `1` is both
# the first step of a canary (1%) and the fraction for everybody, and resolving
# that collision by size would silently ship a 1% canary to 100% of users. So:
#
#   whole number  -> percent    "1" -> 0.01, "50" -> 0.5, "100" -> 1
#   has a decimal -> fraction   "0.01" -> 0.01, "0.5" -> 0.5, "1.0" -> 1
#
# Anything outside 0 < x <= 1 after that conversion is a mistake, not a reading
# to guess at, so `1.5` and `150` both fail rather than being clamped.
#
# The result is a String because supply's `rollout` ConfigItem is `data_type:
# String` and FastlaneCore rejects a Float before the action ever runs.
def rollout_fraction(value)
  raw = value.to_s.strip
  begin
    number = Float(raw)
  rescue ArgumentError, TypeError
    UI.user_error!("Rollout must be a number (got #{value.inspect})")
  end
  number /= 100.0 unless raw.include?('.')
  # supply rejects 0 (`must be greater than 0.0 and less than or equal to 1.0`);
  # stopping a rollout is what `halt` is for.
  unless number > 0.0 && number <= 1.0
    UI.user_error!("Rollout #{value.inspect} is out of range: use a whole number of percent (1..100) or a fraction (0.01..1.0)")
  end

  format('%g', number)
end

# The direct AndroidPublisher edit supply's `release_status: halted` is supposed
# to perform: open an edit, set every release in the production track that
# carries this version code to `halted`, commit.
def halt_via_android_publisher!(package, version_code)
  # supply is already loaded inside a real fastlane run (upload_to_play_store
  # pulls it in); the guard is what lets the unit tests substitute it.
  require 'supply' unless defined?(Supply)

  Supply.config = FastlaneCore::Configuration.create(
    Supply::Options.available_options,
    { package_name: package, track: 'production' }.merge(play_json_key_args)
  )
  client = Supply::Client.make_from_config
  client.begin_edit(package_name: package)
  track = client.tracks(Supply::Tracks::PRODUCTION).first
  UI.user_error!('No production track to halt') if track.nil?

  halted = track.releases.select { |release| Array(release.version_codes).map(&:to_s).include?(version_code.to_s) }
  UI.user_error!("No production release for version code #{version_code}") if halted.empty?
  halted.each { |release| release.status = Supply::ReleaseStatus::HALTED }

  client.update_track(Supply::Tracks::PRODUCTION, track)
  client.commit_current_edit!
  UI.success("Halted the production rollout of version code #{version_code}")
end
