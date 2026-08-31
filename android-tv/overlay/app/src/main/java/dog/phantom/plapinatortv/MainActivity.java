package dog.phantom.plapinatortv;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class MainActivity extends Activity {
    private static final int FILE_PICKER_REQUEST = 7401;
    private static final String APP_HOST = "appassets.androidplatform.net";

    private WebView webView;
    private ValueCallback<Uri[]> filePickerCallback;
    private SecureUploadServer uploadServer;
    private final Map<String, SecureUploadServer.UploadedFile> stagedFiles = new ConcurrentHashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        File uploadDir = new File(getFilesDir(), "incoming");
        if (!uploadDir.exists() && !uploadDir.mkdirs()) {
            Toast.makeText(this, "Could not create private media storage.", Toast.LENGTH_LONG).show();
        }
        pruneOldIncoming(uploadDir);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .addPathHandler("/media/", path -> openStagedMedia(path))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(0xff000000);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " PlapinatorTV/" + BuildConfig.VERSION_NAME);

        webView.addJavascriptInterface(new TvBridge(), "PlapinatorTV");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!APP_HOST.equalsIgnoreCase(uri.getHost())) return blockedResponse();
                WebResourceResponse response = assetLoader.shouldInterceptRequest(uri);
                return response != null ? response : blockedResponse();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !APP_HOST.equalsIgnoreCase(request.getUrl().getHost());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePickerCallback != null) filePickerCallback.onReceiveValue(null);
                filePickerCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                String[] requested = params.getAcceptTypes();
                if (requested != null && requested.length > 0) {
                    List<String> clean = new ArrayList<>();
                    for (String type : requested) {
                        if (type == null) continue;
                        for (String part : type.split(",")) {
                            String value = part.trim();
                            if (value.contains("/")) clean.add(value);
                        }
                    }
                    if (!clean.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, clean.toArray(new String[0]));
                }
                try {
                    startActivityForResult(intent, FILE_PICKER_REQUEST);
                } catch (Exception error) {
                    filePickerCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "No compatible file picker is installed.", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });

        webView.loadUrl("https://" + APP_HOST + "/assets/plapinator/index.html?tv=1");
        webView.requestFocus();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_PICKER_REQUEST || filePickerCallback == null) return;
        ValueCallback<Uri[]> callback = filePickerCallback;
        filePickerCallback = null;
        if (resultCode != RESULT_OK || data == null) {
            callback.onReceiveValue(null);
            return;
        }
        List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) {
            for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                Uri uri = data.getClipData().getItemAt(i).getUri();
                uris.add(uri);
                persistReadPermission(uri, data.getFlags());
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
            persistReadPermission(data.getData(), data.getFlags());
        }
        callback.onReceiveValue(uris.toArray(new Uri[0]));
    }

    private void persistReadPermission(Uri uri, int flags) {
        try {
            getContentResolver().takePersistableUriPermission(uri,
                    flags & Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Some providers grant access only for the current picker session.
        }
    }

    private WebResourceResponse openStagedMedia(String path) {
        String id = path == null ? "" : path.replace("/", "");
        SecureUploadServer.UploadedFile item = stagedFiles.get(id);
        if (item == null || !item.file.isFile()) return blockedResponse();
        try {
            return new WebResourceResponse(item.mimeType, null, new FileInputStream(item.file));
        } catch (FileNotFoundException ignored) {
            return blockedResponse();
        }
    }

    private WebResourceResponse blockedResponse() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked",
                headers,
                new java.io.ByteArrayInputStream(new byte[0]));
    }

    private void onUploads(List<SecureUploadServer.UploadedFile> files) {
        if (files.isEmpty()) return;
        JSONArray payload = new JSONArray();
        for (SecureUploadServer.UploadedFile item : files) {
            stagedFiles.put(item.id, item);
            JSONObject row = new JSONObject();
            try {
                row.put("id", item.id);
                row.put("name", item.originalName);
                row.put("type", item.mimeType);
                row.put("role", item.role);
                row.put("size", item.file.length());
                row.put("url", "https://" + APP_HOST + "/media/" + item.id);
                payload.put(row);
            } catch (Exception ignored) {
                // JSONObject values above are all primitives and should not fail.
            }
        }
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.PlapiTV&&window.PlapiTV.onNativeUploads(" + payload + ")", null));
    }

    private void pruneOldIncoming(File dir) {
        File[] children = dir.listFiles();
        if (children == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        for (File file : children) {
            if (file.isFile() && file.lastModified() < cutoff) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() > 0) {
            return super.dispatchKeyEvent(event);
        }
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            webView.evaluateJavascript("window.PlapiTV&&window.PlapiTV.handleBack()", null);
            return true;
        }
        String action = remoteAction(event.getKeyCode());
        if (action != null) {
            webView.evaluateJavascript(
                    "window.PlapiTV&&window.PlapiTV.handleMediaAction('" + action + "')", null);
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private String remoteAction(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "toggle";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "pause";
            case KeyEvent.KEYCODE_MEDIA_STOP: return "stop";
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "next";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "previous";
            case KeyEvent.KEYCODE_0: return "digit-0";
            case KeyEvent.KEYCODE_1: return "digit-1";
            case KeyEvent.KEYCODE_2: return "digit-2";
            case KeyEvent.KEYCODE_3: return "digit-3";
            case KeyEvent.KEYCODE_4: return "digit-4";
            case KeyEvent.KEYCODE_5: return "digit-5";
            case KeyEvent.KEYCODE_7: return "digit-7";
            case KeyEvent.KEYCODE_8: return "digit-8";
            case KeyEvent.KEYCODE_9: return "digit-9";
            default: return null;
        }
    }

    @Override
    protected void onDestroy() {
        if (uploadServer != null) uploadServer.stop();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    public final class TvBridge {
        @JavascriptInterface
        public String startSecureReceiver() {
            try {
                if (uploadServer != null) uploadServer.stop();
                uploadServer = new SecureUploadServer(
                        MainActivity.this,
                        new File(getFilesDir(), "incoming"),
                        MainActivity.this::onUploads);
                SecureUploadServer.Session session = uploadServer.start();
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("url", session.secureUrls.get(0));
                out.put("urls", new JSONArray(session.secureUrls));
                out.put("compatibilityUrl", session.compatibilityUrls.get(0));
                out.put("compatibilityUrls", new JSONArray(session.compatibilityUrls));
                out.put("pin", session.pin);
                out.put("fingerprint", session.fingerprint);
                out.put("expiresMinutes", 15);
                out.put("version", BuildConfig.VERSION_NAME);
                return out.toString();
            } catch (Exception error) {
                JSONObject out = new JSONObject();
                try {
                    out.put("ok", false);
                    out.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
                } catch (Exception ignored) {}
                return out.toString();
            }
        }

        @JavascriptInterface
        public void stopSecureReceiver() {
            if (uploadServer != null) {
                uploadServer.stop();
                uploadServer = null;
            }
        }

        @JavascriptInterface
        public String deviceName() {
            return String.format(Locale.US, "%s · Android %s · App v%s",
                    android.os.Build.MODEL == null ? "Sony TV" : android.os.Build.MODEL,
                    android.os.Build.VERSION.RELEASE,
                    BuildConfig.VERSION_NAME);
        }

        @JavascriptInterface
        public void closeApp() {
            runOnUiThread(MainActivity.this::finish);
        }
    }
}
