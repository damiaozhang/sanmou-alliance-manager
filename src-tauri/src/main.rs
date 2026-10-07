#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--collector-sidecar") {
        if let Err(error) = sanmou_alliance_manager_lib::run_collector_sidecar() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    sanmou_alliance_manager_lib::run();
}
