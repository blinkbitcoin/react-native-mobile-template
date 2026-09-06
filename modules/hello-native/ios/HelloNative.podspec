Pod::Spec.new do |s|
  s.name           = 'HelloNative'
  s.version        = '1.0.0'
  s.summary        = 'Local Expo Module example for react-native-mobile-template'
  s.description    = 'A minimal local Expo Module showing how to expose native iOS code to the app.'
  s.author         = 'Template Authors'
  s.homepage       = 'https://github.com/blinkbitcoin/react-native-mobile-template'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: 'https://github.com/blinkbitcoin/react-native-mobile-template.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
