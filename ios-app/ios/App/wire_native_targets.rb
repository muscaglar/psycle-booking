#!/usr/bin/env ruby
# One-shot project surgery: wires the native-feature scaffolds into real
# targets (see NATIVE_FEATURES.md) and removes stale Pods-App xcconfig refs.
#
# Needs the xcodeproj gem (not shipped with macOS ruby). One-time setup +
# run, e.g. with Homebrew ruby:
#
#   GEM_HOME=~/.gem-xcodeproj /opt/homebrew/opt/ruby/bin/gem install xcodeproj --no-document
#   GEM_HOME=~/.gem-xcodeproj /opt/homebrew/opt/ruby/bin/ruby wire_native_targets.rb
#
# Idempotent: safe to re-run (skips anything that already exists).

require 'xcodeproj'

PROJ = File.join(__dir__, 'PsycleBookingBuddy.xcodeproj')
project = Xcodeproj::Project.open(PROJ)

# The single application target (named PsycleBookingBuddy; the scheme is "App").
app_target = project.targets.find { |t| t.product_type == 'com.apple.product-type.application' }
abort('application target not found') unless app_target
puts "app target: #{app_target.name}"

# ── 1. Remove stale Pods-App.*.xcconfig references (target-rename debris) ──
project.files.select { |f| f.path.to_s.include?('Pods-App.') }.each do |f|
  puts "removing stale ref: #{f.path}"
  f.remove_from_project
end

# Also drop SDK-version-pinned framework refs (xcodeproj's new_target adds a
# Foundation.framework ref with a hardcoded iPhoneOSxx.sdk path that dangles
# after every SDK bump; extensions auto-link Foundation anyway).
project.files.select { |f| f.path.to_s =~ %r{Platforms/iPhoneOS.*\.sdk/System/Library/Frameworks/Foundation\.framework} }.each do |f|
  puts "removing SDK-pinned framework ref: #{f.path}"
  f.build_files.each { |bf| bf.remove_from_project }
  f.remove_from_project
end

# ── 2. Groups + file references ─────────────────────────────────────────────
def ensure_group(project, name)
  project.main_group[name] || project.main_group.new_group(name, name)
end

def ensure_file(group, path)
  group.files.find { |f| f.path == File.basename(path) } ||
    group.new_reference(File.basename(path))
end

shared_g  = ensure_group(project, 'PsycleShared')
widget_g  = ensure_group(project, 'PsycleWidget')
live_g    = ensure_group(project, 'PsycleLiveActivity')
intents_g = ensure_group(project, 'PsycleIntents')
ext_g     = ensure_group(project, 'PsycleWidgetExtension')

snapshot_ref   = ensure_file(shared_g,  'PsycleSnapshot.swift')
widget_ref     = ensure_file(widget_g,  'PsycleWidget.swift')
la_attr_ref    = ensure_file(live_g,    'PsycleLiveActivityAttributes.swift')
la_view_ref    = ensure_file(live_g,    'PsycleLiveActivityView.swift')
la_ctrl_ref    = ensure_file(live_g,    'PsycleLiveActivityController.swift')
intent_ref     = ensure_file(intents_g, 'NextClassIntent.swift')
shortcuts_ref  = ensure_file(intents_g, 'AppShortcuts.swift')
# NotificationCategories.swift stays OUT of all targets by design (it is a
# native reference; the Capacitor notification path is the live one).
ensure_file(intents_g, 'NotificationCategories.swift')
ensure_file(ext_g, 'Info.plist')
ensure_file(ext_g, 'PsycleWidgetExtension.entitlements')

app_group = project.main_group['App']
appgroup_plugin_ref = app_group.files.find { |f| f.path == 'AppGroupPreferences.swift' } ||
                      app_group.new_reference('AppGroupPreferences.swift')
main_vc_ref = app_group.files.find { |f| f.path == 'MainViewController.swift' } ||
              app_group.new_reference('MainViewController.swift')
app_ent_ref = app_group.files.find { |f| f.path == 'App.entitlements' } ||
              app_group.new_reference('App.entitlements')

# ── 3. App target: new sources + entitlements ──────────────────────────────
app_new_sources = [snapshot_ref, la_attr_ref, la_ctrl_ref, intent_ref,
                   shortcuts_ref, appgroup_plugin_ref, main_vc_ref]
existing = app_target.source_build_phase.files_references
app_new_sources.each do |ref|
  next if existing.include?(ref)
  app_target.source_build_phase.add_file_reference(ref)
  puts "App sources += #{ref.path}"
end

app_target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
end

# ── 4. Widget extension target ──────────────────────────────────────────────
ext = project.targets.find { |t| t.name == 'PsycleWidgetExtension' }
unless ext
  ext = project.new_target(:app_extension, 'PsycleWidgetExtension', :ios, '16.1')
  puts 'created target PsycleWidgetExtension'
end

team = app_target.build_configurations.first.build_settings['DEVELOPMENT_TEAM']
ext.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.psyclefinder.app.widgets'
  s['INFOPLIST_FILE']            = 'PsycleWidgetExtension/Info.plist'
  s['GENERATE_INFOPLIST_FILE']   = 'NO'
  s['CODE_SIGN_ENTITLEMENTS']    = 'PsycleWidgetExtension/PsycleWidgetExtension.entitlements'
  s['CODE_SIGN_STYLE']           = 'Automatic'
  s['DEVELOPMENT_TEAM']          = team if team
  s['SWIFT_VERSION']             = '5.0'
  s['TARGETED_DEVICE_FAMILY']    = '1'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.1'
  s['MARKETING_VERSION']         = '1.0'
  s['CURRENT_PROJECT_VERSION']   = '1'
  s['SKIP_INSTALL']              = 'YES'
  s['PRODUCT_NAME']              = '$(TARGET_NAME)'
  s['LD_RUNPATH_SEARCH_PATHS']   = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

ext_sources = [widget_ref, la_view_ref, la_attr_ref, snapshot_ref]
ext_existing = ext.source_build_phase.files_references
ext_sources.each do |ref|
  next if ext_existing.include?(ref)
  ext.source_build_phase.add_file_reference(ref)
  puts "Ext sources += #{ref.path}"
end

# ── 4b. Privacy manifests (required-reason API declarations) ───────────────
# Both binaries touch UserDefaults (CA92.1) — each target bundles its own
# PrivacyInfo.xcprivacy as a RESOURCE (not a compiled source).
app_privacy_ref = app_group.files.find { |f| f.path == 'PrivacyInfo.xcprivacy' } ||
                  app_group.new_reference('PrivacyInfo.xcprivacy')
ext_privacy_ref = ext_g.files.find { |f| f.path == 'PrivacyInfo.xcprivacy' } ||
                  ext_g.new_reference('PrivacyInfo.xcprivacy')

unless app_target.resources_build_phase.files_references.include?(app_privacy_ref)
  app_target.resources_build_phase.add_file_reference(app_privacy_ref)
  puts 'App resources += PrivacyInfo.xcprivacy'
end
unless ext.resources_build_phase.files_references.include?(ext_privacy_ref)
  ext.resources_build_phase.add_file_reference(ext_privacy_ref)
  puts 'Ext resources += PrivacyInfo.xcprivacy'
end

# ── 5. Embed the extension in the app ───────────────────────────────────────
app_target.add_dependency(ext) unless app_target.dependencies.any? { |d| d.target == ext }

embed = app_target.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' }
unless embed
  embed = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
  bf = embed.add_file_reference(ext.product_reference)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts 'added Embed Foundation Extensions phase'
end

project.save
puts 'saved.'
