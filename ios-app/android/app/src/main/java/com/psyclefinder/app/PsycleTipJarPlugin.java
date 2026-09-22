package com.psyclefinder.app;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.psyclefinder.app.tips.PsyncTips;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * "Support Psync": optional tips through Google Play Billing. The Android twin of the iPhone app's
 * PsycleTipJar plugin (ios/App/App/TipJarPlugin.swift): the same JavaScript name and the same two methods, so
 * the web layer has one code path.
 *
 * Psync is free, and Play's payments policy has an app take money for a digital thing - a tip to its developer
 * included - through Play's billing system and nothing else. A tip unlocks NOTHING: there is no entitlement, so
 * nothing is restored or remembered, and no purchase token, order id or account detail is returned to the page,
 * logged or stored. A tip is CONSUMED as soon as Play reports it purchased (so it can be given again, and so
 * Play does not refund it as unacknowledged); one that could not be consumed then is consumed on the next
 * connection.
 *
 * The page shows its "Support Psync" section only when products() returns something: until the three products
 * exist in Play Console the section simply is not there.
 */
@CapacitorPlugin(name = "PsycleTipJar")
public class PsycleTipJarPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient billing;
    private final Map<String, ProductDetails> details = new HashMap<>();
    /** The purchase() call waiting for Play's answer. Guarded by this. */
    private PluginCall waiting;

    @Override
    public void load() {
        billing = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    @Override
    protected void handleOnDestroy() {
        if (billing != null) billing.endConnection();
        settle("failed");
    }

    /** { products: [{ id, displayPrice }] } in the list's own order; any failure is an empty list. */
    @PluginMethod
    public void products(final PluginCall call) {
        whenConnected(new Runnable() {
            @Override
            public void run() {
                List<QueryProductDetailsParams.Product> wanted = new ArrayList<>();
                for (String id : PsyncTips.IDS) {
                    wanted.add(QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id)
                        .setProductType(BillingClient.ProductType.INAPP)
                        .build());
                }
                QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(wanted).build();
                billing.queryProductDetailsAsync(params, (result, found) -> {
                    JSArray out = new JSArray();
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                        synchronized (PsycleTipJarPlugin.this) {
                            details.clear();
                            for (ProductDetails d : found.getProductDetailsList()) {
                                if (PsyncTips.isTip(d.getProductId())) details.put(d.getProductId(), d);
                            }
                            for (String id : PsyncTips.IDS) {
                                ProductDetails d = details.get(id);
                                ProductDetails.OneTimePurchaseOfferDetails offer = d == null ? null : d.getOneTimePurchaseOfferDetails();
                                if (offer == null) continue;
                                JSObject row = new JSObject();
                                row.put("id", id);
                                row.put("displayPrice", offer.getFormattedPrice());
                                out.put(row);
                            }
                        }
                    }
                    JSObject ret = new JSObject();
                    ret.put("products", out);
                    call.resolve(ret);
                });
            }
        }, new Runnable() {
            @Override
            public void run() {
                JSObject ret = new JSObject();
                ret.put("products", new JSArray());
                call.resolve(ret);
            }
        });
    }

    /** { status: 'purchased' | 'cancelled' | 'pending' | 'failed' | 'unavailable' }. Play's own sheet is the confirmation. */
    @PluginMethod
    public void purchase(final PluginCall call) {
        final String id = call.getString("productId");
        if (!PsyncTips.isTip(id)) {
            call.reject("Unknown product");
            return;
        }
        final ProductDetails product;
        synchronized (this) {
            if (waiting != null) {
                call.reject("A purchase is already in progress");
                return;
            }
            product = details.get(id);
            if (product == null) {
                resolve(call, "unavailable");
                return;
            }
            waiting = call;
        }
        whenConnected(new Runnable() {
            @Override
            public void run() {
                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        BillingFlowParams.ProductDetailsParams one = BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(product)
                            .build();
                        BillingFlowParams flow = BillingFlowParams.newBuilder()
                            .setProductDetailsParamsList(Collections.singletonList(one))
                            .build();
                        BillingResult started = billing.launchBillingFlow(getActivity(), flow);
                        if (started.getResponseCode() != BillingClient.BillingResponseCode.OK) settle("failed");
                    }
                });
            }
        }, new Runnable() {
            @Override
            public void run() {
                settle("failed");
            }
        });
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult result, @Nullable List<Purchase> purchases) {
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            settle("cancelled");
            return;
        }
        if (code != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            settle("failed");
            return;
        }
        boolean anyPending = false;
        for (Purchase purchase : purchases) {
            if (!PsyncTips.allTips(purchase.getProducts())) continue;
            if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                consume(purchase, true);
                return;
            }
            if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) anyPending = true;
        }
        settle(anyPending ? "pending" : "failed");
    }

    /** Consuming also acknowledges. Not consumed now (no network, say): "pending", and the next connection tries again. */
    private void consume(Purchase purchase, final boolean answers) {
        ConsumeParams params = ConsumeParams.newBuilder().setPurchaseToken(purchase.getPurchaseToken()).build();
        billing.consumeAsync(params, (result, token) -> {
            if (!answers) return;
            settle(result.getResponseCode() == BillingClient.BillingResponseCode.OK ? "purchased" : "pending");
        });
    }

    /** A tip bought earlier and never consumed - the app was closed, or a slow payment came through since. */
    private void consumeLeftovers() {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build();
        billing.queryPurchasesAsync(params, (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
            for (Purchase purchase : purchases) {
                if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED && PsyncTips.allTips(purchase.getProducts())) {
                    consume(purchase, false);
                }
            }
        });
    }

    private void whenConnected(final Runnable then, final Runnable otherwise) {
        if (billing == null) {
            otherwise.run();
            return;
        }
        if (billing.isReady()) {
            then.run();
            return;
        }
        billing.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(@NonNull BillingResult result) {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    consumeLeftovers();
                    then.run();
                } else {
                    otherwise.run();
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // enableAutoServiceReconnection() reconnects on the next call.
            }
        });
    }

    /** Answers the waiting purchase() call, once, whatever path got here. */
    private void settle(String status) {
        PluginCall call;
        synchronized (this) {
            call = waiting;
            waiting = null;
        }
        if (call != null) resolve(call, status);
    }

    private static void resolve(PluginCall call, String status) {
        JSObject ret = new JSObject();
        ret.put("status", status);
        call.resolve(ret);
    }
}
