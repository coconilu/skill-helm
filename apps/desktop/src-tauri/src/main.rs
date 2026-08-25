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

fn spawn_sidecar() -> (Child, String) {
    let mut cmd = Command::new("cmd");
    cmd.args(["/c", "skill-helm", "serve"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .expect("无法启动 sidecar：请确认 skill-helm 已在 PATH 中（pnpm --dir packages/cli link --global）");
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
