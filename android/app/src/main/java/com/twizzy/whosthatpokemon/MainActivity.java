package com.twizzy.whosthatpokemon;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialException;

import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.firebase.auth.AuthCredential;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.GoogleAuthProvider;

import org.json.JSONObject;

import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public class MainActivity extends Activity {
    private static final String TRUSTED_APP_URL = "https://therealtwizzy.github.io/whos-that-pokemon/";
    private static final String TRUSTED_SCHEME = "https";
    private static final String TRUSTED_HOST = "therealtwizzy.github.io";
    private static final String TRUSTED_PATH_PREFIX = "/whos-that-pokemon/";
    private static final String JS_BRIDGE_NAME = "PokeNativeAuth";
    private static final String NATIVE_AUTH_EVENT = "poke-native-auth-result";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Executor mainExecutor = new Executor() {
        @Override
        public void execute(Runnable command) {
            mainHandler.post(command);
        }
    };
    private final NativeAuthBridge nativeAuthBridge = new NativeAuthBridge();

    private WebView webView;
    private CredentialManager credentialManager;
    private FirebaseAuth firebaseAuth;
    private ExecutorService authExecutor;
    private CancellationSignal authCancellationSignal;
    private boolean nativeBridgeInjected = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        hideSystemUi();

        credentialManager = CredentialManager.create(this);
        firebaseAuth = FirebaseAuth.getInstance();
        authExecutor = Executors.newSingleThreadExecutor();

        webView = new WebView(this);
        webView.setWebViewClient(new TrustedWebViewClient());
        webView.setOnSystemUiVisibilityChangeListener(new View.OnSystemUiVisibilityChangeListener() {
            @Override
            public void onSystemUiVisibilityChange(int visibility) {
                hideSystemUi();
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setJavaScriptEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        setContentView(webView);
        updateNativeBridgeForUrl(TRUSTED_APP_URL);
        webView.loadUrl(TRUSTED_APP_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (authCancellationSignal != null) {
            authCancellationSignal.cancel();
            authCancellationSignal = null;
        }
        if (authExecutor != null) {
            authExecutor.shutdownNow();
            authExecutor = null;
        }
        if (webView != null) {
            removeNativeBridge();
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }

    private void updateNativeBridgeForUrl(String url) {
        if (isTrustedAppUrl(url)) {
            ensureNativeBridge();
        } else {
            removeNativeBridge();
        }
    }

    private void ensureNativeBridge() {
        if (webView == null || nativeBridgeInjected) return;
        webView.addJavascriptInterface(nativeAuthBridge, "PokeNativeAuth");
        nativeBridgeInjected = true;
    }

    private void removeNativeBridge() {
        if (webView == null || !nativeBridgeInjected) return;
        webView.removeJavascriptInterface(JS_BRIDGE_NAME);
        nativeBridgeInjected = false;
    }

    private boolean shouldBlockNavigation(String url) {
        if (isTrustedAppUrl(url)) {
            updateNativeBridgeForUrl(url);
            return false;
        }

        removeNativeBridge();
        return true;
    }

    private boolean isTrustedAppUrl(String url) {
        if (url == null) return false;

        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        String path = uri.getPath();

        return TRUSTED_SCHEME.equalsIgnoreCase(scheme)
            && TRUSTED_HOST.equalsIgnoreCase(host)
            && path != null
            && (path.equals(TRUSTED_PATH_PREFIX) || path.startsWith(TRUSTED_PATH_PREFIX));
    }

    private void startNativeGoogleSignIn(String requestId) {
        if (webView == null || !isTrustedAppUrl(webView.getUrl())) {
            postNativeAuthError(requestId, "auth/native-login-unavailable", "Native Google login is only available on the trusted app page.");
            return;
        }

        String webClientId = getDefaultWebClientId();
        if (webClientId.isEmpty()) {
            postNativeAuthError(requestId, "auth/native-login-unavailable", "Firebase web client ID is missing from google-services.json.");
            return;
        }

        if (authCancellationSignal != null) {
            authCancellationSignal.cancel();
        }
        authCancellationSignal = new CancellationSignal();

        GetGoogleIdOption googleIdOption = new GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(webClientId)
            .setAutoSelectEnabled(false)
            .build();
        GetCredentialRequest credentialRequest = new GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build();

        credentialManager.getCredentialAsync(
            this,
            credentialRequest,
            authCancellationSignal,
            authExecutor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse result) {
                    mainExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            handleCredentialResult(requestId, result);
                        }
                    });
                }

                @Override
                public void onError(GetCredentialException error) {
                    postNativeAuthError(requestId, "auth/native-login-cancelled", error.getMessage());
                }
            }
        );
    }

    private void handleCredentialResult(String requestId, GetCredentialResponse result) {
        Credential credential = result.getCredential();
        if (!(credential instanceof CustomCredential)) {
            postNativeAuthError(requestId, "auth/native-login-unavailable", "Google did not return an ID token credential.");
            return;
        }

        CustomCredential customCredential = (CustomCredential) credential;
        if (!GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(customCredential.getType())) {
            postNativeAuthError(requestId, "auth/native-login-unavailable", "Google did not return an ID token credential.");
            return;
        }

        try {
            GoogleIdTokenCredential googleCredential = GoogleIdTokenCredential.createFrom(customCredential.getData());
            String idToken = googleCredential.getIdToken();
            if (idToken == null || idToken.isEmpty()) {
                postNativeAuthError(requestId, "auth/native-login-unavailable", "Google returned an empty ID token.");
                return;
            }
            signInFirebaseThenReturnToken(requestId, idToken);
        } catch (RuntimeException error) {
            postNativeAuthError(requestId, "auth/native-login-unavailable", error.getMessage());
        }
    }

    private void signInFirebaseThenReturnToken(String requestId, String idToken) {
        AuthCredential credential = GoogleAuthProvider.getCredential(idToken, null);
        firebaseAuth.signInWithCredential(credential)
            .addOnCompleteListener(this, task -> {
                if (task.isSuccessful()) {
                    postNativeAuthToken(requestId, idToken);
                    return;
                }

                Exception error = task.getException();
                postNativeAuthError(
                    requestId,
                    "auth/native-login-unavailable",
                    error != null ? error.getMessage() : "Firebase rejected the native Google credential."
                );
            });
    }

    private void signOutNative() {
        if (firebaseAuth != null) {
            firebaseAuth.signOut();
        }

        if (credentialManager == null || authExecutor == null) return;
        credentialManager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            new CancellationSignal(),
            authExecutor,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) {
                    // Web Firebase sign-out owns the visible UI state.
                }

                @Override
                public void onError(ClearCredentialException error) {
                    // Credential state clearing is best-effort; web sign-out still proceeds.
                }
            }
        );
    }

    private String getDefaultWebClientId() {
        int resourceId = getResources().getIdentifier("default_web_client_id", "string", getPackageName());
        if (resourceId == 0) return "";
        return getString(resourceId);
    }

    private void postNativeAuthToken(String requestId, String idToken) {
        postNativeAuthResult(requestId, idToken, "", "");
    }

    private void postNativeAuthError(String requestId, String code, String message) {
        postNativeAuthResult(requestId, "", code, message);
    }

    private void postNativeAuthResult(String requestId, String idToken, String code, String message) {
        String script = "(function(){window.dispatchEvent(new CustomEvent(" +
            json(NATIVE_AUTH_EVENT) +
            ",{detail:{requestId:" + json(requestId) +
            ",idToken:" + json(idToken) +
            ",code:" + json(code) +
            ",message:" + json(message) +
            "}}));})();";

        mainExecutor.execute(new Runnable() {
            @Override
            public void run() {
                if (webView != null && isTrustedAppUrl(webView.getUrl())) {
                    webView.evaluateJavascript(script, null);
                }
            }
        });
    }

    private static String cleanRequestId(String requestId) {
        if (requestId == null || requestId.trim().isEmpty()) return "native-auth";
        String clean = requestId.trim();
        return clean.length() > 128 ? clean.substring(0, 128) : clean;
    }

    private static String json(String value) {
        return JSONObject.quote(value == null ? "" : value);
    }

    private void hideSystemUi() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
            return;
        }

        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private final class TrustedWebViewClient extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            updateNativeBridgeForUrl(url);
            if (!isTrustedAppUrl(url)) {
                view.stopLoading();
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request == null) return true;
            String url = request.getUrl().toString();
            if (!request.isForMainFrame()) return !isTrustedAppUrl(url);
            return shouldBlockNavigation(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return shouldBlockNavigation(url);
        }
    }

    private final class NativeAuthBridge {
        @JavascriptInterface
        public void signIn(String requestId) {
            String safeRequestId = cleanRequestId(requestId);
            mainExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    startNativeGoogleSignIn(safeRequestId);
                }
            });
        }

        @JavascriptInterface
        public void signOut() {
            mainExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    signOutNative();
                }
            });
        }
    }
}
