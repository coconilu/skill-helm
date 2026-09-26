#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Skill Helm 桌面壳：启动时拉起 `skill-helm serve` sidecar（仅回环），
//! 从 stdout 读取 API origin 并通过 api_origin 命令提供给前端；退出时按进程树清理 sidecar。

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

struct ApiOrigin(Mutex<String>);

#[tauri::command]
fn api_origin(state: tauri::State<ApiOrigin>) -> String {
    state.0.lock().unwrap().clone()
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 统一配置 sidecar 子进程：静默后台、接管 stdout、Windows 上不弹控制台窗口。
fn configure(cmd: &mut Command) {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

/// 读取 sidecar stdout 首行的 `SKILL_HELM_API <origin>`。
fn read_origin(mut child: Child) -> (Child, String) {
    let stdout = child.stdout.take().expect("sidecar stdout 不可用");
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut origin = String::new();
    let _ = reader.read_line(&mut line);
    if let Some(rest) = line.trim().strip_prefix("SKILL_HELM_API ") {
        origin = rest.to_string();
    }
    (child, origin)
}

/// sidecar 解析顺序：优先环境变量 SKILL_HELM_CLI 显式指定入口（`.js` 用 node 前缀执行，
/// 其余按可执行文件），未设置或启动失败再回退 PATH 解析 `skill-helm`；两者都失败时
/// 给出两种修复方式。显式入口用于防止全局 link 指向旧 checkout 的过期 dist。
fn spawn_sidecar() -> (Child, String) {
    if let Ok(cli) = std::env::var("SKILL_HELM_CLI") {
        let cli = cli.trim().to_string();
        if !cli.is_empty() {
            let mut cmd = if cli.to_ascii_lowercase().ends_with(".js") {
                let mut c = Command::new("node");
                c.arg(&cli);
                c
            } else {
                Command::new(&cli)
            };
            cmd.arg("serve");
            configure(&mut cmd);
            if let Ok(child) = cmd.spawn() {
                return read_origin(child);
            }
            // 显式入口起不来：继续尝试 PATH 兜底
        }
    }

    let mut cmd = Command::new("cmd");
    cmd.args(["/c", "skill-helm", "serve"]);
    configure(&mut cmd);
    if let Ok(child) = cmd.spawn() {
        return read_origin(child);
    }

    panic!(
        "无法启动 sidecar：SKILL_HELM_CLI（未设置或指向的入口不可执行）与 PATH 中的 skill-helm 均解析失败。\
         修复方式二选一：① 设置环境变量 SKILL_HELM_CLI 指向本仓库 packages/cli/dist/cli.js；\
         ② 运行 pnpm --dir packages/cli link --global 后重启应用"
    );
}

fn kill_process_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd.output();
}

fn main() {
    let (child, origin) = spawn_sidecar();
    let pid = child.id();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ApiOrigin(Mutex::new(origin)))
        .invoke_handler(tauri::generate_handler![api_origin])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(move |_handle, event| {
        if let tauri::RunEvent::Exit = event {
            kill_process_tree(pid);
        }
    });
}
