# Enough of fastlane to load fastlane/lanes/shared.rb without fastlane running.
#
# shared.rb is deliberately written against `UI` and plain Ruby only, so the
# helpers that decide what gets uploaded can be unit-tested in milliseconds
# instead of being discovered during a release.
require 'json'

# Records every stubbed fastlane action call as [name, args].
$calls = []

module UI
  class UserError < StandardError; end

  # fastlane's UI.user_error! aborts the lane; here it just raises.
  def self.user_error!(message)
    raise UserError, message
  end

  def self.important(message)
    messages << message
  end

  def self.message(message)
    messages << message
  end

  def self.success(message)
    messages << message
  end

  def self.messages
    @messages ||= []
  end

  def self.reset!
    messages.clear
  end
end

# Clears the action recorder. Kept separate from UI.reset! so the stubbed UI
# does not own a global it has nothing to do with.
def reset_calls!
  $calls.clear
end

# The fastlane actions the lanes reach for. Each records its call and returns
# something shaped like the real return value.
{
  upload_to_testflight: nil,
  upload_to_play_store: nil,
  upload_to_app_store: nil,
  gym: '/tmp/App.ipa',
  gradle: '/tmp/app-release.aab',
  match: nil,
  setup_ci: nil,
  app_store_connect_api_key: { key_id: 'STUB' },
  google_play_track_version_codes: [1]
}.each do |action, result|
  Object.send(:define_method, action) do |**args|
    $calls << [action, args]
    result
  end
end
