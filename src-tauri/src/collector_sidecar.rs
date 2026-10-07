use crate::error::{AppError, AppResult};
use crate::models::{CollectorCapturePayload, CollectorCaptureResult, CollectorFlowStatus};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

const MANIFEST_SOURCE: &str = "embedded:collector/collector_manifest.json";
const MANIFEST_JSON: &str = include_str!("../../collector/collector_manifest.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRequest {
    #[serde(default)]
    request_id: Option<String>,
    command: String,
    #[serde(default)]
    payload: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    manifest_version: String,
    #[serde(default)]
    capture_flows: BTreeMap<String, FlowDefinition>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlowDefinition {
    #[serde(default)]
    flow: Option<String>,
    #[serde(default)]
    expected_artifacts: Vec<String>,
    #[serde(default)]
    navigation: Vec<String>,
    #[serde(default)]
    next_probe: Option<String>,
    #[serde(default)]
    preview: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    mode: String,
    supports: Vec<String>,
    ocr: bool,
    pdf: bool,
    manifest_version: String,
    manifest_source: String,
    capture_flows: BTreeMap<String, CollectorFlowStatus>,
}

pub fn run() -> AppResult<()> {
    let manifest: Manifest = serde_json::from_str(MANIFEST_JSON)?;
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = stdin.lock();
    let mut output = stdout.lock();

    emit(
        &mut output,
        SidecarEvent {
            kind: "hello".to_string(),
            status: Some("ready".to_string()),
            message: Some("collector sidecar online".to_string()),
            request_id: None,
            session_id: None,
            payload: None,
        },
    )?;

    let mut line = String::new();
    loop {
        line.clear();
        let bytes = input.read_line(&mut line)?;
        if bytes == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<SidecarRequest>(trimmed) {
            Ok(request) => match request.command.as_str() {
                "status" => handle_status(&manifest, request.request_id, &mut output)?,
                "start_capture" => handle_start_capture(
                    &manifest,
                    request.request_id,
                    request.payload,
                    &mut output,
                )?,
                "stop" => {
                    emit(
                        &mut output,
                        SidecarEvent {
                            kind: "stopped".to_string(),
                            request_id: request.request_id,
                            session_id: None,
                            status: Some("ok".to_string()),
                            message: Some("collector stopped".to_string()),
                            payload: None,
                        },
                    )?;
                    break;
                }
                other => {
                    emit(
                        &mut output,
                        SidecarEvent {
                            kind: "error".to_string(),
                            request_id: request.request_id,
                            session_id: None,
                            status: Some("error".to_string()),
                            message: Some(format!("unknown command: {other}")),
                            payload: None,
                        },
                    )?;
                }
            },
            Err(error) => {
                emit(
                    &mut output,
                    SidecarEvent {
                        kind: "error".to_string(),
                        request_id: None,
                        session_id: None,
                        status: Some("error".to_string()),
                        message: Some(error.to_string()),
                        payload: None,
                    },
                )?;
            }
        }
    }

    Ok(())
}

fn handle_status(
    manifest: &Manifest,
    request_id: Option<String>,
    output: &mut impl Write,
) -> AppResult<()> {
    emit(
        output,
        SidecarEvent {
            kind: "status".to_string(),
            request_id,
            session_id: None,
            status: Some("ready".to_string()),
            message: Some("collector sidecar preview is ready".to_string()),
            payload: Some(serde_json::to_value(StatusPayload {
                mode: "preview".to_string(),
                supports: vec![
                    "status".to_string(),
                    "start_capture".to_string(),
                    "stop".to_string(),
                ],
                ocr: false,
                pdf: false,
                manifest_version: manifest.manifest_version.clone(),
                manifest_source: MANIFEST_SOURCE.to_string(),
                capture_flows: manifest_capture_flows(manifest),
            })?),
        },
    )
}

fn handle_start_capture(
    manifest: &Manifest,
    request_id: Option<String>,
    payload: Option<Value>,
    output: &mut impl Write,
) -> AppResult<()> {
    let capture_type = resolve_capture_type(
        payload
            .as_ref()
            .and_then(|value| value.get("captureType"))
            .and_then(Value::as_str),
        manifest,
    )?;
    let definition = manifest
        .capture_flows
        .get(&capture_type)
        .ok_or_else(|| AppError::Message(format!("unknown capture flow: {capture_type}")))?;
    let session_id = next_session_id();
    let capture_payload = capture_payload(&capture_type, definition);
    let started_at = unix_timestamp_seconds()?;

    let mut started_payload = serde_json::to_value(&capture_payload)?;
    if let Value::Object(ref mut map) = started_payload {
        map.insert("startedAt".to_string(), json!(started_at));
    }

    emit(
        output,
        SidecarEvent {
            kind: "capture_started".to_string(),
            request_id: request_id.clone(),
            session_id: Some(session_id.clone()),
            status: Some("running".to_string()),
            message: Some(format!("preview capture started for {capture_type}")),
            payload: Some(started_payload),
        },
    )?;

    emit(
        output,
        SidecarEvent {
            kind: "capture_log".to_string(),
            request_id: request_id.clone(),
            session_id: Some(session_id.clone()),
            status: Some("info".to_string()),
            message: Some("real Frida/Lua hook integration is pending".to_string()),
            payload: Some(capture_log_payload(definition)),
        },
    )?;

    emit(
        output,
        SidecarEvent {
            kind: "capture_result".to_string(),
            request_id,
            session_id: Some(session_id),
            status: Some("completed".to_string()),
            message: Some(format!("preview capture completed for {capture_type}")),
            payload: Some(serde_json::to_value(CollectorCaptureResult {
                collector_mode: "preview".to_string(),
                capture_type,
                collector_payload: capture_payload,
            })?),
        },
    )
}

fn manifest_capture_flows(manifest: &Manifest) -> BTreeMap<String, CollectorFlowStatus> {
    manifest
        .capture_flows
        .iter()
        .map(|(capture_type, definition)| {
            (
                capture_type.clone(),
                CollectorFlowStatus {
                    flow: flow_text(definition, ""),
                    expected_artifacts: definition.expected_artifacts.clone(),
                    navigation: definition.navigation.clone(),
                    next_probe: definition.next_probe.as_ref().and_then(|value| {
                        if value.trim().is_empty() {
                            None
                        } else {
                            Some(value.clone())
                        }
                    }),
                    preview: definition.preview.as_ref().and_then(|value| {
                        if value.is_null() {
                            None
                        } else {
                            Some(value.clone())
                        }
                    }),
                },
            )
        })
        .collect()
}

fn capture_payload(capture_type: &str, definition: &FlowDefinition) -> CollectorCapturePayload {
    CollectorCapturePayload {
        collector_mode: "preview".to_string(),
        capture_type: capture_type.to_string(),
        flow: flow_text(definition, ""),
        expected_artifacts: definition.expected_artifacts.clone(),
        navigation: definition.navigation.clone(),
        next_probe: definition.next_probe.as_ref().and_then(|value| {
            if value.trim().is_empty() {
                None
            } else {
                Some(value.clone())
            }
        }),
        preview: definition.preview.as_ref().and_then(|value| {
            if value.is_null() {
                None
            } else {
                Some(value.clone())
            }
        }),
        runtime: None,
        evidence: None,
    }
}

fn capture_log_payload(definition: &FlowDefinition) -> Value {
    let next_probe = definition.next_probe.as_ref().and_then(|value| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value.clone())
        }
    });
    match next_probe {
        Some(next_probe) => json!({ "nextProbe": next_probe }),
        None => json!({}),
    }
}

fn resolve_capture_type(requested: Option<&str>, manifest: &Manifest) -> AppResult<String> {
    // An explicitly requested but unknown capture type is an error — never
    // silently fall back to a default, which would run the wrong flow.
    if let Some(requested) = requested {
        let trimmed = requested.trim();
        if !trimmed.is_empty() {
            if manifest.capture_flows.contains_key(trimmed) {
                return Ok(trimmed.to_string());
            }
            return Err(AppError::Message(format!(
                "unknown capture type: {trimmed}"
            )));
        }
    }

    if manifest.capture_flows.contains_key("alliance_data") {
        return Ok("alliance_data".to_string());
    }
    if manifest.capture_flows.contains_key("battle_passive") {
        return Ok("battle_passive".to_string());
    }

    Err(AppError::Message(
        "collector manifest does not define a supported capture flow".to_string(),
    ))
}

fn flow_text(definition: &FlowDefinition, fallback: &str) -> String {
    definition
        .flow
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

fn next_session_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("preview-{millis}-{counter}")
}

fn unix_timestamp_seconds() -> AppResult<f64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Message(error.to_string()))?
        .as_secs_f64())
}

fn emit(output: &mut impl Write, event: SidecarEvent) -> AppResult<()> {
    serde_json::to_writer(&mut *output, &event)?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{resolve_capture_type, Manifest};

    fn test_manifest() -> Manifest {
        serde_json::from_str(super::MANIFEST_JSON).expect("embedded manifest parses")
    }

    #[test]
    fn unknown_requested_capture_type_is_an_error() {
        let manifest = test_manifest();
        let error = resolve_capture_type(Some("definitely_not_a_flow"), &manifest)
            .expect_err("unknown capture type must fail");
        assert!(error
            .to_string()
            .contains("definitely_not_a_flow"));
    }

    #[test]
    fn known_requested_capture_type_is_accepted() {
        let manifest = test_manifest();
        assert_eq!(
            resolve_capture_type(Some("alliance_data"), &manifest).expect("known flow"),
            "alliance_data"
        );
        assert_eq!(
            resolve_capture_type(Some("battle_passive"), &manifest).expect("known flow"),
            "battle_passive"
        );
    }

    #[test]
    fn missing_request_falls_back_to_default() {
        let manifest = test_manifest();
        assert_eq!(
            resolve_capture_type(None, &manifest).expect("default flow"),
            "alliance_data"
        );
        assert_eq!(
            resolve_capture_type(Some("  "), &manifest).expect("blank falls back"),
            "alliance_data"
        );
    }
}
