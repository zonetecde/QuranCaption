use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartFfmpegRequest {
    pub(crate) arguments: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartFfmpegResponse {
    pub(crate) session_id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteFfprobeRequest {
    pub(crate) arguments: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExecuteFfprobeResponse {
    pub(crate) success: bool,
    pub(crate) output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FfmpegSessionRequest {
    pub(crate) session_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelFfmpegResponse {
    pub(crate) cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishFileRequest {
    pub(crate) source_path: String,
    pub(crate) destination_uri: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PublishFileResponse {
    pub(crate) uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenUriRequest {
    pub(crate) uri: String,
    pub(crate) mime_type: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenUriResponse {
    pub(crate) opened: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportUriRequest {
    pub(crate) uri: String,
    pub(crate) destination_dir: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ImportUriResponse {
    pub(crate) path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct KeepScreenOnRequest {
    pub(crate) enabled: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct KeepScreenOnResponse {
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegSessionSnapshot {
    pub session_id: i64,
    pub state: String,
    pub return_code: Option<i32>,
    pub output: String,
    pub failure_stack_trace: String,
    pub time_ms: f64,
}
