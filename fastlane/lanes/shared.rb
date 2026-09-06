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

# The single gate between a lane and the outside world. With DRY_RUN=1 nothing
# is uploaded or promoted: the call is logged and canned data is returned, so a
# lane can be walked end to end on a laptop or in a CI dry run.
def store_action(name, **args)
  if ENV['DRY_RUN'] == '1'
    UI.important("[dry-run] #{name} #{JSON.generate(loggable_args(args))}")
    return []
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
def api_key
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
  path = ENV.fetch('RELEASE_NOTES_STORE_FILE')
  text = File.read(path).strip
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
