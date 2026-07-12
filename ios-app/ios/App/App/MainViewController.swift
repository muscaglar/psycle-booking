//
//  MainViewController.swift
//  Registers in-app Capacitor plugins. Capacitor 6 removed automatic
//  plugin discovery, so plugins that live inside the app target must be
//  registered from a CAPBridgeViewController subclass — this class is set
//  as the storyboard view controller's custom class.
//

import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppGroupPreferencesPlugin())
        bridge?.registerPluginInstance(WidgetCenterPlugin())
        bridge?.registerPluginInstance(PsycleLiveActivityPlugin())
    }
}
