//! Loopback redirect listener for OAuth (Google Drive).
//!
//! The frontend calls `oauth_listen`, gets back a port, opens the consent
//! page in the system browser with `redirect_uri=http://127.0.0.1:<port>`,
//! and waits for the `oauth-redirect` event carrying the full callback URL.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const DONE_PAGE: &str = "<!doctype html><html><body style=\"background:#0c0c0e;color:#f2f1ee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\"><div><div style=\"width:14px;height:14px;background:#ff5a1f;display:inline-block;margin-right:8px\"></div><b>Tone Suites</b> is connected. You can close this tab.</div></body></html>";

#[tauri::command]
pub fn oauth_listen(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        // Browsers may probe (favicon etc.); accept a few connections until one has a query.
        for _ in 0..8 {
            let Ok((mut stream, _)) = listener.accept() else { break };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let path = req
                .lines()
                .next()
                .and_then(|l| l.split_whitespace().nth(1))
                .unwrap_or("/")
                .to_string();
            let body = DONE_PAGE;
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
            if path.contains("code=") || path.contains("error=") {
                let _ = app.emit("oauth-redirect", format!("http://127.0.0.1:{port}{path}"));
                break;
            }
        }
    });
    Ok(port)
}
