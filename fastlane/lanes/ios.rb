# iOS lanes (build, TestFlight, App Store submission).
#
# Skeleton only: the lanes land in a later task of this phase. Everything that
# uploads or promotes must go through `store_action` from shared.rb so DRY_RUN=1
# stays a full rehearsal.
#
# App Store metadata lives in fastlane/metadata/ios/ rather than deliver's
# default fastlane/metadata/, so that supply's fastlane/metadata/android/ is not
# mistaken for an App Store locale. Lanes pass `metadata_path: 'fastlane/metadata/ios'`.
platform :ios do
end
