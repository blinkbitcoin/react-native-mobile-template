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

def android_aab_path
  Dir.glob(root_path('android', 'app', 'build', 'outputs', 'bundle', 'release', '*.aab')).sort.first
end

def android_mapping_path
  path = root_path('android', 'app', 'build', 'outputs', 'mapping', 'release', 'mapping.txt')
  File.exist?(path) ? path : nil
end

platform :android do
  desc 'Build the release AAB and a universal APK from that same bundle'
  lane :build do
    require_env!(ANDROID_UPLOAD_KEYSTORE_ENV)
    out = prepare_output_dir!(output_dir('android'))

    gradle(
      project_dir: root_path('android'),
      task: 'bundle',
      build_type: 'Release',
      flags: "-PreactNativeArchitectures=#{ANDROID_ABIS}",
      properties: android_signing_properties,
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
    sh(
      *bundletool_command,
      'build-apks',
      "--bundle=#{File.join(out, 'app-release.aab')}",
      "--output=#{apks}",
      '--mode=universal',
      "--ks=#{android_keystore_path}",
      "--ks-pass=pass:#{ENV.fetch('ANDROID_UPLOAD_KEYSTORE_PASSWORD')}",
      "--ks-key-alias=#{ENV.fetch('ANDROID_UPLOAD_KEY_ALIAS')}",
      "--key-pass=pass:#{ENV.fetch('ANDROID_UPLOAD_KEY_PASSWORD')}",
      log: false
    )
    # build-apks writes a zip; the universal APK is the single entry inside it.
    sh('unzip', '-o', '-j', apks, 'universal.apk', '-d', out)
    FileUtils.mv(File.join(out, 'universal.apk'), File.join(out, 'app-universal.apk'))
    FileUtils.rm_f(apks)
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
    out = output_dir('android')

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

  desc 'Change the production staged-rollout fraction (percent:50, or 100 to complete)'
  lane :rollout do |options|
    fraction = rollout_fraction(options[:percent] || ENV['PLAY_ROLLOUT'])

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
        **play_json_key_args
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

# PLAY_ROLLOUT is a fraction supply understands; accept a percentage too,
# because that is what the production workflow's dispatch input collects.
def play_rollout
  rollout_fraction(ENV['PLAY_ROLLOUT'].to_s.strip.empty? ? '1.0' : ENV['PLAY_ROLLOUT'])
end

def rollout_fraction(value)
  begin
    number = Float(value.to_s.strip)
  rescue ArgumentError, TypeError
    UI.user_error!("Rollout must be a number (got #{value.inspect})")
  end
  # `50` and `0.5` both mean half, because the production workflow collects a
  # percentage while supply wants the fraction.
  number /= 100.0 if number > 1.0
  # supply rejects 0 (`must be greater than 0.0 and less than or equal to 1.0`);
  # halting a rollout is what `halt` is for.
  UI.user_error!("Rollout must be greater than 0 and at most 100 (got #{value})") unless number > 0.0 && number <= 1.0

  number
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
