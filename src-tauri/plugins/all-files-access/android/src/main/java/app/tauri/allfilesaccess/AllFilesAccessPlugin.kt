package app.tauri.allfilesaccess

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin(
  permissions = [
    Permission(strings = [android.Manifest.permission.MANAGE_EXTERNAL_STORAGE], alias = "manageStorage")
  ]
)
class AllFilesAccessPlugin(private val activity: Activity) : Plugin(activity) {

  /**
   * 是否已拥有全盘文件访问能力。
   * API 30+ 看 isExternalStorageManager；以下看 WRITE_EXTERNAL_STORAGE 授权。
   */
  @Command
  fun check(invoke: Invoke) {
    val result = JSObject()
    result.put("granted", isGranted())
    result.put("apiLevel", Build.VERSION.SDK_INT)
    invoke.resolve(result)
  }

  /**
   * 跳系统设置页让用户手动开启（MANAGE 权限无弹窗申请，只能走设置）。
   * API 30+ 直达本应用的"所有文件访问"页；以下打开应用详情页。
   */
  @Command
  fun settings(invoke: Invoke) {
    try {
      val action = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION
      } else {
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS
      }
      val intent = Intent(action, Uri.parse("package:${activity.packageName}"))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "open settings failed")
    }
  }

  private fun isGranted(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
        PackageManager.PERMISSION_GRANTED
    }
  }
}
