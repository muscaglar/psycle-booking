package com.psyclefinder.app;

import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * What the hardware / gesture BACK asks the page. The web app answers true when it handled
     * it (it closed its top overlay, sheet, dialog, menu or panel through its own close path,
     * or left a tab for Discover) and false when there was nothing to close. The web layer
     * defines the function; while it does not exist (the page is still loading) the answer is
     * false.
     */
    private static final String ASK_PAGE_TO_GO_BACK =
        "(window._psycleAndroidBack ? window._psycleAndroidBack() : false)";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // After super.onCreate: that is where BridgeActivity builds the bridge and the web view.
        // It can also return early WITHOUT one (the device has no WebView), so nothing below
        // assumes it is there.
        WebView webView = currentWebView();
        if (webView != null) {
            // The ground by day or by night (values/ and values-night/colors.xml), so the moment
            // between the launch window and the page's first paint is the same colour as both.
            // capacitor.config.json can only name one colour (android.backgroundColor, the light
            // ground); this is the same thing, night-aware, and it is set later so it wins.
            webView.setBackgroundColor(ContextCompat.getColor(this, R.color.psync_ground));
        }

        // Without the @capacitor/app plugin (not installed, by decision: a new plugin is a new
        // iOS pod) Capacitor leaves BACK to Android, which FINISHES the activity: one stray
        // swipe would close the app under an open sheet. Instead the page is asked first, and
        // when it has nothing to close the task goes to the background, alive, like Home.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = currentWebView();
                if (view == null) {
                    moveTaskToBack(true);
                    return;
                }
                // evaluateJavascript answers with JSON text: "true", "false" or "null".
                view.evaluateJavascript(ASK_PAGE_TO_GO_BACK, value -> {
                    if (!"true".equals(value)) {
                        moveTaskToBack(true);
                    }
                });
            }
        });
    }

    /**
     * The system switched between light and dark while the activity was alive. The manifest
     * keeps uiMode in android:configChanges, so the activity is NOT recreated (a recreation
     * reloads the web view, and could interrupt a request in flight) - and BACK never finishes
     * it, so one instance can live for days, across every sunset. The window read its
     * navigation-bar colour and the web view its ground once, at creation: both are read again
     * here, from the resources of the mode now in force (values/ and values-night/).
     * The status bar is left alone: the web layer's bridge colours it per app theme
     * (updateStatusBar in native-bridge.js), and the page follows the system by itself.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);

        Window window = getWindow();
        if (window != null) {
            window.setNavigationBarColor(ContextCompat.getColor(this, R.color.psync_navigation_bar));
            // Dark buttons on the pale bar exist from API 27, as in values-v27/styles.xml. Below
            // that the bar is the ink by day (values/colors.xml) and its buttons stay white.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                new WindowInsetsControllerCompat(window, window.getDecorView())
                    .setAppearanceLightNavigationBars(getResources().getBoolean(R.bool.psync_light_system_bars));
            }
        }

        WebView webView = currentWebView();
        if (webView != null) {
            webView.setBackgroundColor(ContextCompat.getColor(this, R.color.psync_ground));
        }
    }

    /** The bridge's web view, or null when the bridge (or its web view) is not there. */
    private WebView currentWebView() {
        Bridge current = getBridge();
        return current == null ? null : current.getWebView();
    }
}
