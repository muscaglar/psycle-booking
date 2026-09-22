package com.psyclefinder.app.tips;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * The ONLY things this app sells: three consumable tips, cheapest first. They unlock nothing.
 *
 * PURE (java.* only), so the JVM tests run the real code. The same three ids are the allow-list in js/tabs.js and
 * in the iPhone plugin (ios/App/App/TipJarPlugin.swift): a product id is never taken from the web layer on trust,
 * and a purchase the store reports is only ever consumed when EVERY product in it is one of these
 * (tests/suites/24-tip-jar.js holds the three lists to each other).
 */
public final class PsyncTips {
    private PsyncTips() {}

    // ── tip-products:start
    public static final List<String> IDS = Collections.unmodifiableList(Arrays.asList(
        "com.psyclefinder.app.tip.small",
        "com.psyclefinder.app.tip.medium",
        "com.psyclefinder.app.tip.large"
    ));
    // ── tip-products:end

    /** One of the three, exactly: no trimming, no case folding, never null. */
    public static boolean isTip(String productId) {
        return productId != null && IDS.contains(productId);
    }

    /** True only for a non-empty list whose EVERY product is a tip: a mixed or empty purchase is never ours to consume. */
    public static boolean allTips(List<String> productIds) {
        if (productIds == null || productIds.isEmpty()) return false;
        for (String id : productIds) {
            if (!isTip(id)) return false;
        }
        return true;
    }
}
