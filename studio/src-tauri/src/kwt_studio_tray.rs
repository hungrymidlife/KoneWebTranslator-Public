// KWT_STUDIO_TRAY_V1: Native Tauri 2 Windows system tray and hidden-window GUI lease.
// Only Studio-owned loopback Bridge is contacted; no external network or new Rust crates.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, State, WebviewWindow};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

#[derive(Default)]
pub(crate) struct KwtTrayLease(Arc<Mutex<Option<String>>>);

// Bridge stops Studio-owned AI services when its last GUI lease is stale (>45s).
// Hidden WebView2 windows may throttle JS timers, so refresh only the existing
// GUI session from native Rust while the Studio window is actually hidden.
fn notify_bridge(session_id: &str, action: &str) {
    let address = SocketAddr::from(([127, 0, 0, 1], 18765));
    if let Ok(mut socket) = TcpStream::connect_timeout(&address, Duration::from_secs(1)) {
        let _ = socket.set_write_timeout(Some(Duration::from_secs(1)));
        let body = format!(r#"{{"action":"{action}","session_id":"{session_id}"}}"#);
        let request = format!(
            "POST /api/manager/gui-session HTTP/1.1\r\nHost: 127.0.0.1:18765\r\nContent-Type: application/json\r\nX-KWT-Studio: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        if socket.write_all(request.as_bytes()).is_ok() {
            // Read the response header so the Bridge can finish normally instead
            // of repeatedly writing to a socket already closed by the client.
            let _ = socket.set_read_timeout(Some(Duration::from_secs(1)));
            let mut header = [0u8; 128];
            let _ = socket.read(&mut header);
        }
    }
}

#[tauri::command]
pub(crate) fn kwt_hide_to_tray(
    window: WebviewWindow,
    lease: State<'_, KwtTrayLease>,
    session_id: String,
) -> Result<(), String> {
    if !(12..=100).contains(&session_id.len())
        || !session_id.bytes().all(|ch| ch.is_ascii_alphanumeric() || ch == b'-')
        || !session_id.starts_with("desktop-")
    {
        return Err("잘못된 Studio GUI 세션입니다.".into());
    }
    // Important: hide(), not close() or destroy(). Keep React state and in-flight jobs.
    window.hide().map_err(|err| format!("트레이로 이동하지 못했습니다: {err}"))?;
    *lease.0.lock().map_err(|_| "트레이 상태 잠금 오류")? = Some(session_id);
    Ok(())
}

fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.show().is_ok() {
            let _ = window.unminimize();
            let _ = window.set_focus();
            let lease = app.state::<KwtTrayLease>();
            if let Ok(mut id) = lease.0.lock() {
                *id = None; // normal React heartbeat resumes when the window is visible
            };
        }
    }
}

fn quit(app: &tauri::AppHandle) {
    // A hidden WebView2 window might not deliver JS onCloseRequested promptly.
    // Explicitly close the native GUI lease before requesting the normal close path.
    let lease = app.state::<KwtTrayLease>();
    if let Ok(mut active) = lease.0.lock() {
        if let Some(id) = active.take() {
            notify_bridge(&id, "close");
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        if window.close().is_err() {
            app.exit(0);
        }
    } else {
        app.exit(0);
    }
}

pub(crate) fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let lease = KwtTrayLease::default();
    let session = Arc::clone(&lease.0);
    app.manage(lease);

    // The native worker is independent of JS/WebView timer throttling.
    // Hold the mutex through each short local write to avoid re-touch after quit.
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(8));
        if let Ok(active) = session.lock() {
            if let Some(id) = active.as_deref() {
                notify_bridge(id, "touch");
            }
        }
    });

    let show = MenuItem::with_id(app, "kwt_tray_show", "Studio 열기", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "kwt_tray_quit", "완전 종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &exit])?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("KoneWebTranslator Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "kwt_tray_show" => restore(app),
            "kwt_tray_quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|icon, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => restore(icon.app_handle()),
            TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => restore(icon.app_handle()),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
