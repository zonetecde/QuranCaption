use lazy_static::lazy_static;
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::BufReader,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::mpsc::{self, Receiver, Sender},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviewAudioAction {
    Load,
    Play,
    Pause,
    Seek,
    SetVolume,
    SetSpeed,
    Status,
    Unload,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAudioStatus {
    loaded: bool,
    playing: bool,
    ended: bool,
    position_ms: f64,
    duration_ms: f64,
    speed: f32,
}

struct PreviewAudioRequest {
    action: PreviewAudioAction,
    file_path: Option<String>,
    position_ms: Option<f64>,
    volume: Option<f32>,
    speed: Option<f32>,
    response: Sender<Result<PreviewAudioStatus, String>>,
}

struct PreviewAudioService {
    sender: Sender<PreviewAudioRequest>,
}

impl PreviewAudioService {
    /// Crée le thread qui conserve le périphérique et le lecteur audio natif.
    fn new() -> Self {
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || run_preview_audio_thread(receiver));
        Self { sender }
    }

    /// Envoie une commande au thread audio et attend son état résultant.
    fn request(
        &self,
        action: PreviewAudioAction,
        file_path: Option<String>,
        position_ms: Option<f64>,
        volume: Option<f32>,
        speed: Option<f32>,
    ) -> Result<PreviewAudioStatus, String> {
        let (response, receiver) = mpsc::channel();
        self.sender
            .send(PreviewAudioRequest {
                action,
                file_path,
                position_ms,
                volume,
                speed,
                response,
            })
            .map_err(|error| error.to_string())?;
        receiver.recv().map_err(|error| error.to_string())?
    }
}

struct PreviewAudioRuntime {
    _output_stream: Option<OutputStream>,
    output_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    loaded_path: Option<String>,
    position_ms: f64,
    duration_ms: f64,
    speed: f32,
    started_at: Option<Instant>,
}

impl PreviewAudioRuntime {
    /// Crée un lecteur vide dont le périphérique sera ouvert au premier chargement.
    fn new() -> Self {
        Self {
            _output_stream: None,
            output_handle: None,
            sink: None,
            loaded_path: None,
            position_ms: 0.0,
            duration_ms: 0.0,
            speed: 1.0,
            started_at: None,
        }
    }

    /// Ouvre une seule fois le périphérique audio par défaut.
    fn ensure_output(&mut self) -> Result<(), String> {
        if self.output_handle.is_some() {
            return Ok(());
        }

        let (stream, handle) = OutputStream::try_default().map_err(|error| error.to_string())?;
        self._output_stream = Some(stream);
        self.output_handle = Some(handle);
        Ok(())
    }

    /// Charge un fichier uniquement lorsqu'il diffère du fichier déjà prêt.
    fn load(
        &mut self,
        file_path: String,
        position_ms: Option<f64>,
        volume: Option<f32>,
        speed: Option<f32>,
    ) -> Result<(), String> {
        if self.loaded_path.as_deref() != Some(file_path.as_str())
            || self.sink.as_ref().map_or(true, Sink::empty)
        {
            self.ensure_output()?;
            let file = File::open(&file_path).map_err(|error| error.to_string())?;
            let decoder = Decoder::new(BufReader::new(file)).map_err(|error| error.to_string())?;
            let duration_ms = decoder
                .total_duration()
                .map(|duration| duration.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            let sink = Sink::try_new(self.output_handle.as_ref().unwrap())
                .map_err(|error| error.to_string())?;
            sink.pause();
            sink.append(decoder);
            self.sink = Some(sink);
            self.loaded_path = Some(file_path);
            self.position_ms = 0.0;
            self.duration_ms = duration_ms;
            self.started_at = None;
        }

        if let Some(speed) = speed {
            self.set_speed(speed);
        }
        if let Some(volume) = volume {
            self.set_volume(volume);
        }
        if let Some(position_ms) = position_ms {
            self.seek(position_ms)?;
        }
        Ok(())
    }

    /// Met à jour la position logique depuis l'horloge monotone du thread audio.
    fn sync_position(&mut self) {
        let Some(started_at) = self.started_at else {
            return;
        };
        let advancing = self
            .sink
            .as_ref()
            .is_some_and(|sink| !sink.is_paused() && !sink.empty());
        if !advancing {
            self.started_at = None;
            if self.sink.as_ref().is_some_and(Sink::empty) && self.duration_ms > 0.0 {
                self.position_ms = self.duration_ms;
            }
            return;
        }

        let now = Instant::now();
        self.position_ms +=
            now.duration_since(started_at).as_secs_f64() * 1000.0 * self.speed as f64;
        if self.duration_ms > 0.0 {
            self.position_ms = self.position_ms.min(self.duration_ms);
        }
        self.started_at = Some(now);
    }

    /// Recrée le flux à la position demandée tout en conservant le périphérique audio ouvert.
    fn seek(&mut self, position_ms: f64) -> Result<(), String> {
        self.sync_position();
        let position_ms = position_ms.max(0.0);
        let was_playing = self
            .sink
            .as_ref()
            .is_some_and(|sink| !sink.is_paused() && !sink.empty());
        let volume = self.sink.as_ref().map_or(1.0, Sink::volume);
        let file_path = self
            .loaded_path
            .as_ref()
            .ok_or("No native audio loaded")?
            .clone();
        self.ensure_output()?;
        let file = File::open(file_path).map_err(|error| error.to_string())?;
        let mut decoder = Decoder::new(BufReader::new(file)).map_err(|error| error.to_string())?;
        decoder
            .try_seek(Duration::from_secs_f64(position_ms / 1000.0))
            .map_err(|error| error.to_string())?;
        let sink = Sink::try_new(self.output_handle.as_ref().unwrap())
            .map_err(|error| error.to_string())?;
        sink.pause();
        sink.set_speed(self.speed);
        sink.set_volume(volume);
        sink.append(decoder);
        if was_playing {
            sink.play();
        }
        if let Some(previous_sink) = self.sink.replace(sink) {
            previous_sink.stop();
        }

        self.position_ms = if self.duration_ms > 0.0 {
            position_ms.min(self.duration_ms)
        } else {
            position_ms
        };
        self.started_at = was_playing.then(Instant::now);
        Ok(())
    }

    /// Lance ou reprend la lecture du fichier déjà chargé.
    fn play(&mut self) -> Result<(), String> {
        self.sync_position();
        let sink = self.sink.as_ref().ok_or("No native audio loaded")?;
        sink.play();
        self.started_at = Some(Instant::now());
        Ok(())
    }

    /// Met en pause le lecteur tout en figeant sa position courante.
    fn pause(&mut self) {
        self.sync_position();
        if let Some(sink) = &self.sink {
            sink.pause();
        }
        self.started_at = None;
    }

    /// Applique le volume linéaire natif, y compris au-dessus de 100 %.
    fn set_volume(&mut self, volume: f32) {
        if let Some(sink) = &self.sink {
            sink.set_volume(volume.clamp(0.0, 2.0));
        }
    }

    /// Applique la vitesse en conservant une position logique continue.
    fn set_speed(&mut self, speed: f32) {
        self.sync_position();
        self.speed = speed.clamp(0.1, 4.0);
        if let Some(sink) = &self.sink {
            sink.set_speed(self.speed);
        }
    }

    /// Décharge le fichier courant en conservant le périphérique audio ouvert.
    fn unload(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.loaded_path = None;
        self.position_ms = 0.0;
        self.duration_ms = 0.0;
        self.started_at = None;
    }

    /// Retourne un instantané sérialisable de l'état du lecteur.
    fn status(&mut self) -> PreviewAudioStatus {
        self.sync_position();
        let loaded = self.sink.is_some();
        let ended = loaded && self.sink.as_ref().is_some_and(Sink::empty);
        PreviewAudioStatus {
            loaded,
            playing: loaded && !ended && self.sink.as_ref().is_some_and(|sink| !sink.is_paused()),
            ended,
            position_ms: self.position_ms,
            duration_ms: self.duration_ms,
            speed: self.speed,
        }
    }

    /// Exécute une commande reçue du frontend sur le lecteur persistant.
    fn handle(&mut self, request: &PreviewAudioRequest) -> Result<PreviewAudioStatus, String> {
        match request.action {
            PreviewAudioAction::Load => self.load(
                request
                    .file_path
                    .clone()
                    .ok_or("Missing native audio path")?,
                request.position_ms,
                request.volume,
                request.speed,
            )?,
            PreviewAudioAction::Play => {
                if self.sink.as_ref().map_or(true, Sink::empty) {
                    self.load(
                        request
                            .file_path
                            .clone()
                            .ok_or("Missing native audio path")?,
                        None,
                        request.volume,
                        request.speed,
                    )?;
                }
                if let Some(position_ms) = request.position_ms {
                    self.seek(position_ms)?;
                }
                if let Some(volume) = request.volume {
                    self.set_volume(volume);
                }
                if let Some(speed) = request.speed {
                    self.set_speed(speed);
                }
                self.play()?;
            }
            PreviewAudioAction::Pause => self.pause(),
            PreviewAudioAction::Seek => {
                self.seek(request.position_ms.ok_or("Missing native audio position")?)?
            }
            PreviewAudioAction::SetVolume => {
                self.set_volume(request.volume.ok_or("Missing native audio volume")?)
            }
            PreviewAudioAction::SetSpeed => {
                self.set_speed(request.speed.ok_or("Missing native audio speed")?)
            }
            PreviewAudioAction::Status => {}
            PreviewAudioAction::Unload => self.unload(),
        }
        Ok(self.status())
    }
}

/// Traite séquentiellement les commandes afin de conserver les objets audio non transférables.
fn run_preview_audio_thread(receiver: Receiver<PreviewAudioRequest>) {
    let mut runtime = PreviewAudioRuntime::new();
    while let Ok(request) = receiver.recv() {
        let result =
            catch_unwind(AssertUnwindSafe(|| runtime.handle(&request))).unwrap_or_else(|_| {
                runtime = PreviewAudioRuntime::new();
                Err("Native audio service failed".to_string())
            });
        let _ = request.response.send(result);
    }
}

lazy_static! {
    static ref PREVIEW_AUDIO_SERVICE: PreviewAudioService = PreviewAudioService::new();
}

/// Pilote le lecteur audio natif persistant de la prévisualisation.
#[tauri::command(async)]
pub fn control_preview_audio(
    action: PreviewAudioAction,
    file_path: Option<String>,
    position_ms: Option<f64>,
    volume: Option<f32>,
    speed: Option<f32>,
) -> Result<PreviewAudioStatus, String> {
    PREVIEW_AUDIO_SERVICE.request(action, file_path, position_ms, volume, speed)
}
