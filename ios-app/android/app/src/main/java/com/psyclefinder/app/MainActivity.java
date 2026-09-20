package com.psyclefinder.app;

import android.content.Intent;
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
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import com.psyclefinder.app.widget.NextClassWidgetProvider;

public class MainActivity extends BridgeActivity {

    /**
     * The intent whose widget tap was last handed to the page: the same intent coming by a second
     * time hands over nothing (see handWidgetTap).
     */
    private Intent answeredTap;

    /**
     * True while onCreate runs for an activity that Android is bringing BACK (from a saved
     * state, or from the recents list): its launch intent is an old one, and a widget tap in
     * it was answered when it was new.
     */
    private boolean relaunchOfAnOldIntent;

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
        // The app's own plugins - the Android twins of the three the iPhone app registers in
        // Swift, under the same JavaScript names, so the bridge (native-bridge.js) drives the
        // home-screen widget through the code path it already has. Capacitor does not discover
        // a plugin that lives in the app module: each is registered here, BEFORE super.onCreate,
        // which builds the bridge from this list.
        registerPlugin(AppGroupPreferencesPlugin.class);
        registerPlugin(WidgetCenterPlugin.class);
        registerPlugin(PsycleDeepLinkPlugin.class);

        Intent launch = getIntent();
        relaunchOfAnOldIntent = savedInstanceState != null
            || (launch != null && (launch.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0);

        super.onCreate(savedInstanceState);

        // Every cold start asks the home-screen widget to read its store again. The bridge
        // asks only after a snapshot pass that WRITES, and with nothing to write it stays
        // silent: after Settings > Apps > Clear storage (which force-stops the app, so its
        // alarm is gone and no update broadcast arrives) the launcher would keep showing the
        // last class it was given over an empty store, until Android's half-hourly update. An
        // explicit broadcast to the app's own provider: it takes nothing from anywhere, paints
        // what is stored - "Nothing booked" after a wipe - and arms the repaint alarm again.
        // The sign-out and session-expiry rules are the bridge's, and are not touched by it.
        NextClassWidgetProvider.requestRefresh(this);

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

        // A tap on the home-screen widget that STARTED the app. (BridgeActivity may already have
        // passed the launch intent through onNewIntent while it built the bridge; handWidgetTap
        // answers an intent once.)
        handWidgetTap(getIntent());
        relaunchOfAnOldIntent = false;
    }

    /** A tap on the home-screen widget while the app is alive: the activity is singleTask. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handWidgetTap(intent);
    }

    /**
     * Hands a widget tap to the page. The widget opens this activity with an EXPLICIT intent
     * (NextClassWidgetProvider.ACTION_OPEN) carrying the shown class's id as an extra - no URL
     * scheme, no intent filter - and PsycleDeepLinkPlugin turns it into the 'openURL' event the
     * bridge already listens for, retained until the page is there to hear it.
     *
     * The activity is exported (it is the launcher), so ANY app can send this action with an
     * extra of its choosing. The id is therefore untrusted - PsyncSnapshot.deepLink keeps 1 to
     * 12 digits or nothing - and the most a forged tap can do is what a real one does: show My
     * Bookings, and the sheet of a class the member holds. It never books, cancels or spends.
     *
     * Once per intent: the launch intent can come by twice (above), and an OLD launch intent
     * (the activity restored from a saved state, or relaunched from recents) is not answered
     * at all - a sheet that opens by itself days after the tap is worse than none.
     */
    private void handWidgetTap(Intent intent) {
        if (intent == null || intent == answeredTap
                || !NextClassWidgetProvider.ACTION_OPEN.equals(intent.getAction())) {
            return;
        }
        answeredTap = intent;
        if (relaunchOfAnOldIntent) {
            return;
        }
        String eventId;
        try {
            eventId = intent.getStringExtra(NextClassWidgetProvider.EXTRA_EVENT_ID);
        } catch (RuntimeException e) {
            // Extras that cannot be unparcelled (a forged intent): a tap with no id.
            eventId = null;
        }
        Bridge current = getBridge();
        PluginHandle handle = current == null ? null : current.getPlugin(PsycleDeepLinkPlugin.NAME);
        Plugin plugin = handle == null ? null : handle.getInstance();
        if (plugin instanceof PsycleDeepLinkPlugin) {
            ((PsycleDeepLinkPlugin) plugin).openFromWidget(eventId);
        }
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
