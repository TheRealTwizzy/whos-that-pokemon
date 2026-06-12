package com.twizzy.whosthatpokemon;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
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
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.FileProvider;
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

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public class MainActivity extends Activity {
    private static final String TRUSTED_APP_URL = "https://therealtwizzy.github.io/whos-that-pokemon/";
    private static final String UPDATE_MANIFEST_URL = TRUSTED_APP_URL + "android-update.json";
    private static final String TRUSTED_SCHEME = "https";
    private static final String TRUSTED_HOST = "therealtwizzy.github.io";
    private static final String TRUSTED_PATH_PREFIX = "/whos-that-pokemon/";
    private static final String JS_BRIDGE_NAME = "PokeNativeAuth";
    private static final String NATIVE_AUTH_EVENT = "poke-native-auth-result";
    private static final String NATIVE_SIGN_OUT_EVENT = "poke-native-signout-result";
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String EXPECTED_RELEASE_CERT_SHA256 = "11b887d0063a66446a2fafa1cd21902ec5ddd56315d78f33741754743aed53d0";
    private static final int NETWORK_TIMEOUT_MS = 15000;
    private static final int INSTALL_UPDATE_REQUEST_CODE = 5005;

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
    private ExecutorService updateExecutor;
    private CancellationSignal authCancellationSignal;
    private TextView updateStatus;
    private Button updateActionButton;
    private UpdateInfo pendingUpdate;
    private File verifiedUpdateApk;
    private boolean nativeBridgeInjected = false;
    private boolean updateRequired = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        hideSystemUi();

        credentialManager = CredentialManager.create(this);
        firebaseAuth = FirebaseAuth.getInstance();
        authExecutor = Executors.newSingleThreadExecutor();
        updateExecutor = Executors.newSingleThreadExecutor();

        webView = createTrustedWebView();
        showUpdateScreen("Checking for APK updates...");
        checkForUpdatesThenBoot();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == INSTALL_UPDATE_REQUEST_CODE && updateRequired && resultCode != RESULT_OK) {
            showInstallNotCompletedFallback();
        }
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
        if (updateRequired) return;
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
        if (updateExecutor != null) {
            updateExecutor.shutdownNow();
            updateExecutor = null;
        }
        if (webView != null) {
            removeNativeBridge();
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }

    private WebView createTrustedWebView() {
        WebView trustedWebView = new WebView(this);
        trustedWebView.setWebViewClient(new TrustedWebViewClient());
        trustedWebView.setOnSystemUiVisibilityChangeListener(new View.OnSystemUiVisibilityChangeListener() {
            @Override
            public void onSystemUiVisibilityChange(int visibility) {
                hideSystemUi();
            }
        });

        WebSettings settings = trustedWebView.getSettings();
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

        return trustedWebView;
    }

    private void showUpdateScreen(String message) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(40, 40, 40, 40);
        layout.setBackgroundColor(Color.rgb(14, 18, 22));

        TextView title = new TextView(this);
        title.setText("PokeOS Update");
        title.setTextColor(Color.rgb(151, 255, 171));
        title.setTextSize(24);
        title.setGravity(Gravity.CENTER);

        updateStatus = new TextView(this);
        updateStatus.setText(message);
        updateStatus.setTextColor(Color.rgb(218, 246, 224));
        updateStatus.setTextSize(16);
        updateStatus.setGravity(Gravity.CENTER);
        updateStatus.setPadding(0, 24, 0, 24);

        updateActionButton = new Button(this);
        updateActionButton.setText("Retry");
        updateActionButton.setEnabled(false);
        updateActionButton.setAllCaps(false);
        updateActionButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                checkForUpdatesThenBoot();
            }
        });

        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        layout.addView(title, titleParams);
        layout.addView(updateStatus, statusParams);
        layout.addView(updateActionButton, buttonParams);

        setContentView(layout);
        hideSystemUi();
    }

    private void checkForUpdatesThenBoot() {
        if (updateExecutor == null) return;

        updateRequired = false;
        pendingUpdate = null;
        verifiedUpdateApk = null;
        setUpdateStatus("Checking for APK updates...");
        configureUpdateAction("Retry", false, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                checkForUpdatesThenBoot();
            }
        });

        updateExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    UpdateInfo updateInfo = fetchUpdateInfo();
                    if (isRequiredUpdate(updateInfo)) {
                        mainExecutor.execute(new Runnable() {
                            @Override
                            public void run() {
                                showRequiredUpdate(updateInfo);
                            }
                        });
                        return;
                    }

                    mainExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            loadTrustedWebView();
                        }
                    });
                } catch (Exception error) {
                    mainExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            showUpdateCheckFailure(error);
                        }
                    });
                }
            }
        });
    }

    private void loadTrustedWebView() {
        if (webView == null) return;
        updateRequired = false;
        setContentView(webView);
        updateNativeBridgeForUrl(TRUSTED_APP_URL);
        webView.loadUrl(TRUSTED_APP_URL);
    }

    private void showRequiredUpdate(UpdateInfo updateInfo) {
        updateRequired = true;
        pendingUpdate = updateInfo;
        setUpdateStatus(
            "Android app update required.\n" +
            "Current APK: v" + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")\n" +
            "Latest APK: v" + updateInfo.versionName + " (" + updateInfo.versionCode + ")\n" +
            "Downloading update..."
        );
        configureUpdateAction("Downloading...", false, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                downloadAndInstallUpdate(updateInfo);
            }
        });
        downloadAndInstallUpdate(updateInfo);
    }

    private void downloadAndInstallUpdate(UpdateInfo updateInfo) {
        if (updateExecutor == null) return;

        pendingUpdate = updateInfo;
        setUpdateStatus("Downloading APK v" + updateInfo.versionName + "...");
        configureUpdateAction("Downloading...", false, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                downloadAndInstallUpdate(updateInfo);
            }
        });

        updateExecutor.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    File apkFile = downloadVerifiedApk(updateInfo);
                    mainExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            verifiedUpdateApk = apkFile;
                            setUpdateStatus("Update verified. Android will ask you to approve the install.");
                            configureUpdateAction("Install Update", true, new View.OnClickListener() {
                                @Override
                                public void onClick(View view) {
                                    launchInstallerForVerifiedUpdate();
                                }
                            });
                            launchInstallerForVerifiedUpdate();
                        }
                    });
                } catch (Exception error) {
                    mainExecutor.execute(new Runnable() {
                        @Override
                        public void run() {
                            showUpdateDownloadFailure(error);
                        }
                    });
                }
            }
        });
    }

    private void showUpdateCheckFailure(Exception error) {
        updateRequired = true;
        setUpdateStatus("Update check failed. Connect to the internet and retry.\n" + cleanErrorMessage(error));
        configureUpdateAction("Retry", true, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                checkForUpdatesThenBoot();
            }
        });
    }

    private void showUpdateDownloadFailure(Exception error) {
        updateRequired = true;
        String versionName = pendingUpdate != null ? pendingUpdate.versionName : "latest";
        setUpdateStatus("Could not install APK v" + versionName + ".\n" + cleanErrorMessage(error));
        configureUpdateAction("Retry Update", true, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                if (pendingUpdate != null) {
                    downloadAndInstallUpdate(pendingUpdate);
                } else {
                    checkForUpdatesThenBoot();
                }
            }
        });
    }

    private void launchInstallerForVerifiedUpdate() {
        if (verifiedUpdateApk == null || !verifiedUpdateApk.exists()) {
            if (pendingUpdate != null) {
                downloadAndInstallUpdate(pendingUpdate);
            } else {
                checkForUpdatesThenBoot();
            }
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !getPackageManager().canRequestPackageInstalls()) {
            setUpdateStatus("Allow installs from this app, then return and tap Install Update.");
            configureUpdateAction("Install Update", true, new View.OnClickListener() {
                @Override
                public void onClick(View view) {
                    launchInstallerForVerifiedUpdate();
                }
            });
            Intent settingsIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())
            );
            startActivity(settingsIntent);
            return;
        }

        try {
            Uri apkUri = FileProvider.getUriForFile(
                this,
                getPackageName() + ".apkprovider",
                verifiedUpdateApk
            );
            Intent installIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            installIntent.setDataAndType(apkUri, APK_MIME_TYPE);
            installIntent.setClipData(ClipData.newUri(getContentResolver(), "PokeOS update", apkUri));
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
            setUpdateStatus("Install prompt opened. Approve the Android update to continue.");
            startActivityForResult(installIntent, INSTALL_UPDATE_REQUEST_CODE);
        } catch (ActivityNotFoundException error) {
            showUpdateDownloadFailure(error);
        } catch (RuntimeException error) {
            showUpdateDownloadFailure(error);
        }
    }

    private void showInstallNotCompletedFallback() {
        updateRequired = true;
        setUpdateStatus(
            "If Android says App not installed, uninstall the old APK first. " +
            "Then redownload and reinstall the latest APK from the site to prevent PokeOS version-mismatch. " +
            "Current APK: v" + BuildConfig.VERSION_NAME + "."
        );
        configureUpdateAction("Open App Settings", true, new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                openThisAppSettings();
            }
        });
    }

    private void openThisAppSettings() {
        Intent settingsIntent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getPackageName())
        );
        startActivity(settingsIntent);
    }

    private void setUpdateStatus(String message) {
        if (updateStatus != null) {
            updateStatus.setText(message);
        }
    }

    private void configureUpdateAction(String label, boolean enabled, View.OnClickListener listener) {
        if (updateActionButton == null) return;
        updateActionButton.setText(label);
        updateActionButton.setEnabled(enabled);
        updateActionButton.setVisibility(View.VISIBLE);
        updateActionButton.setOnClickListener(listener);
    }

    private UpdateInfo fetchUpdateInfo() throws IOException, JSONException {
        String response = fetchString(UPDATE_MANIFEST_URL);
        UpdateInfo updateInfo = UpdateInfo.fromJson(new JSONObject(response));

        if (!getPackageName().equals(updateInfo.packageName)) {
            throw new IOException("Update manifest package does not match this app.");
        }
        if (updateInfo.versionCode <= 0 || updateInfo.minimumVersionCode <= 0) {
            throw new IOException("Update manifest version is invalid.");
        }
        if (!isTrustedAppUrl(updateInfo.apkUrl)) {
            throw new IOException("Update APK URL is not trusted.");
        }
        if (!updateInfo.sha256.matches("[a-f0-9]{64}")) {
            throw new IOException("Update APK SHA-256 is invalid.");
        }

        return updateInfo;
    }

    private boolean isRequiredUpdate(UpdateInfo updateInfo) {
        if (BuildConfig.VERSION_CODE < updateInfo.minimumVersionCode) return true;
        return updateInfo.required && BuildConfig.VERSION_CODE < updateInfo.versionCode;
    }

    private String fetchString(String urlString) throws IOException {
        if (!isTrustedAppUrl(urlString)) {
            throw new IOException("Update manifest URL is not trusted.");
        }

        HttpURLConnection connection = openConnection(urlString);
        try {
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("Update manifest returned HTTP " + code + ".");
            }

            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                copy(input, output, null);
                return output.toString("UTF-8");
            }
        } finally {
            connection.disconnect();
        }
    }

    private File downloadVerifiedApk(UpdateInfo updateInfo) throws IOException {
        if (!isTrustedAppUrl(updateInfo.apkUrl)) {
            throw new IOException("Update APK URL is not trusted.");
        }

        File updateDir = new File(getCacheDir(), "updates");
        if (!updateDir.exists() && !updateDir.mkdirs()) {
            throw new IOException("Could not create update cache.");
        }
        File apkFile = new File(updateDir, getUpdateApkFileName(updateInfo));
        if (apkFile.exists() && !apkFile.delete()) {
            throw new IOException("Could not replace stale update APK.");
        }

        MessageDigest digest = createSha256Digest();
        HttpURLConnection connection = openConnection(updateInfo.apkUrl);
        try {
            int code = connection.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IOException("Update APK returned HTTP " + code + ".");
            }

            try (InputStream input = connection.getInputStream();
                 OutputStream output = new FileOutputStream(apkFile)) {
                copy(input, output, digest);
            }
        } finally {
            connection.disconnect();
        }

        String actualSha256 = toHex(digest.digest());
        if (!actualSha256.equals(updateInfo.sha256)) {
            if (apkFile.exists()) apkFile.delete();
            throw new IOException("Update APK SHA-256 did not match.");
        }
        verifyDownloadedApk(updateInfo, apkFile);

        return apkFile;
    }

    private void verifyDownloadedApk(UpdateInfo updateInfo, File apkFile) throws IOException {
        PackageInfo packageInfo = readApkPackageInfo(apkFile);
        if (packageInfo == null) {
            throw new IOException("Update APK package metadata could not be read.");
        }
        if (!getPackageName().equals(packageInfo.packageName)) {
            throw new IOException("Update APK package does not match this app.");
        }
        long downloadedVersionCode = getPackageVersionCode(packageInfo);
        if (downloadedVersionCode != updateInfo.versionCode) {
            throw new IOException("Update APK version does not match the manifest.");
        }
        if (downloadedVersionCode <= BuildConfig.VERSION_CODE) {
            throw new IOException("Update APK is not newer than this app.");
        }
        if (!hasExpectedSigningCertificate(packageInfo)) {
            throw new IOException("Update APK signing certificate is not trusted.");
        }
    }

    private PackageInfo readApkPackageInfo(File apkFile) {
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo packageInfo = getPackageManager().getPackageArchiveInfo(apkFile.getAbsolutePath(), flags);
        if (packageInfo != null && packageInfo.applicationInfo != null) {
            packageInfo.applicationInfo.sourceDir = apkFile.getAbsolutePath();
            packageInfo.applicationInfo.publicSourceDir = apkFile.getAbsolutePath();
        }
        return packageInfo;
    }

    private long getPackageVersionCode(PackageInfo packageInfo) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return packageInfo.getLongVersionCode();
        }
        return packageInfo.versionCode;
    }

    private boolean hasExpectedSigningCertificate(PackageInfo packageInfo) throws IOException {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (packageInfo.signingInfo == null) return false;
            signatures = packageInfo.signingInfo.hasMultipleSigners()
                ? packageInfo.signingInfo.getApkContentsSigners()
                : packageInfo.signingInfo.getSigningCertificateHistory();
        } else {
            signatures = packageInfo.signatures;
        }
        if (signatures == null) return false;

        for (Signature signature : signatures) {
            if (signature == null) continue;
            String certSha256 = toHex(createSha256Digest().digest(signature.toByteArray()));
            if (EXPECTED_RELEASE_CERT_SHA256.equals(certSha256)) return true;
        }
        return false;
    }

    private HttpURLConnection openConnection(String urlString) throws IOException {
        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(NETWORK_TIMEOUT_MS);
        connection.setReadTimeout(NETWORK_TIMEOUT_MS);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json, application/vnd.android.package-archive, */*");
        return connection;
    }

    private static void copy(InputStream input, OutputStream output, MessageDigest digest) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (digest != null) digest.update(buffer, 0, read);
            output.write(buffer, 0, read);
        }
    }

    private static MessageDigest createSha256Digest() throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IOException("SHA-256 verification is unavailable.", error);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format(Locale.US, "%02x", value & 0xff));
        }
        return builder.toString();
    }

    private static String cleanErrorMessage(Exception error) {
        String message = error != null ? error.getMessage() : "";
        if (message == null || message.trim().isEmpty()) return "Unknown update error.";
        return message.trim();
    }

    private static String getUpdateApkFileName(UpdateInfo updateInfo) {
        String cleanVersionName = updateInfo.versionName.replaceAll("[^A-Za-z0-9._-]", "-");
        if (cleanVersionName.length() == 0) {
            cleanVersionName = String.valueOf(updateInfo.versionCode);
        }
        return "whos-that-pokemon-v" + cleanVersionName + ".apk";
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
        if (updateRequired) {
            postNativeAuthError(requestId, "auth/native-login-unavailable", "Android app update required.");
            return;
        }
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

    private void signOutNative(String requestId) {
        if (firebaseAuth != null) {
            firebaseAuth.signOut();
        }

        if (credentialManager == null || authExecutor == null) {
            postNativeSignOutResult(requestId, "", "");
            return;
        }
        credentialManager.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            new CancellationSignal(),
            authExecutor,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) {
                    postNativeSignOutResult(requestId, "", "");
                }

                @Override
                public void onError(ClearCredentialException error) {
                    postNativeSignOutResult(requestId, "auth/native-sign-out-unavailable", error.getMessage());
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

    private void postNativeSignOutResult(String requestId, String code, String message) {
        String script = "(function(){window.dispatchEvent(new CustomEvent(" +
            json(NATIVE_SIGN_OUT_EVENT) +
            ",{detail:{requestId:" + json(requestId) +
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
        public void signOut(String requestId) {
            String safeRequestId = cleanRequestId(requestId);
            mainExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    signOutNative(safeRequestId);
                }
            });
        }

        @JavascriptInterface
        public String getVersionInfo() {
            JSONObject info = new JSONObject();
            try {
                info.put("packageName", getPackageName());
                info.put("versionCode", BuildConfig.VERSION_CODE);
                info.put("versionName", BuildConfig.VERSION_NAME);
                info.put("updateCapable", true);
            } catch (JSONException ignored) {
                return "{}";
            }
            return info.toString();
        }
    }

    private static final class UpdateInfo {
        final String packageName;
        final int versionCode;
        final String versionName;
        final int minimumVersionCode;
        final boolean required;
        final String apkUrl;
        final String sha256;

        private UpdateInfo(
            String packageName,
            int versionCode,
            String versionName,
            int minimumVersionCode,
            boolean required,
            String apkUrl,
            String sha256
        ) {
            this.packageName = packageName;
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.minimumVersionCode = minimumVersionCode;
            this.required = required;
            this.apkUrl = apkUrl;
            this.sha256 = sha256;
        }

        static UpdateInfo fromJson(JSONObject object) {
            int versionCode = object.optInt("versionCode", 0);
            return new UpdateInfo(
                object.optString("packageName", ""),
                versionCode,
                object.optString("versionName", String.valueOf(versionCode)),
                object.optInt("minimumVersionCode", object.optInt("minVersionCode", versionCode)),
                object.optBoolean("required", false),
                object.optString("apkUrl", ""),
                object.optString("sha256", "").trim().toLowerCase(Locale.US)
            );
        }
    }
}
