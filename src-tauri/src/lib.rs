use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<CommandChild>>);

fn stop_backend(app_handle: &tauri::AppHandle) {
    if let Some(child) = app_handle.state::<BackendProcess>().0.lock().unwrap().take() {
        let _ = child.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let project_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .expect("failed to resolve project root");
    let uvicorn_path = project_root.join("backend/.venv/bin/uvicorn");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(move |app| {
            let (_rx, child) = app
                .shell()
                .command(uvicorn_path.to_str().expect("invalid path"))
                .args(["backend.main:app", "--port", "8000"])
                // 強制終了などで下の終了処理が走らなくても、バックエンドが親の終了を検知して止まれるようにする
                .env("LOWORK_PARENT_PID", std::process::id().to_string())
                .current_dir(project_root.clone())
                .spawn()
                .expect("failed to start FastAPI backend");

            *app.state::<BackendProcess>().0.lock().unwrap() = Some(child);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Cmd+Qなど、ExitRequestedを通らずに終了する経路があるためExitでも止める
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                stop_backend(app_handle);
            }
        });
}
