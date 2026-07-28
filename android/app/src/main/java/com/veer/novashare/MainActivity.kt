package com.veer.novashare

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(NotifyDownloadPlugin::class.java)
        registerPlugin(InstalledAppsPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
