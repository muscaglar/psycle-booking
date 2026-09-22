//
//  TipJarPlugin.swift
//  "Support Psync": optional tips through Apple's in-app purchase (StoreKit 2).
//
//  Psync is free. App Review Guideline 3.1.1 allows an app to let people "tip"
//  its developer ONLY through in-app purchase, and outside the United States
//  storefront an app may not link to any other way of paying — so this is the
//  one way money can change hands inside the iPhone app.
//
//  A tip unlocks NOTHING. There is no entitlement to grant, so nothing is
//  restored, nothing is remembered, no receipt leaves the device and there is
//  no server to validate one. A purchase is only ever reported as made when
//  StoreKit says the transaction is VERIFIED, and it is finished at once (a
//  consumable that is never finished is offered back for ever).
//
//  The web layer reaches this plugin by existence (Capacitor.Plugins.PsycleTipJar)
//  and shows its "Support Psync" section only when products() returns something:
//  until the three products exist in App Store Connect — and the Paid Apps
//  agreement is in force — the section simply is not there. The Android app has
//  a Java twin under the same name and method shapes (Google Play Billing).
//

import Foundation
import Capacitor
import StoreKit

/// The ONLY things this app sells, cheapest first. The same three ids are
/// the allow-list in js/tabs.js and in the Android twin: a product id is never
/// taken from the web layer on trust (tests/suites/24-tip-jar.js holds the three
/// lists to each other).
enum PsycleTipProducts {
    // ── tip-products:start
    static let ids: [String] = [
        "com.psyclefinder.app.tip.small",
        "com.psyclefinder.app.tip.medium",
        "com.psyclefinder.app.tip.large"
    ]
    // ── tip-products:end
}

@objc(PsycleTipJarPlugin)
public class PsycleTipJarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PsycleTipJarPlugin"
    public let jsName = "PsycleTipJar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise)
    ]

    /// One purchase at a time. Read and written on the main actor only.
    private var purchasing = false
    private var updates: Task<Void, Never>?

    /// A tip approved later (Ask to Buy) or interrupted mid-purchase arrives
    /// here, possibly at the next launch. It is finished like any other —
    /// verified tips only, and only ours.
    public override func load() {
        updates = Task.detached {
            for await result in Transaction.updates {
                if case .verified(let transaction) = result, PsycleTipProducts.ids.contains(transaction.productID) {
                    await transaction.finish()
                }
            }
        }
    }

    deinit { updates?.cancel() }

    /// { products: [{ id, displayPrice }] } in the list's own order. The price is
    /// the store's localized string ("£1.99"): the web layer prints it as text.
    /// Any failure — no network, no agreement, no products yet — is an empty
    /// list, which hides the section.
    @objc func products(_ call: CAPPluginCall) {
        Task {
            var out: [[String: String]] = []
            if let found = try? await Product.products(for: PsycleTipProducts.ids) {
                for id in PsycleTipProducts.ids {
                    if let product = found.first(where: { $0.id == id }) {
                        out.append(["id": product.id, "displayPrice": product.displayPrice])
                    }
                }
            }
            call.resolve(["products": out])
        }
    }

    /// { status: 'purchased' | 'cancelled' | 'pending' | 'failed' | 'unavailable' }.
    /// Apple's own payment sheet is the confirmation: nothing is charged without it.
    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("productId"), PsycleTipProducts.ids.contains(id) else {
            call.reject("Unknown product")
            return
        }
        Task { @MainActor in
            if self.purchasing {
                call.reject("A purchase is already in progress")
                return
            }
            self.purchasing = true
            defer { self.purchasing = false }
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.resolve(["status": "unavailable"])
                    return
                }
                switch try await product.purchase() {
                case .success(let verification):
                    // Unverified: not finished, not thanked. StoreKit offers it again.
                    guard case .verified(let transaction) = verification else {
                        call.resolve(["status": "failed"])
                        return
                    }
                    await transaction.finish()
                    call.resolve(["status": "purchased"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    call.resolve(["status": "pending"])
                @unknown default:
                    call.resolve(["status": "failed"])
                }
            } catch {
                call.resolve(["status": "failed"])
            }
        }
    }
}
