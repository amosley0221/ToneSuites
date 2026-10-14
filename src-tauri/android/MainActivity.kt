// Copied over the generated MainActivity by the release workflow (after `tauri android init`).
//
// Android 15+ draws apps edge-to-edge, so the web view sits under the status bar, the display
// cutout and the gesture bar. Android WebView doesn't reliably expose those sizes to CSS, so we
// pass them in: `window.ToneInsets.get()` returns the insets in CSS pixels, and a `tone-insets`
// event fires whenever they change (rotation, folding / unfolding, keyboard).
package com.amosley.tonesuites

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  @Volatile private var insetsJson = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  inner class ToneInsets {
    @JavascriptInterface fun get(): String = insetsJson

    /** Status/navigation bar icons: dark icons on a light theme, light icons on a dark theme. */
    @JavascriptInterface fun setLightBars(light: Boolean) {
      runOnUiThread {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        c.isAppearanceLightStatusBars = light
        c.isAppearanceLightNavigationBars = light
      }
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { v, insets ->
      val i = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val d = resources.displayMetrics.density
      insetsJson = "{\"top\":${i.top / d},\"right\":${i.right / d},\"bottom\":${i.bottom / d},\"left\":${i.left / d}}"
      webView?.evaluateJavascript("window.dispatchEvent(new Event('tone-insets'))", null)
      ViewCompat.onApplyWindowInsets(v, insets)
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(ToneInsets(), "ToneInsets")
    ViewCompat.requestApplyInsets(window.decorView)
  }
}
