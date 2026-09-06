# Helpers shared by every lane. Two constraints keep this file honest:
#
#   1. It is loaded standalone by fastlane/test/lanes_test.rb, without fastlane
#      running. So it may only reference `UI` (stubbed in the tests) and plain
#      Ruby -- no `lane`, no `sh`, no fastlane action outside `store_action`.
#   2. Every call that talks to a store goes through `store_action`, which is
#      what makes DRY_RUN=1 a real, testable rehearsal of a release.

# Fails with a pointer to the runbook rather than a stack trace when a release
# is started without its credentials.
def require_env!(keys)
  missing = keys.reject { |k| ENV[k].to_s.strip != '' }
  UI.user_error!("Missing env: #{missing.join(', ')} (see docs/release-runbook.md)") unless missing.empty?
end

# The single gate between a lane and the outside world. With DRY_RUN=1 nothing
# is uploaded or promoted: the call is logged and canned data is returned, so a
# lane can be walked end to end on a laptop or in a CI dry run.
def store_action(name, **args)
  if ENV['DRY_RUN'] == '1'
    UI.important("[dry-run] #{name} #{JSON.generate(args)}")
    return []
  end

  args.empty? ? send(name) : send(name, **args)
end

# App Store Connect API key, assembled from the three secrets CI holds. The .p8
# is passed base64-encoded so it survives being a single-line secret.
def api_key
  app_store_connect_api_key(
    key_id: ENV.fetch('ASC_KEY_ID'),
    issuer_id: ENV.fetch('ASC_ISSUER_ID'),
    key_content: ENV.fetch('ASC_KEY_P8_BASE64'),
    is_key_content_base64: true,
    in_house: false
  )
end

# Store-ready release notes, truncated at a word boundary with a pointer to the
# full changelog. `limit` is the store's own cap (App Store 4000, Play 500).
def store_notes(limit)
  path = ENV.fetch('RELEASE_NOTES_STORE_FILE')
  text = File.read(path).strip
  return text if text.length <= limit

  cut = text[0, limit - 24]
  cut = cut[0, cut.rindex(/\s/) || cut.length]
  "#{cut.rstrip} [+more on GitHub]"
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
def review_information
  {
    first_name: ENV['APP_REVIEW_FIRST_NAME'].to_s,
    last_name: ENV['APP_REVIEW_LAST_NAME'].to_s,
    phone_number: ENV['APP_REVIEW_PHONE'].to_s,
    email_address: ENV['APP_REVIEW_EMAIL'].to_s,
    demo_user: ENV['APP_REVIEW_DEMO_USER'].to_s,
    demo_password: ENV['APP_REVIEW_DEMO_PASSWORD'].to_s,
    notes: ENV['APP_REVIEW_NOTES'].to_s
  }
end
