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
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadYoutubeRequest {
    pub(crate) url: String,
    pub(crate) download_type: String,
    pub(crate) download_path: String,
    pub(crate) download_request_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct StartYoutubeDownloadResponse {
    pub(crate) started: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct YoutubeDownloadSessionRequest {
    pub(crate) download_request_id: String,
}

#[derive(Debug, Deserialize)]
pub struct YoutubeDownloadSessionSnapshot {
    pub state: String,
    pub progress: f64,
    pub path: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct KeepScreenOnRequest {
    pub(crate) enabled: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct KeepScreenOnResponse {
    pub(crate) enabled: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct SecureValueRequest {
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SecureKeyRequest {
    pub(crate) key: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SecureValueResponse {
    pub(crate) value: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SecureOperationResponse {
    pub(crate) success: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartExportServiceRequest {
    pub(crate) export_id: String,
    pub(crate) file_name: String,
    pub(crate) state: String,
    pub(crate) state_labels: String,
    pub(crate) capturing_hint: String,
    pub(crate) background_hint: String,
    pub(crate) completion_hint: String,
    pub(crate) cancel_label: String,
    pub(crate) cancelling_label: String,
    pub(crate) channel_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateExportServiceRequest {
    pub(crate) export_id: String,
    pub(crate) state: String,
    pub(crate) progress: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportServiceRequest {
    pub(crate) export_id: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct StartExportServiceResponse {
    pub(crate) started: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateExportServiceResponse {
    pub(crate) cancelled: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BackgroundReadyResponse {
    pub(crate) ready: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct StopExportServiceResponse {
    pub(crate) stopped: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ExportCancellationResponse {
    pub(crate) cancelled: bool,
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
