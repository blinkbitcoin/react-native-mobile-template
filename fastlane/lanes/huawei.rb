# Huawei AppGallery Connect: upload the signed Android App Bundle and submit it
# for release. Binary only: AppGallery's listing fields stay console-only, so
# there is no sync_metadata counterpart here. The lane lives under
# `platform :android` because shared-workflows' fastlane.sh runs
# `fastlane <platform> <lane>` and accepts only ios or android, which makes a
# top-level lane unreachable from a release run.
HUAWEI_ENV = %w[HUAWEI_CLIENT_ID HUAWEI_CLIENT_SECRET HUAWEI_APP_ID].freeze
HUAWEI_NOTES_LIMIT = 300 # AppGallery accepts a changelog of 10 to 300 characters
HUAWEI_NOTES_MINIMUM = 10
# The plugin's own default is 10 seconds, which lands while AppGallery is still
# compiling the bundle.
HUAWEI_SUBMIT_DELAY_SECONDS = 60

def huawei_credentials
  {
    client_id: ENV.fetch('HUAWEI_CLIENT_ID'),
    client_secret: ENV.fetch('HUAWEI_CLIENT_SECRET'),
    app_id: ENV.fetch('HUAWEI_APP_ID')
  }
end

def huawei_submit_delay_seconds
  configured = ENV['HUAWEI_SUBMIT_DELAY_SECONDS'].to_s.strip
  return HUAWEI_SUBMIT_DELAY_SECONDS if configured.empty?
  unless /\A\d+\z/.match?(configured)
    UI.user_error!("HUAWEI_SUBMIT_DELAY_SECONDS must be a whole number of seconds, got #{configured.inspect}")
  end

  configured.to_i
end

# The plugin's token helper returns nil on an authentication failure and the
# upload action then only prints a message, so a wrong or revoked secret would
# be a green job that uploaded nothing. Asking for the app record first makes
# that red before any binary moves. get_app_info answers nil when the token is
# nil, false when AppGallery refused the request, and an empty hash when the
# app record is not visible to this client.
def assert_huawei_credentials!(credentials)
  info = store_action(:huawei_appgallery_connect_get_app_info, **credentials)
  blank = !info || (info.respond_to?(:empty?) && info.empty?)
  return unless blank

  UI.user_error!(
    "AppGallery Connect returned no app record for HUAWEI_APP_ID #{ENV.fetch('HUAWEI_APP_ID')}: " \
    'the client id and client secret pair is wrong or revoked, or the app id ' \
    'belongs to another team (see docs/release-runbook.md)'
  )
end

# AppGallery takes the changelog as a file path, and the file it takes is a
# throwaway: nothing in fastlane/metadata describes an AppGallery release.
def with_huawei_changelog
  require_env!(%w[RELEASE_NOTES_STORE_FILE])
  text = store_notes(HUAWEI_NOTES_LIMIT)
  if text.length < HUAWEI_NOTES_MINIMUM
    UI.important(
      "Release notes are #{text.length} characters, below AppGallery's " \
      "#{HUAWEI_NOTES_MINIMUM}-character floor - uploading without a changelog"
    )
    return yield(nil)
  end
  if ENV['DRY_RUN'] == '1'
    UI.important("[dry-run] would write an AppGallery changelog (#{text.length} characters)")
    return yield('[dry-run]/changelog.txt')
  end

  require 'tmpdir'
  Dir.mktmpdir('huawei-changelog') do |dir|
    path = File.join(dir, 'changelog.txt')
    File.write(path, "#{text}\n")
    yield(path)
  end
end

platform :android do
  desc 'Upload the Android App Bundle to Huawei AppGallery Connect and submit it for release'
  lane :upload_huawei do |options|
    assert_huawei_uploads_enabled! # per-store gate on top of STORE_UPLOADS_ENABLED
    require_env!(HUAWEI_ENV)
    build_info # asserts the artifact belongs to this version/build number
    aab = options[:aab] || File.join(artifact_dir('android'), 'app-release.aab')
    unless File.exist?(aab) || ENV['DRY_RUN'] == '1'
      UI.user_error!("No Android App Bundle at #{aab} - the huawei-binary job stages it from the release tag")
    end

    credentials = huawei_credentials
    assert_huawei_credentials!(credentials)
    # No idempotency query: get_app_info answers app-level fields only, with no
    # package version in them. A re-run re-uploads, and AppGallery rejects a
    # duplicate version code.
    args = credentials.merge(
      apk_path: aab,
      is_aab: true,
      submit_for_review: true,
      delay_before_submit_for_review: huawei_submit_delay_seconds
    )
    with_huawei_changelog do |path|
      args[:changelog_path] = path if path
      store_action(:huawei_appgallery_connect, **args)
    end
  end
end
