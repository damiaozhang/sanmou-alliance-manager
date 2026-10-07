use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::process::Stdio;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Hide the console window of a spawned subprocess (no-op on non-Windows).
pub(crate) fn hide_subprocess_window(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

/// Force-kill a process and its child tree (no-op on non-Windows).
pub(crate) fn kill_process_tree(child_id: u32) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        hide_subprocess_window(&mut command);
        let _ = command
            .args(["/PID", &child_id.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child_id;
    }
}
