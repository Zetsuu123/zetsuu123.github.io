package io.github.zetsuu123.phoneprices;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

/**
 * Phone Prices.
 *
 * The screen is a web app (https://zetsuu123.github.io/phone-prices/, with a bundled copy for when
 * the site can't be reached). For each store it searches, the web app asks this activity, through
 * the "PPBridge" JavaScript interface, to open the store's search page in a hidden "worker" WebView
 * and to run its product extractor in that page. Results and page events go back to the web app
 * through window.PPNative.on(store, type, a, b).
 *
 * Worker WebViews sit behind the app's WebView (so they lay out and render like a normal page) and
 * have no JavaScript interface of their own. The person can bring one to the front ("Show page"),
 * e.g. to pass a store's "are you human" check.
 */
public class MainActivity extends Activity {

    private static final String LIVE_HOST = "zetsuu123.github.io";
    private static final String LIVE_PATH = "/phone-prices/";
    private static final String LIVE_URL = "https://" + LIVE_HOST + LIVE_PATH;
    private static final String APP_HOST = "appassets.androidplatform.net";
    private static final String OFFLINE_URL = "https://" + APP_HOST + "/assets/www/index.html";

    private FrameLayout root;
    private FrameLayout workerLayer;
    private LinearLayout bar;
    private TextView barTitle;
    private WebView web;
    private WebViewAssetLoader assetLoader;
    private final Map<String, WebView> workers = new HashMap<>();
    private String showing;
    private String workerUa;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        // Store pages get the normal mobile Chrome user agent (without the WebView marker),
        // so they show their regular mobile site.
        workerUa = WebSettings.getDefaultUserAgent(this)
                .replace("; wv)", ")")
                .replaceFirst(" Version/\\d+(\\.\\d+)*", "");

        int bg = getColor(R.color.bg);
        root = new FrameLayout(this);
        root.setBackgroundColor(bg);
        setContentView(root);
        setupEdgeToEdge();

        workerLayer = new FrameLayout(this);
        root.addView(workerLayer, match());

        web = new WebView(this);
        web.setBackgroundColor(bg);
        root.addView(web, match());

        bar = buildBar();
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52), Gravity.TOP));
        bar.setVisibility(View.GONE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " PhonePricesApp/" + BuildConfig.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(), "PPBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Live site unreachable (e.g. offline): use the bundled copy.
                if (request.isForMainFrame() && LIVE_HOST.equals(request.getUrl().getHost())) {
                    view.loadUrl(OFFLINE_URL);
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                // Live site answered with an error page (e.g. 404 before it is published): use the bundled copy.
                if (request.isForMainFrame() && LIVE_HOST.equals(request.getUrl().getHost()) && response.getStatusCode() >= 400) {
                    view.loadUrl(OFFLINE_URL);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAppUrl(uri) && (uri.getPath() == null || !uri.getPath().endsWith(".apk"))) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The page renderer died (out of memory, crash): start over instead of crashing.
                recreate();
                return true;
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(LIVE_URL);
        }
    }

    /* ------------------------------------------------------------------ */
    /* Bridge used by the web app                                          */
    /* ------------------------------------------------------------------ */
    private class Bridge {
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        /** Open url (a store search page) in the worker WebView for store id. */
        @JavascriptInterface
        public void load(String id, String url) {
            onUi(() -> {
                if (!isHttps(url)) return;
                WebView w = worker(id);
                w.stopLoading();
                w.loadUrl(url);
            });
        }

        /** Run script in the store's page; its result (as JSON) comes back as an "eval" event. */
        @JavascriptInterface
        public void eval(String id, String token, String script) {
            onUi(() -> {
                WebView w = workers.get(id);
                if (w == null) return;
                w.evaluateJavascript(script, value -> send(id, "eval", token, value));
            });
        }

        /** Stop loading the store's page (search done: no need for its ads and trackers). */
        @JavascriptInterface
        public void stop(String id) {
            onUi(() -> {
                WebView w = workers.get(id);
                if (w != null) w.stopLoading();
            });
        }

        /** Show the store's page full screen, e.g. to pass a "verify you are human" check. */
        @JavascriptInterface
        public void show(String id, String title) {
            onUi(() -> showWorker(id, title));
        }

        /** Open a product page in the browser or the store's app. */
        @JavascriptInterface
        public void open(String url) {
            onUi(() -> {
                if (isHttps(url) || (url != null && url.startsWith("http://"))) openExternal(Uri.parse(url));
            });
        }

        /** Share text (debug info) through the Android share sheet. */
        @JavascriptInterface
        public void share(String text) {
            onUi(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                try {
                    startActivity(Intent.createChooser(send, "Share debug info"));
                } catch (ActivityNotFoundException e) {
                    toast("No app to share with");
                }
            });
        }

        /** Delete the stores' cookies, storage and cache (not the app's own settings). */
        @JavascriptInterface
        public void clearData() {
            onUi(() -> {
                CookieManager.getInstance().removeAllCookies(null);
                CookieManager.getInstance().flush();
                for (Map.Entry<String, WebView> e : workers.entrySet()) {
                    WebView w = e.getValue();
                    String url = w.getUrl();
                    if (url != null && isHttps(url)) {
                        Uri u = Uri.parse(url);
                        WebStorage.getInstance().deleteOrigin(u.getScheme() + "://" + u.getHost());
                    }
                    w.clearCache(true);
                    w.clearHistory();
                }
                toast("Store cookies cleared");
            });
        }
    }

    /** Runs r on the UI thread, only while the app's own page is showing. */
    private void onUi(Runnable r) {
        runOnUiThread(() -> {
            if (web == null) return;
            String url = web.getUrl();
            if (url == null || !isAppUrl(Uri.parse(url))) return;
            r.run();
        });
    }

    private boolean isAppUrl(Uri uri) {
        String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null) return false;
        if (APP_HOST.equals(host)) return true;
        return LIVE_HOST.equals(host) && uri.getPath() != null && uri.getPath().startsWith(LIVE_PATH);
    }

    private static boolean isHttps(String url) {
        return url != null && url.startsWith("https://");
    }

    /** Calls window.PPNative.on(id, type, a, b) in the app's page. */
    private void send(String id, String type, String a, String b) {
        if (web == null) return;
        String js = "window.PPNative&&PPNative.on(" + JSONObject.quote(id) + "," + JSONObject.quote(type) + ","
                + JSONObject.quote(a == null ? "" : a) + "," + JSONObject.quote(b == null ? "" : b) + ")";
        web.evaluateJavascript(js, null);
    }

    /* ------------------------------------------------------------------ */
    /* Worker WebViews (one per store)                                     */
    /* ------------------------------------------------------------------ */
    private WebView worker(String id) {
        WebView w = workers.get(id);
        if (w != null) return w;
        w = new WebView(this);
        w.setBackgroundColor(Color.WHITE);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setGeolocationEnabled(false);
        s.setBlockNetworkImage(true); // product image URLs are read from the page; no need to download them here
        s.setUserAgentString(workerUa);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);

        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                send(id, "start", url, "");
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                send(id, "commit", url, "");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                send(id, "page", url, "");
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) {
                    send(id, "http", String.valueOf(response.getStatusCode()), request.getUrl().toString());
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    send(id, "error", String.valueOf(error.getDescription()), request.getUrl().toString());
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                // stay on web pages; never hand off to other apps (intent:, market:, tel: ...)
                return !("https".equals(scheme) || "http".equals(scheme));
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                dropWorker(id);
                send(id, "error", "page crashed", "");
                return true;
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            // Store pages run unattended: no pop-up dialogs, no permission prompts.
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                result.cancel();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                result.cancel();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                result.cancel();
                return true;
            }

            @Override
            public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });
        w.setDownloadListener((url, ua, cd, mime, len) -> { /* ignore downloads */ });

        workerLayer.addView(w, 0, match());
        workers.put(id, w);
        return w;
    }

    private void dropWorker(String id) {
        WebView w = workers.remove(id);
        if (w == null) return;
        if (id.equals(showing)) hideWorker();
        workerLayer.removeView(w);
        w.destroy();
    }

    private void showWorker(String id, String title) {
        WebView w = workers.get(id);
        if (w == null) return;
        if (showing != null && !showing.equals(id)) hideWorker();
        showing = id;
        w.getSettings().setBlockNetworkImage(false);
        w.bringToFront();
        barTitle.setText(title == null ? "" : title);
        bar.setVisibility(View.VISIBLE);
        workerLayer.setPadding(0, dp(52), 0, 0);
        web.setVisibility(View.INVISIBLE);
        w.requestFocus();
        if (Build.VERSION.SDK_INT >= 33 && backCallback == null) {
            backCallback = this::hideWorker;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    private void hideWorker() {
        String id = showing;
        showing = null;
        bar.setVisibility(View.GONE);
        workerLayer.setPadding(0, 0, 0, 0);
        web.setVisibility(View.VISIBLE);
        web.bringToFront();
        bar.bringToFront();
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
            backCallback = null;
        }
        if (id != null) {
            WebView w = workers.get(id);
            if (w != null) w.getSettings().setBlockNetworkImage(true);
            send(id, "closed", "", "");
        }
    }

    /** Top bar shown above a store page: title, "Browser", "Close". */
    private LinearLayout buildBar() {
        LinearLayout b = new LinearLayout(this);
        b.setOrientation(LinearLayout.HORIZONTAL);
        b.setGravity(Gravity.CENTER_VERTICAL);
        b.setBackgroundColor(getColor(R.color.panel));
        b.setPadding(dp(16), 0, dp(4), 0);
        b.setElevation(dp(4));

        barTitle = new TextView(this);
        barTitle.setTextColor(getColor(R.color.text));
        barTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        barTitle.setTypeface(Typeface.DEFAULT_BOLD);
        barTitle.setSingleLine(true);
        b.addView(barTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView browser = barButton("Browser");
        browser.setOnClickListener(v -> {
            WebView w = showing == null ? null : workers.get(showing);
            if (w != null && w.getUrl() != null) openExternal(Uri.parse(w.getUrl()));
        });
        b.addView(browser);

        TextView close = barButton("Close");
        close.setOnClickListener(v -> hideWorker());
        b.addView(close);
        return b;
    }

    private TextView barButton(String label) {
        TextView t = new TextView(this);
        t.setText(label);
        t.setTextColor(getColor(R.color.primary));
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(dp(12), dp(14), dp(12), dp(14));
        t.setClickable(true);
        TypedValue tv = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackground, tv, true);
        t.setBackgroundResource(tv.resourceId);
        return t;
    }

    /* ------------------------------------------------------------------ */
    /* Helpers and lifecycle                                               */
    /* ------------------------------------------------------------------ */
    private void setupEdgeToEdge() {
        if (Build.VERSION.SDK_INT < 30) return; // older versions: the system keeps content clear of the bars
        getWindow().setDecorFitsSystemWindows(false);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(night ? 0 : light, light);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    private static FrameLayout.LayoutParams match() {
        return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            toast("No app found to open " + uri.getHost());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Android 12 and older (13+ uses the OnBackInvokedCallback registered while a page is shown)
        if (showing != null) hideWorker();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        for (WebView w : workers.values()) w.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        for (WebView w : workers.values()) w.onResume();
    }

    @Override
    protected void onDestroy() {
        for (WebView w : workers.values()) w.destroy();
        workers.clear();
        web.destroy();
        web = null;
        super.onDestroy();
    }
}
