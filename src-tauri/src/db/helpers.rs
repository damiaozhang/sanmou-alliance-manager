use crate::error::AppResult;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn safe_path_component(value: &str) -> String {
        value
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .collect()
    }

pub(super) fn backup_path_for(target: &Path) -> PathBuf {
    let file_name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    target.with_file_name(format!("{file_name}.bak"))
}

pub(super) fn remove_entry(path: &Path) -> AppResult<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub(super) fn copy_dir_recursive(source: &Path, target: &Path) -> AppResult<u64> {
    let mut total_bytes = 0u64;
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            total_bytes += copy_dir_recursive(&source_path, &target_path)?;
        } else {
            fs::copy(&source_path, &target_path)?;
            total_bytes += entry.metadata()?.len();
        }
    }
    Ok(total_bytes)
}

pub(super) fn write_text_if_changed(path: &std::path::Path, contents: &str) -> AppResult<()> {
    let should_write = match fs::read_to_string(path) {
        Ok(existing) => existing != contents,
        Err(_) => true,
    };
    if should_write {
        fs::write(path, contents)?;
    }
    Ok(())
}

pub(super) fn parse_weekly_statistics(value: &str) -> Option<Value> {
    let parsed: Value = serde_json::from_str(value).ok()?;
    if let Some(current) = parsed
        .get("[number]1")
        .or_else(|| parsed.get("1"))
        .or_else(|| parsed.get("current"))
    {
        if current.is_object() {
            return Some(current.clone());
        }
    }
    if parsed.is_object() {
        Some(parsed)
    } else {
        None
    }
}

pub(super) fn sanitize_filename_component(value: &str) -> String {
    let mut cleaned = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control() {
            cleaned.push('_');
        } else {
            cleaned.push(ch);
        }
    }
    let trimmed = cleaned.trim_matches(|ch| matches!(ch, ' ' | '.' | '_'));
    if trimmed.is_empty() {
        "同盟".to_string()
    } else {
        trimmed.to_string()
    }
}
