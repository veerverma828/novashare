package com.veer.novashare;

import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// Writes received file bytes straight into the real, system Downloads folder
// (MediaStore.Downloads on API 29+, Environment.DIRECTORY_DOWNLOADS below that)
// instead of the app's Documents sandbox, and registers the result with
// DownloadManager so Android shows the standard "Download complete"
// notification and the file appears in the system Downloads app.
@CapacitorPlugin(name = "NotifyDownload")
public class NotifyDownloadPlugin extends Plugin {

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        String fileName = call.getString("fileName");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String base64Data = call.getString("data");

        if (fileName == null || base64Data == null) {
            call.reject("fileName and data are required");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            Context context = getContext();
            long length = bytes.length;
            Uri fileUri;
            String legacyPath = null;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = context.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                Uri itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (itemUri == null) {
                    call.reject("Could not create entry in Downloads");
                    return;
                }

                try (OutputStream out = resolver.openOutputStream(itemUri)) {
                    out.write(bytes);
                }

                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(itemUri, values, null, null);

                fileUri = itemUri;
            } else {
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) downloadsDir.mkdirs();
                File file = new File(downloadsDir, fileName);

                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(bytes);
                }

                MediaScannerConnection.scanFile(context, new String[]{file.getAbsolutePath()}, null, null);
                fileUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
                legacyPath = file.getAbsolutePath();
            }

            // The 9-arg overload's "uri" param is the originating HTTP/HTTPS source
            // URL, not the local file location — passing our content:// media Uri
            // there throws "Can only download HTTP/HTTPS URIs". There's no real
            // download URL here, so use the plain path-based overload instead; the
            // MediaStore write above still lands at this same real filesystem path.
            String notificationPath = legacyPath != null
                ? legacyPath
                : new File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    fileName
                ).getAbsolutePath();

            DownloadManager downloadManager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            downloadManager.addCompletedDownload(
                fileName, "Received via NovaShare", true, mimeType, notificationPath, length, true
            );

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("uri", fileUri.toString());
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to save to Downloads: " + e.getMessage(), e);
        }
    }
}
